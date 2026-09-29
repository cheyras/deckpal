import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APICallError, streamText, type LanguageModel } from 'ai';
import type { Queryable } from '@deckpal/db';
import { creditWork } from '../../credits/work.js';
import { DEFAULT_POLICY } from '../../credits/policy.js';
import { beginAiRequest, finishAiRequest, meteredCapReached, observeUsageModel, runAiUsage, runUsageOperation, type AiRequest } from '../usage.js';
const usage={inputTokens:{total:12,noCache:5,cacheRead:7,cacheWrite:0},outputTokens:{total:6,text:4,reasoning:2}};
function fixture() {
 const records:{sql:string;args:unknown[]}[]=[];
 const db={query:async(sql:string,args:unknown[]=[])=>{records.push({sql,args});return {rows:[{data:{id:'00000000-0000-4000-8000-000000000099'}}]};}} as unknown as Queryable;
 const request:AiRequest={id:'00000000-0000-4000-8000-000000000099',db,pending:new Set(),failed:false,metered:false,meteredStarted:false,capReached:false};
 return {records,db,request};
}
function model(options:{fail?:boolean;unpriced?:boolean;neverEnd?:boolean}={}):LanguageModel {
 return {specificationVersion:'v4',provider:'fixture.gateway',modelId:'fixture/model',supportedUrls:{},
  doGenerate:async()=>{throw new Error('unused');},
  doStream:async()=>{
   if(options.fail)throw new Error('PRIVATE_ERROR_SENTINEL');
   return {stream:new ReadableStream({start(c){
    c.enqueue({type:'stream-start',warnings:[]});c.enqueue({type:'text-start',id:'text'});
    c.enqueue({type:'text-delta',id:'text',delta:'Visible answer'});c.enqueue({type:'text-end',id:'text'});
    if(options.neverEnd)return;
    c.enqueue({type:'finish',finishReason:{unified:'stop',raw:undefined},usage,
      providerMetadata:options.unpriced?{}:{gateway:{cost:'0.000123',generationId:'gen_fixture'}}});
    c.close();
   }})};
  }
 } as LanguageModel;
}
test('real SDK stream persists usage metadata without any prompt or answer content',async()=>{
 const f=fixture();
 await runAiUsage(f.request,async()=>{
  const result=streamText({model:observeUsageModel(model()),prompt:'PRIVATE_INPUT_SENTINEL',maxRetries:0});
  for await(const _ of result.fullStream){/* consume real SDK lifecycle */}
 });
 await finishAiRequest(f.request,'completed',1);
 const inserts=f.records.filter(x=>x.sql.startsWith('SELECT public.decke_usage_operation_begin'));
 const updates=f.records.filter(x=>x.sql.startsWith('UPDATE public.decke_ai_operation'));
 assert.equal(inserts.length,1);assert.equal(updates.length,1);
 assert.deepEqual(updates[0]!.args.slice(2,9),[12,6,7,0,2,'0.000123','provider_reported']);
 assert.equal(JSON.stringify(f.records).includes('PRIVATE_INPUT_SENTINEL'),false);
 assert.equal(JSON.stringify(f.records).includes('Visible answer'),false);
 assert.equal(f.records.filter(x=>x.sql.includes('content_append')).length,0);
});
test('nested web research calls keep distinct operation keys without tool content',async()=>{
 const f=fixture();
 await runAiUsage(f.request,async()=>{
  for(const [tool,key] of [['web_research','call_research'],['web_research','call_research_again']]){
   await runUsageOperation(tool!,async()=>{
    const result=streamText({model:observeUsageModel(model()),prompt:'SECRET_TOOL_CONTEXT',maxRetries:0});
    for await(const _ of result.fullStream){}
   },key);
  }
 });
 const inserts=f.records.filter(x=>x.sql.startsWith('SELECT public.decke_usage_operation_begin'));
 assert.deepEqual(inserts.map(x=>x.args[2]),['research','research']);assert.notEqual(inserts[0]!.args[0],inserts[1]!.args[0]);
 assert.deepEqual(inserts.map(x=>x.args[6]),['call_research','call_research_again']);
 assert.equal(f.records.some(x=>x.sql.includes('content_append')),false);
 assert.equal(JSON.stringify(f.records).includes('SECRET_TOOL_CONTEXT'),false);
});
test('failed invocation followed by explicit fallback does not erase unknown failed cost',async()=>{
 const f=fixture();
 await runAiUsage(f.request,async()=>{
  for(const fail of [true,false]){
   const result=streamText({model:observeUsageModel(model({fail})),prompt:'safe',maxRetries:0,onError:()=>{}});
   try{for await(const _ of result.fullStream){}}catch{}
  }
 });
 const updates=f.records.filter(x=>x.sql.startsWith('UPDATE public.decke_ai_operation'));
 assert.equal(updates.length,2);assert.equal(updates[0]!.args[1],'failed');assert.equal(updates[0]!.args[7],null);
 assert.equal(updates[1]!.args[1],'completed');
 assert.equal(JSON.stringify(f.records).includes('PRIVATE_ERROR_SENTINEL'),false);
});
test('cancelled raw provider stream finalizes once and missing cost remains unknown',async()=>{
 const f=fixture();
 await runAiUsage(f.request,async()=>{
  const wrapped=observeUsageModel(model({neverEnd:true})) as Exclude<LanguageModel,string>;
  const result=await wrapped.doStream({prompt:[]} as never);
  const reader=result.stream.getReader();await reader.read();await reader.cancel();
 });
 const updates=f.records.filter(x=>x.sql.startsWith('UPDATE public.decke_ai_operation'));
 assert.equal(updates.length,1);assert.equal(updates[0]!.args[1],'cancelled');assert.equal(updates[0]!.args[7],null);
});
test('old client request correlation is metadata-only and build authority stays server-side',async()=>{
 const f=fixture();
 const old=process.env.VERCEL_GIT_COMMIT_SHA;process.env.VERCEL_GIT_COMMIT_SHA='a'.repeat(40);
 try{
  await beginAiRequest(f.db,{userId:'user',conversationId:'legacy-conversation',requestKey:'request-key',payloadHash:'b'.repeat(64),
   quote:{revision:2,policy:{...DEFAULT_POLICY,enabled:false}},messages:[{role:'user',content:'current'}]});
  const args=f.records[0]!.args;
  assert.equal(args[1],null);assert.equal(args[2],null);assert.equal(args[3],null);assert.equal(args[6],'a'.repeat(40));assert.equal(args[10],'daily');
  assert.equal(args[11],null);
 }finally{if(old===undefined)delete process.env.VERCEL_GIT_COMMIT_SHA;else process.env.VERCEL_GIT_COMMIT_SHA=old;}
});
test('database initialization failure prevents model invocation and replay maps to conflict',async()=>{
 let calls=0;
 const db={query:async()=>{throw Object.assign(new Error('request accepted'),{code:'40001'});}} as unknown as Queryable;
 await assert.rejects(async()=>{
  await beginAiRequest(db,{userId:'u',conversationId:null,requestKey:'request-key',payloadHash:'b'.repeat(64),quote:{revision:1,policy:{...DEFAULT_POLICY,enabled:true}},messages:[]});calls++;
 },(e:unknown)=>(e as {status:number}).status===409);
 assert.equal(calls,0);
});

