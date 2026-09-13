import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditWork } from '../../credits/work.js';

test('an aborted operation is refunded before any provider-start write',async()=>{
 const ac=new AbortController();ac.abort();let starts=0,refunds=0;
 const work=creditWork(async()=>{starts++;},async()=>{refunds++;},ac.signal);
 await assert.rejects(()=>work.start(),/cancelled/);await work.refund();
 assert.equal(starts,0);assert.equal(refunds,1);
});
test('accounting failure prevents provider invocation and leaves reservation refundable',async()=>{
 let invocations=0,refunds=0;
 const work=creditWork(async()=>{throw new Error('database unavailable');},async()=>{refunds++;},new AbortController().signal);
 await assert.rejects(async()=>{await work.start();invocations++;},/database unavailable/);
 await work.refund();assert.equal(invocations,0);assert.equal(refunds,1);
});
test('concurrent deep fallback starts share one accounting transition',async()=>{
 let starts=0,refunds=0;
 const work=creditWork(async()=>{starts++;await Promise.resolve();},async()=>{refunds++;},new AbortController().signal);
 await Promise.all([work.start(),work.start()]);
 await work.refund();assert.equal(starts,1);assert.equal(refunds,0);
});
test('cancelling after provider invocation retains the quoted flat charge',async()=>{
 const ac=new AbortController();let refunds=0;
 const work=creditWork(async()=>{},async()=>{refunds++;},ac.signal);
 await work.start();ac.abort();await work.refund();assert.equal(refunds,0);
});
