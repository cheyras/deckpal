import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai';
import type { Queryable } from '@deckpal/db';
import { ApiError, UUID_RE } from '../http.js';
import { isMetered, type CreditPolicy } from '../credits/policy.js';
import { buildStamp } from './build.js';
import { decimalUsd, extractUsage, safeUsageCode, usageCategory, type UsageCategory } from './usageMetadata.js';
export interface AiRequest {id:string;db:Queryable;pending:Set<Promise<unknown>>;failed:boolean;metered:boolean;meteredStarted:boolean;capReached:boolean;signal?:AbortSignal;spendId?:string}
const context=new AsyncLocalStorage<{request:AiRequest;tool:string;operationKey:string;advisory?:boolean}>();
export function runAiUsage<T>(request:AiRequest,fn:()=>T):T {return context.run({request,tool:'chat_turn',operationKey:'chat_turn'},fn)}
/**
 * An ADVISORY model call on the request — triage, the front-door classifier.
 *
 * Recorded and charged like any provider call, under its own operation key so
 * the usage report shows it apart from the reply. The tool stays `chat_turn`
 * on purpose: `decke_usage_operation_begin` binds a chat request's credit spend
 * only to `chat_turn` operations (any other tool must carry a `:deep:` spend
 * key), so a new tool label would need a migration. The operation key is free
 * text and already the report's grouping column.
 *
 * Its failure is recorded on the OPERATION and never marks the REQUEST failed:
 * the caller falls back to a deterministic heuristic by design, so a provider
 * error here must not settle a reply that went on to succeed as `failed`.
 */