test('automatic SDK retry records each attempt once without double-counting final usage',async()=>{
 const f=fixture();let attempts=0;
 const source=model() as Exclude<LanguageModel,string>;
 const attemptModel={...source,doStream:async(params:never)=>{
  attempts++;
  if(attempts===1)throw new APICallError({message:'PRIVATE_RETRY_SENTINEL',url:'https://fixture.invalid',requestBodyValues:{secret:'PRIVATE_BODY'},statusCode:503,isRetryable:true});
  return source.doStream(params);
 }} as LanguageModel;
 await runAiUsage(f.request,async()=>{
  const result=streamText({model:observeUsageModel(attemptModel),prompt:'PRIVATE_INPUT',maxRetries:1,onError:()=>{}});
  for await(const _ of result.fullStream){}
 });
 const records=f.records.filter(x=>x.sql.startsWith('UPDATE public.decke_ai_operation'));
 assert.equal(attempts,2);assert.equal(records.length,2);
 assert.deepEqual(records.map(x=>x.args[1]),['failed','completed']);
 assert.deepEqual(records.map(x=>x.args[7]),[null,'0.000123']);
 assert.equal(JSON.stringify(f.records).includes('PRIVATE_'),false);
});
test('abort before invocation leaves the parent cancellable without starting a provider attempt',async()=>{
 const f=fixture();const ac=new AbortController();ac.abort();let calls=0;
 const source=model() as Exclude<LanguageModel,string>;
 await runAiUsage(f.request,async()=>{
  const wrapped=observeUsageModel({...source,doStream:async(p:never)=>{calls++;return source.doStream(p);}} as LanguageModel) as Exclude<LanguageModel,string>;
  await assert.rejects(async()=>await wrapped.doStream({prompt:[],abortSignal:ac.signal} as never),{name:'AbortError'});
 });
 assert.equal(calls,0);
 assert.equal(f.records.length,0);
});
test('provider-start authorization failure prevents invocation',async()=>{
 const f=fixture();let calls=0;
 f.request.db={query:async()=>{throw Object.assign(new Error('Account unavailable'),{code:'42501'});}} as unknown as Queryable;
 await runAiUsage(f.request,async()=>{
  const source=model() as Exclude<LanguageModel,string>;
  const wrapped=observeUsageModel({...source,doStream:async(p:never)=>{calls++;return source.doStream(p);}} as LanguageModel) as Exclude<LanguageModel,string>;
  await assert.rejects(async()=>await wrapped.doStream({prompt:[]} as never),{code:'42501'});
 });
 assert.equal(calls,0);
});

