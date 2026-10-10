// Official Stripe successful-payment cards, checked 10 October 2026:
// https://docs.stripe.com/testing?testing-method=card-numbers#cards-by-brand
// Card-only hosted Checkout accepts these brands in the dedicated sandbox.
// No authentication, decline, dispute or refund-failure scenarios belong here.
export type SandboxCard={id:string;brand:string;number:string;cvcLength:3|4};
export const sandboxCards:readonly SandboxCard[]=[
  {id:'visa',brand:'Visa',number:'4242424242424242',cvcLength:3},
  {id:'visa-debit',brand:'Visa debit',number:'4000056655665556',cvcLength:3},
  {id:'mastercard',brand:'Mastercard',number:'5555555555554444',cvcLength:3},
  {id:'mastercard-2',brand:'Mastercard 2-series',number:'2223003122003222',cvcLength:3},
  {id:'mastercard-debit',brand:'Mastercard debit',number:'5200828282828210',cvcLength:3},
  {id:'mastercard-prepaid',brand:'Mastercard prepaid',number:'5105105105105100',cvcLength:3},
  {id:'amex',brand:'American Express',number:'378282246310005',cvcLength:4},
  {id:'amex-alt',brand:'American Express',number:'371449635398431',cvcLength:4},
  {id:'discover',brand:'Discover',number:'6011111111111117',cvcLength:3},
  {id:'discover-alt',brand:'Discover',number:'6011000990139424',cvcLength:3},
];
export type SandboxCardDetails=SandboxCard&{expiry:string;cvc:string;name:string};
function hash(value:string) {
  let result=2166136261;
  for(const character of value)result=Math.imul(result^character.charCodeAt(0),16777619);
  return result>>>0;
}
export function checkoutTestCard(bookingId:string,createdAt:string,name:string):SandboxCardDetails {
  // Derive once from immutable checkout identity/time, without storing card
  // fields in cookies, optional drafts, APIs or the database. Reloads, retries
  // and a companion window produce the same values for necessary-only users.
  const created=new Date(createdAt);
  if(!Number.isFinite(created.getTime()))throw new Error('Invalid checkout date');
  const card=sandboxCards[hash('card:'+bookingId)%sandboxCards.length];
  const month=1+hash('month:'+bookingId)%12;
  const year=created.getUTCFullYear()+2+hash('year:'+bookingId)%2;
  const cvc=String(hash('cvc:'+bookingId)%10**card.cvcLength).padStart(card.cvcLength,'0');
  return {...card,expiry:String(month).padStart(2,'0')+'/'+String(year).slice(-2),cvc,name:name.trim()||'PalmSteeze visitor'};
}
export function formatCardNumber(card:SandboxCard) {
  return card.cvcLength===4?card.number.slice(0,4)+' '+card.number.slice(4,10)+' '+card.number.slice(10):card.number.match(/.{1,4}/g)!.join(' ');
}
