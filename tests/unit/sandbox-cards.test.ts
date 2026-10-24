import assert from 'node:assert/strict';
import test from 'node:test';
import {checkoutTestCard,formatCardNumber,sandboxCards} from '../../src/lib/sandbox-cards';

test('catalogue contains ten distinct published successful-payment PANs with correct CVC sizes',()=>{
  assert.equal(new Set(sandboxCards.map(card=>card.number)).size,10);
  for(const card of sandboxCards) {
    const sum=[...card.number].reverse().reduce((total,char,index)=>{const value=Number(char)*(index%2?2:1);return total+(value>9?value-9:value);},0);
    assert.equal(sum%10,0,card.id);assert.equal(card.cvcLength,card.brand==='American Express'?4:3);
    assert.equal(formatCardNumber(card).replaceAll(' ',''),card.number);
  }
});
test('checkout details survive retries/reloads without any browser storage',()=>{
  const now=new Date('2026-12-31T23:59:59Z');
  const ids=new Set<string>();
  for(let index=0;index<100;index++) {
    const card=checkoutTestCard('booking-'+index,now.toISOString(),'Ada Example');ids.add(card.id);
    assert.deepEqual(card,checkoutTestCard('booking-'+index,now.toISOString(),'Ada Example'));
    assert.match(card.cvc,new RegExp('^\\d{'+card.cvcLength+'}$'));
    const [month,year]=card.expiry.split('/').map(Number);
    assert.ok(month>=1&&month<=12&&year>=28);assert.equal(card.name,'Ada Example');
  }
  assert.equal(ids.size,10);
  assert.equal(checkoutTestCard('booking','2026-10-10','').name,'PalmSteeze visitor');
});
