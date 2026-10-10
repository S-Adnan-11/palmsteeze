// Local proof process only. Never imported by the application.
if (process.env.PALMSTEEZE_PROVIDER_FAULTS !== 'local-proof' || process.env.APP_ORIGIN !== 'http://localhost:3000' || process.env.VERCEL || process.env.VERCEL_ENV) throw new Error('Local provider proof only');
const originalFetch=globalThis.fetch;
const used=new Set();
globalThis.fetch=async function(input,init) {
  if(String(input)==='https://challenges.cloudflare.com/turnstile/v0/siteverify') {
    const token=new URLSearchParams(init?.body).get('response');
    if(token?.startsWith('controlled-')) {
      if(token==='controlled-timeout') throw new Error('Controlled timeout');
      if(token==='controlled-provider') return new Response('Unavailable',{status:503});
      let result={success:true,hostname:'localhost',action:'reserve',challenge_ts:new Date().toISOString()};
      if(token?.startsWith('controlled-entrance-'))result.action='entrance';
      if(token==='controlled-invalid') result={success:false,'error-codes':['invalid-input-response']};
      if(token==='controlled-expired'||used.has(token)) result={success:false,'error-codes':['timeout-or-duplicate']};
      if(token==='controlled-hostname') result.hostname='untrusted.example';
      if(token==='controlled-action') result.action='login';
      if(token==='controlled-old') result.challenge_ts=new Date(Date.now()-301000).toISOString();
      if(token.startsWith('controlled-pass-')||token.startsWith('controlled-entrance-')) used.add(token);
      return Response.json(result);
    }
  }
  return originalFetch(input,init);
};
