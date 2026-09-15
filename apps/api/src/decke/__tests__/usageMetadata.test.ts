import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentUserText, decimalUsd, extractUsage, safeUsageCode, usageCategory } from '../usageMetadata.js';
import { prFromSystemId } from '../build.js';
test('provider usage preserves cache and reasoning evidence without raw context',()=>{
 const sentinel='PRIVATE_PROMPT_SENTINEL';
 const result=extractUsage({inputTokens:{total:100,cacheRead:60,cacheWrite:10},outputTokens:{total:35,reasoning:20},raw:{prompt:sentinel}},
 {gateway:{cost:'0.000000012345',generationId:'gen_fixture',prompt:sentinel},secret:sentinel});
 assert.deepEqual(result.tokens,{inputTokens:100,outputTokens:35,cacheReadTokens:60,cacheWriteTokens:10,reasoningTokens:20});
 assert.equal(result.cost.usd,'0.000000012345');assert.equal(result.cost.source,'provider_reported');
 assert.equal(JSON.stringify(result).includes(sentinel),false);
});
test('normalized SDK usage and explicit zero differ from missing evidence',()=>{
 const r=extractUsage({inputTokens:0,outputTokens:5,inputTokenDetails:{cacheReadTokens:0},outputTokenDetails:{reasoningTokens:0}},{gateway:{cost:'0'}});
 assert.equal(r.tokens.inputTokens,0);assert.equal(r.tokens.cacheWriteTokens,null);assert.equal(r.cost.usd,'0');
 const unknown=extractUsage({},{});assert.equal(unknown.cost.usd,null);assert.equal(unknown.cost.coverage,'unknown');
});
test('cost validation accepts exact bounded decimals and rejects guessed malformed values',()=>{
 for(const bad of [undefined,null,-1,NaN,Infinity,'NaN','1e-6','-0.1','0.0000000000001','1.2USD','9999999999999',{}])assert.equal(decimalUsd(bad),null);
 for(const good of ['0','0.1','123.123456789012',0,1])assert.notEqual(decimalUsd(good),null);
});
test('current user excerpt never includes hidden instructions or previous turns',()=>{
 const text=currentUserText([{role:'system',content:'SECRET_SYSTEM'},{role:'user',parts:[{type:'text',text:'OLD_PRIVATE'}]},
 {role:'assistant',parts:[{type:'reasoning',text:'SECRET_REASONING'}]},{role:'user',parts:[{type:'text',text:'Current question'},{type:'tool-result',output:'SECRET_TOOL'}]}]);
 assert.equal(text,'Current question');assert.equal(currentUserText(null),'');
 assert.equal(safeUsageCode(new Error('SECRET_ERROR')),'provider_error');
});
test('business categories and trusted preview PR parsing retain honest unknown values',()=>{
 assert.equal(usageCategory('chat_turn'),'response');assert.equal(usageCategory('research_meta'),'research');
 assert.equal(usageCategory('analyze_collection'),'planning');assert.equal(usageCategory('plan_deck'),'planning');
 assert.equal(prFromSystemId('188'),188);
 for(const bad of ['',undefined,'0','-1','188junk','1.5',188])assert.equal(prFromSystemId(bad),null);
});
