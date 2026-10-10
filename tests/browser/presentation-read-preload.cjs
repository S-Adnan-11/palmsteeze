// Presentation fixtures in an explicitly local test subprocess only. Never
// imported by the app; genuine Auth, prices, security and reservation APIs stay live.
const {readFileSync}=require('node:fs');
const path=require('node:path');
if(process.env.PALMSTEEZE_VISUAL_FIXTURES==='local-review') {
  if(process.env.APP_ORIGIN!=='http://localhost:3000'||process.env.VERCEL||process.env.VERCEL_ENV)throw new Error('Local presentation review only');
  const original=globalThis.fetch;
  globalThis.fetch=async function(input,init) {
    let fixture;
    try{fixture=JSON.parse(readFileSync(path.resolve('.tools/private/m4-standardization-fixture.json'),'utf8'));}catch{return original(input,init);}
    const url=new URL(typeof input==='string'?input:input instanceof URL?input:input.url);
    if(url.origin!==process.env.NEXT_PUBLIC_SUPABASE_URL)return original(input,init);
    const verb=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
    const id=url.searchParams.get('id')==='eq.'+fixture.booking.id;
    const owner=url.searchParams.get('owner_id')==='eq.'+fixture.owner;
    const detail=url.searchParams.get('booking_id')==='eq.'+fixture.booking.id;
    if(verb==='POST'&&url.pathname==='/functions/v1/palmsteeze-payments/recover'&&JSON.parse(init?.body||'{}').bookingId===fixture.booking.id)return new Response(null,{status:204});
    if(verb!=='GET')return original(input,init);
    const response=(rows)=>new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
    if(url.pathname==='/rest/v1/bookings'&&(id||owner))return response([fixture.booking]);
    if(url.pathname==='/rest/v1/payment_attempts'&&(detail||owner)) {
      if(url.searchParams.get('select')==='booking_id')return response([]);
      if(fixture.unavailable)return new Response(JSON.stringify({code:'XX000',message:'Controlled presentation read failure'}),{status:503,headers:{'Content-Type':'application/json'}});
      return response([fixture.payment]);
    }
    if(url.pathname==='/rest/v1/cancellation_requests'&&(detail||owner))return response([]);
    return original(input,init);
  };
}
