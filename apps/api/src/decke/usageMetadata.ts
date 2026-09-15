export type UsageCategory='response'|'research'|'planning';
export interface UsageTokens {inputTokens:number|null;outputTokens:number|null;cacheReadTokens:number|null;cacheWriteTokens:number|null;reasoningTokens:number|null}
export interface UsageCost {source:'provider_reported'|'token_rate_estimate'|'unknown';usd:string|null;currency:'USD';coverage:'complete'|'partial'|'unknown'}
function record(value:unknown):Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function count(value:unknown):number|null {return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null}
export function decimalUsd(value:unknown):string|null {
  const s=typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):'';
  if(!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(s)) return null;
  return s;
}
export function extractUsage(usage:unknown,metadata:unknown):{tokens:UsageTokens;cost:UsageCost;generationId:string|null} {
  const u=record(usage),input=record(u.inputTokens),output=record(u.outputTokens);
  const inDetails=record(u.inputTokenDetails),outDetails=record(u.outputTokenDetails);
  const gateway=record(record(metadata).gateway);
  const usd=decimalUsd(gateway.cost);
  const id=gateway.generationId;
  return {
    tokens:{inputTokens:count(input.total??u.inputTokens),outputTokens:count(output.total??u.outputTokens),
      cacheReadTokens:count(input.cacheRead??inDetails.cacheReadTokens),cacheWriteTokens:count(input.cacheWrite??inDetails.cacheWriteTokens),
      reasoningTokens:count(output.reasoning??outDetails.reasoningTokens)},
    cost:{source:usd===null?'unknown':'provider_reported',usd,currency:'USD',coverage:usd===null?'unknown':'complete'},
    generationId:typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id)?id:null,
  };
}
export function usageCategory(tool:string):UsageCategory {return tool==='chat_turn'?'response':tool==='research_meta'?'research':'planning'}
export function safeUsageCode(error:unknown):string {
  const e=record(error);
  return e.name==='AbortError'?'cancelled':typeof e.statusCode==='number'&&e.statusCode===429?'provider_rate_limit':'provider_error';
}
/** No hidden instructions, tools, reasoning, or earlier conversation is retained. */
export function currentUserText(messages:unknown):string {
  if(!Array.isArray(messages)) return '';
  const last=[...messages].reverse().find(x=>record(x).role==='user');
  const m=record(last);
  return (Array.isArray(m.parts)?m.parts.filter(x=>record(x).type==='text').map(x=>record(x).text).filter(x=>typeof x==='string').join('\n'):typeof m.content==='string'?m.content:'').slice(0,24000);
}