export function runAdvisoryUsage<T>(request:AiRequest,operationKey:string,fn:()=>T):T {
 return context.run({request,tool:'chat_turn',operationKey,advisory:true},fn);
}
export function runUsageOperation<T>(tool:string,fn:()=>T,operationKey?:string):T {
  const c=context.getStore();return c?context.run({...c,tool,operationKey:operationKey??tool},fn):fn();
}
function uuid(v:unknown):string|null{return typeof v==='string'&&UUID_RE.test(v)?v:null}
export async function beginAiRequest(db:Queryable,args:{
 userId:string;conversationId:unknown;exchangeId?:unknown;seq?:unknown;requestKey:string;payloadHash:string;
 quote:{revision:number;overrideRevision?:number;unlimited?:boolean;policy:CreditPolicy};messages:unknown;signal?:AbortSignal;
}):Promise<AiRequest> {
 const stamp=buildStamp();
 const seq=typeof args.seq==='number'&&Number.isSafeInteger(args.seq)&&args.seq>=0&&args.seq<=10000?args.seq:null;
 try {
  const {rows}=await db.query('SELECT public.decke_usage_begin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS data',[
   args.userId,uuid(args.conversationId),uuid(args.exchangeId),seq,args.requestKey,args.payloadHash,
   stamp.buildSha,stamp.buildPr,args.quote.revision,args.quote.overrideRevision??0,
   args.quote.unlimited?'unlimited':args.quote.policy.enabled?'paid':'daily',null]);
  if(!rows[0]?.data?.id) throw new Error('Missing usage record');
  return {id:String(rows[0].data.id),db,pending:new Set(),failed:false,metered:isMetered(args.quote.policy),meteredStarted:false,capReached:false,signal:args.signal};
 }catch(error) {
  const code=(error as {code?:string}).code;
  if(code==='40001') throw new ApiError(409,'operation_replayed','This request was already accepted. Send a new message.');
  if(code==='42501') throw new ApiError(403,'forbidden','Conversation or account is unavailable.');
  throw error;
 }
}
async function tracked(request:AiRequest,work:Promise<unknown>):Promise<void> {
 request.pending.add(work);
 try{await work;}finally{request.pending.delete(work);}
}
export interface ExternalUsageResult {
 status:'completed'|'failed'|'cancelled';inputTokens?:number|null;outputTokens?:number|null;costUsd?:string|number|null;
}
/** Meter a provider call that does not travel through an AI SDK LanguageModel. */
export async function beginExternalUsage(tool:string,model:string,provider:string,operationKey:string):Promise<(result:ExternalUsageResult)=>Promise<void>> {
 const ctx=context.getStore();if(!ctx)return async()=>{};
 const {request}=ctx;const id=randomUUID();
  try {
  await request.db.query('SELECT public.decke_usage_external_operation_begin($1,$2,$3,$4,$5,$6,$7)',
   [id,request.id,tool,model.slice(0,160),provider.slice(0,80),operationKey.slice(0,160),request.spendId??null]);
 } catch (error) {
  if((error as {code?:string}).code==='DKCAP'){request.capReached=true;throw error;}
  if(request.metered)throw error;
  console.error('[deck-e] external usage begin unavailable',request.id,tool);return async()=>{};
 }
 let done=false;
 return async(result)=>{
  if(done)return;done=true;
  const cost=decimalUsd(result.costUsd);
  const work=request.db.query("UPDATE public.decke_ai_operation SET status=$2,finished_at=now(),input_tokens=$3,output_tokens=$4,cost_usd=$5,cost_source=$6,error_code=$7 WHERE id=$1 AND status='started'",
   [id,result.status,result.inputTokens??null,result.outputTokens??null,cost,cost===null?'unknown':'provider_reported',result.status==='failed'?'provider_error':null]);
  try{await tracked(request,work);}catch{console.error('[deck-e] external usage finalization unavailable',request.id,tool);}
 };
}
export interface MeteredSettlement {credits:string;wholeCredits:number;knownCostUsd:string;coverage:'complete'|'partial'|'unknown';coveredCredits?:string;balance:string|null}
export async function finishAiRequest(request:AiRequest,status:'completed'|'failed'|'cancelled',credits?:number):Promise<MeteredSettlement|undefined> {
 await Promise.allSettled([...request.pending]);
 const finalStatus=request.signal?.aborted?'cancelled':request.failed?'failed':status;
 try {
  // A metered request settles even when admission looked like it failed: if the
  // begin committed and only its reply was lost, the hold exists and must be
  // released. Only "no reservation" (P0002) falls through to the plain finish.
  if(request.meteredStarted||request.metered){
   try{
    const {rows}=await request.db.query('SELECT public.decke_metered_settle($1,$2) AS data',[request.id,finalStatus]);
    return rows[0]?.data as MeteredSettlement|undefined;
   }catch(error){
    if(request.meteredStarted||(error as {code?:string}).code!=='P0002')throw error;
   }
  }
  await request.db.query("UPDATE public.decke_ai_request SET status=$2,finished_at=now(),charged_credits=coalesce((SELECT sum(s.credits)::integer FROM public.credit_spend s WHERE s.user_id=decke_ai_request.user_id AND (s.request_key=decke_ai_request.request_key OR starts_with(s.request_key,decke_ai_request.request_key||':deep:')) AND s.refunded_at IS NULL),$3) WHERE id=$1 AND status='started'",
   [request.id,finalStatus,credits??null]);
 }catch{console.error('[deck-e] usage finalization unavailable',request.id);}
}
export async function meteredCapReached(request:AiRequest):Promise<boolean> {
 if(!request.meteredStarted)return false;
 if(request.capReached)return true;
 try{
  const {rows}=await request.db.query('SELECT public.decke_metered_status($1) AS data',[request.id]);
  request.capReached=rows[0]?.data?.capReached===true;
  return request.capReached;
 }catch(error){
  if((error as {code?:string}).code==='DKCAP'){request.capReached=true;return true;}
  console.error('[deck-e] metered status unavailable',request.id);return false;
 }
}
export interface ProviderCreditWork {spendId?:string;prepareRefund?:(recover:()=>Promise<void>)=>void;invoke?:<T>(provider:()=>T)=>T}
export function observeUsageModel(model:LanguageModel,credit?:ProviderCreditWork):LanguageModel {
 const ctx=context.getStore(); if(typeof model==='string') return model;
 if(!ctx){
  // Admission belongs at the provider boundary even in callers that do not record a
  // usage request (tests and deliberately unmetered jobs). Never let missing telemetry
  // context turn a supplied credit guard into an authorization bypass.
  if(!credit?.invoke)return model;
  const admissionOnly:LanguageModelMiddleware={
   specificationVersion:'v4',
   wrapGenerate:async({doGenerate})=>credit.invoke!(doGenerate),
   wrapStream:async({doStream})=>credit.invoke!(doStream),
  };
  return wrapLanguageModel({model,middleware:admissionOnly});
 }
 const {request,tool,operationKey,advisory}=ctx; const category=usageCategory(tool);
 const cancelled=(signal?:AbortSignal)=>signal?.aborted||request.signal?.aborted;
 const start=async(modelId:string,provider:string,signal?:AbortSignal)=>{
  if(cancelled(signal)) throw new DOMException('Cancelled','AbortError');
  const id=randomUUID();
  credit?.prepareRefund?.(async()=>{await request.db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1)',[id]);});
  try{
   await request.db.query('SELECT public.decke_usage_operation_begin($1,$2,$3,$4,$5,$6,$7,$8)',
    [id,request.id,category,tool,modelId.slice(0,160),provider.slice(0,80),operationKey.slice(0,160),credit?.spendId??null]);
  }catch(error){if((error as {code?:string}).code==='DKCAP')request.capReached=true;throw error;}
  return id;
 };
 const end=async(id:string,status:string,usage:unknown,metadata:unknown)=>{
  const data=extractUsage(usage,metadata);
  if(status==='failed'&&!advisory) request.failed=true;
  try {
   await tracked(request,request.db.query("UPDATE public.decke_ai_operation SET status=$2,finished_at=now(),input_tokens=$3,output_tokens=$4,cache_read_tokens=$5,cache_write_tokens=$6,reasoning_tokens=$7,cost_usd=$8,cost_source=$9,generation_id=$10,error_code=$11 WHERE id=$1 AND status='started'",
    [id,status,data.tokens.inputTokens,data.tokens.outputTokens,data.tokens.cacheReadTokens,data.tokens.cacheWriteTokens,data.tokens.reasoningTokens,data.cost.usd,data.cost.source,data.generationId,status==='failed'?'provider_error':null]));
  }catch{console.error('[deck-e] usage operation finalization unavailable',request.id);}
 };
 const middleware:LanguageModelMiddleware={
  specificationVersion:'v4',
  wrapGenerate:async({doGenerate,model:inner,params})=>{
   const id=await start(inner.modelId,inner.provider,params.abortSignal);
   let invoked=false;
   try{
    const call=()=>{
     if(cancelled(params.abortSignal))throw new DOMException('Cancelled','AbortError');
     invoked=true;return doGenerate();
    };
    const result=await (credit?.invoke?credit.invoke(call):call());
    await end(id,'completed',result.usage,result.providerMetadata);return result;
   }catch(error){
    if(!invoked)await request.db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1)',[id]);
    else await end(id,cancelled(params.abortSignal)?'cancelled':'failed',null,null);
    throw error;
   }
  },
  wrapStream:async({doStream,model:inner,params})=>{
   const id=await start(inner.modelId,inner.provider,params.abortSignal);
   let done=false,invoked=false;
   const finish=async(status:string,usage?:unknown,metadata?:unknown)=>{
    if(done)return;done=true;params.abortSignal?.removeEventListener('abort',abort);
    await end(id,status,usage,metadata);
   };
   const abort=()=>{const p=finish('cancelled');request.pending.add(p);void p.finally(()=>request.pending.delete(p));};
   try{
    const call=()=>{
     if(cancelled(params.abortSignal))throw new DOMException('Cancelled','AbortError');
     invoked=true;
     const pending=doStream();
     params.abortSignal?.addEventListener('abort',abort,{once:true});
     return pending;
    };
    const result=await (credit?.invoke?credit.invoke(call):call());
    const reader=result.stream.getReader();
    const stream=new ReadableStream({
     async pull(controller){
      try{
       const part=await reader.read();
       if(part.done){await finish(cancelled(params.abortSignal)?'cancelled':'completed');controller.close();return;}
       const chunk=part.value;
       if(chunk.type==='finish') await finish('completed',chunk.usage,chunk.providerMetadata);
       if(chunk.type==='error') await finish('failed');
       controller.enqueue(chunk);
      }catch(error){await finish(cancelled(params.abortSignal)?'cancelled':'failed');controller.error(error);}
     },
     async cancel(reason){try{await reader.cancel(reason);}finally{await finish('cancelled');}}
    });
    return {...result,stream};
   }catch(error){
    if(!invoked)await request.db.query('SELECT public.decke_usage_operation_cancel_uninvoked($1)',[id]);
    else await finish(cancelled(params.abortSignal)?'cancelled':'failed');
    throw error;
   }
  }
 };
 return wrapLanguageModel({model,middleware});
}
export { safeUsageCode, usageCategory };
export type { UsageCategory };
