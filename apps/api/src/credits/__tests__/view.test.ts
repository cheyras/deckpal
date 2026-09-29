import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decimalNumber, shapeWalletAccounting } from '../view.js';

test('decimal balances are rounded to four places without float money arithmetic',()=>{
 assert.equal(decimalNumber('12.34564'),12.3456);
 assert.equal(decimalNumber('12.34565'),12.3457);
 assert.equal(decimalNumber('-0.00006'),-0.0001);
 assert.equal(decimalNumber('7'),7);
 for(const invalid of ['NaN','1e3',' 1.2','1.2USD',Infinity]) assert.throws(()=>decimalNumber(invalid));
});

test('flat wallet retains prices while metered wallet exposes hold and exact balance',()=>{
 const common={debt:0,purchaseHold:false};
 const flat=shapeWalletAccounting({enabled:true,lowAt:100,prices:{chatTurn:1},pricingRevision:4,unlimited:false,overrideRevision:0},{...common,balance:9});
 assert.deepEqual(flat,{...common,balance:9,mode:'flat',prices:{chatTurn:1}});
 const metered=shapeWalletAccounting({enabled:true,lowAt:100,mode:'metered',holdCredits:25,holdMinCredits:3,pricingRevision:5,unlimited:false,overrideRevision:0},{...common,balance:'9.876543210000',heldCredits:25,prices:{chatTurn:999}});
 assert.deepEqual(metered,{...common,balance:9.8765,balanceExact:'9.876543210000',heldCredits:25,mode:'metered',holdCredits:25,holdMinCredits:3});
 assert.equal('prices' in metered,false);
});
