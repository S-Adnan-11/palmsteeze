export {};
declare const Deno:{env:{get(name:string):string|undefined};serve(handler:(request:Request)=>Promise<Response>):void};

async function sameSecret(candidate:string,expected:string) {
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([candidate,expected].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
  const left = new Uint8Array(a);const right = new Uint8Array(b);
  let difference=0;for (let i=0;i<left.length;i++) difference|=left[i]^right[i];
  return difference===0;
}
Deno.serve(async request=>{
  const response = (value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
  const secret = Deno.env.get('PALMSTEEZE_RECOVERY_PROOF_TOKEN');
  if (!secret) return response({error:'Probe unavailable'},503);
  if (!await sameSecret(request.headers.get('authorization')||'',`Bearer ${secret}`)) return response({error:'Unauthorized'},401);
  if (request.method!=='POST') return response({error:'POST required'},405);
  const input = await request.json().catch(()=>null);
  if (!input || Object.keys(input).length!==1 || typeof input.run_id!=='string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.run_id)) return response({error:'Invalid probe request'},400);
  try {
    const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/process_recovery_probe`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
        Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''}`},
      body:JSON.stringify({p_run:input.run_id}),signal:AbortSignal.timeout(10000)});
    if (!result.ok) return response({error:'Probe processing unavailable'},503);
    const data = await result.json();
    return response(data,data.controlled_failure ? 503 : 200);
  } catch {return response({error:'Probe processing unavailable'},503);}
});
