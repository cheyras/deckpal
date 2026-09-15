import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditWork } from '../../credits/work.js';

test('an aborted operation is refunded before any provider-start write',async()=>{
 const ac=new AbortController();ac.abort();let starts=0,refunds=0;
 const work=creditWork(async()=>{refunds++;},ac.signal);
 assert.throws(()=>work.invoke(()=>{starts++;}),/cancelled/);await work.refund();
 assert.equal(starts,0);assert.equal(refunds,1);
});
test('accounting failure prevents provider invocation and leaves reservation refundable',async()=>{
 let invocations=0,refunds=0;
 const work=creditWork(async()=>{refunds++;},new AbortController().signal);
 await assert.rejects(async()=>{await Promise.reject(new Error('database unavailable'));work.invoke(()=>{invocations++;});},/database unavailable/);
 await work.refund();assert.equal(invocations,0);assert.equal(refunds,1);
});
test('concurrent deep fallback starts share one accounting transition',async()=>{
 let invocations=0,refunds=0;
 const work=creditWork(async()=>{refunds++;},new AbortController().signal);
 await Promise.all([work.invoke(async()=>{invocations++;}),work.invoke(async()=>{invocations++;})]);
 await work.refund();assert.equal(invocations,2);assert.equal(refunds,0);
});
test('cancelling after provider invocation retains the quoted flat charge',async()=>{
 const ac=new AbortController();let refunds=0;
 const work=creditWork(async()=>{refunds++;},ac.signal);
 work.invoke(()=>{});ac.abort();await work.refund();assert.equal(refunds,0);
});