test('creditWork and real middleware refund first operation persistence/authorization failures',async()=>{
 for(const code of ['42501','08006']){
  const f=fixture();let calls=0,refunds=0;
  const work={spendId:'00000000-0000-4000-8000-000000000123',...creditWork(async()=>{refunds++;},new AbortController().signal)};
  f.request.db={query:async(sql:string,args:unknown[])=>{
   if(sql.includes('operation_begin'))throw Object.assign(new Error('fixture persistence denied'),{code});
   f.records.push({sql,args});return {rows:[]};
  }} as unknown as Queryable;
  await runAiUsage(f.request,async()=>{
   const source=model() as Exclude<LanguageModel,string>;
   const wrapped=observeUsageModel({...source,doStream:async(p:never)=>{calls++;return source.doStream(p);}} as LanguageModel,work) as Exclude<LanguageModel,string>;
   await assert.rejects(async()=>await wrapped.doStream({prompt:[]} as never),{code});
  });
  await work.refund();assert.equal(calls,0);assert.equal(refunds,1);
  assert.equal(f.records.filter(x=>x.sql.includes('cancel_uninvoked')).length,1);
 }
});
test('abort while awaiting atomic operation start compensates before the stream or generate provider call',async()=>{
 for(const method of ['doStream','doGenerate'] as const){
  const f=fixture(),ac=new AbortController();let calls=0,refunds=0;
  let release!:()=>void,entered!:()=>void;
  const wait=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});
  const original=f.db.query.bind(f.db);
  f.request.db={query:async(sql:string,args:unknown[])=>{
   const result=await original(sql,args);
   if(sql.includes('operation_begin')){entered();await wait;}
   return result;
  }} as unknown as Queryable;
  const work={spendId:'00000000-0000-4000-8000-000000000123',...creditWork(async()=>{refunds++;},ac.signal)};
  await runAiUsage(f.request,async()=>{
   const source=model() as Exclude<LanguageModel,string>;
   const wrapped=observeUsageModel({...source,[method]:async()=>{calls++;throw new Error('must not invoke');}} as LanguageModel,work) as Exclude<LanguageModel,string>;
   const pending=wrapped[method]({prompt:[],abortSignal:ac.signal} as never);
   await ready;ac.abort();release();
   await assert.rejects(async()=>await pending,{name:'AbortError'});
  });
  await work.refund();
  assert.equal(calls,0);assert.equal(refunds,1);
  assert.equal(f.records[0]!.args[7],work.spendId);
  assert.equal(f.records.filter(x=>x.sql.includes('operation_cancel_uninvoked')).length,2);
  assert.equal(f.records.some(x=>x.sql.startsWith('UPDATE public.decke_ai_operation')),false);
 }
});
test('a real attempted provider call keeps its charge when a later fallback authorization fails',async()=>{
 const f=fixture();let calls=0,refunds=0,preparations=0;
 const original=f.db.query.bind(f.db);
 f.request.db={query:async(sql:string,args:unknown[])=>{
  if(sql.includes('operation_begin')&&++preparations===2)throw Object.assign(new Error('revoked'),{code:'42501'});
  return original(sql,args);
 }} as unknown as Queryable;
 const work={spendId:'00000000-0000-4000-8000-000000000123',...creditWork(async()=>{refunds++;},new AbortController().signal)};
 await runAiUsage(f.request,async()=>{
  const source=model() as Exclude<LanguageModel,string>;
  const wrapped=observeUsageModel({...source,doStream:async()=>{calls++;throw new Error('provider already contacted');}} as LanguageModel,work) as Exclude<LanguageModel,string>;
  await assert.rejects(async()=>await wrapped.doStream({prompt:[]} as never),/already contacted/);
  await assert.rejects(async()=>await wrapped.doStream({prompt:[]} as never),{code:'42501'});
 });
 await work.refund();assert.equal(calls,1);assert.equal(refunds,0);
 assert.equal(f.records.some(x=>x.sql.includes('cancel_uninvoked')),false);
});

test('a lost operation acknowledgement is compensated from the uninvoked creditWork refund path',async()=>{
 const f=fixture();let durablyStarted=false,refunded=false,calls=0,operationId:unknown;
 f.request.db={query:async(sql:string,args:unknown[])=>{
  if(sql.includes('operation_begin')){operationId=args[0];durablyStarted=true;throw Object.assign(new Error('acknowledgement lost'),{code:'08006'});}
  if(sql.includes('cancel_uninvoked')){assert.equal(args[0],operationId);durablyStarted=false;}
  return {rows:[]};
 }} as unknown as Queryable;
 const work={spendId:'00000000-0000-4000-8000-000000000123',...creditWork(async()=>{assert.equal(durablyStarted,false);refunded=true;},new AbortController().signal)};
 await runAiUsage(f.request,async()=>{
  const source=model() as Exclude<LanguageModel,string>;
  const wrapped=observeUsageModel({...source,doStream:async()=>{calls++;throw new Error('must not call');}} as LanguageModel,work) as Exclude<LanguageModel,string>;
  await assert.rejects(async()=>await wrapped.doStream({prompt:[]} as never),{code:'08006'});
 });
 await work.refund();assert.equal(calls,0);assert.equal(refunded,true);
});

test('metered finalization waits for pending usage and records the exact SQL settlement',async()=>{
 const records:{sql:string;args:unknown[]}[]=[];let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const db={query:async(sql:string,args:unknown[]=[])=>{
  records.push({sql,args});
  return {rows:[{data:{credits:'1.234567890123',wholeCredits:1,knownCostUsd:'0.012345678901',coverage:'complete',balance:'23.765432109877'}}]};
 }} as unknown as Queryable;
 const request:AiRequest={id:'00000000-0000-4000-8000-000000000099',db,pending:new Set([pending]),failed:false,metered:true,meteredStarted:true,capReached:false};
 let settled=false;
 const finishing=finishAiRequest(request,'completed').then(result=>{settled=true;return result;});
 await Promise.resolve();assert.equal(settled,false);assert.equal(records.length,0);
 release();
 assert.equal((await finishing)?.credits,'1.234567890123');
 assert.match(records[0]!.sql,/decke_metered_settle/);
 assert.deepEqual(records[0]!.args,[request.id,'completed']);
 assert.equal(records.some(record=>record.sql.includes('credit_spend')),false);
});

test('metered cap status is durable and then cached on the request',async()=>{
 let calls=0;
 const db={query:async()=>{calls++;return {rows:[{data:{knownCredits:'25.1',capCredits:'25',capReached:true}}]};}} as unknown as Queryable;
 const request:AiRequest={id:'00000000-0000-4000-8000-000000000099',db,pending:new Set(),failed:false,metered:true,meteredStarted:true,capReached:false};
 assert.equal(await meteredCapReached(request),true);
 assert.equal(await meteredCapReached(request),true);
 assert.equal(calls,1);
});

test('a metered request whose begin reply was lost still settles its hold; one that never reserved finishes plainly',async()=>{
 const seen:string[]=[];
 const committed={query:async(sql:string)=>{seen.push(sql);return {rows:[{data:{credits:'0.000000000000',wholeCredits:0,knownCostUsd:'0',coverage:'unknown',balance:'30.000000000000'}}]};}} as unknown as Queryable;
 const lost:AiRequest={id:'00000000-0000-4000-8000-000000000099',db:committed,pending:new Set(),failed:false,metered:true,meteredStarted:false,capReached:false};
 assert.equal((await finishAiRequest(lost,'failed'))?.balance,'30.000000000000');
 assert.deepEqual(seen.map(sql=>sql.includes('decke_metered_settle')),[true]);

 const plain:string[]=[];
 const refused={query:async(sql:string)=>{
  plain.push(sql);
  if(sql.includes('decke_metered_settle'))throw Object.assign(new Error('Metered reservation unavailable'),{code:'P0002'});
  return {rows:[]};
 }} as unknown as Queryable;
 const never:AiRequest={id:'00000000-0000-4000-8000-000000000098',db:refused,pending:new Set(),failed:false,metered:true,meteredStarted:false,capReached:false};
 assert.equal(await finishAiRequest(never,'failed',0),undefined);
 assert.equal(plain.length,2);
 assert.match(plain[1]!,/^UPDATE public\.decke_ai_request/);
});
