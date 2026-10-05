import { verifyProject,safeFailure,ReadinessError } from './lib/database';
async function main() {
  await verifyProject();
  const response = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/config/auth`,{
    headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new ReadinessError(`NOT RUN: Auth configuration inspection returned HTTP ${response.status}; values withheld.`);
  let config = await response.json();
  const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
  let urls = String(config.uri_allow_list || '').split(',').map((v) => v.trim()).filter(Boolean);
  if (process.argv[2] === 'configure-redirect' && !urls.includes(`${origin}/auth/callback`)) {
    // Preserve every preexisting allowlist entry; no provider credentials are written.
    const updated = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/config/auth`,{
      method:'PATCH',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},
      body:JSON.stringify({uri_allow_list:[...urls,`${origin}/auth/callback`].join(',')}),signal:AbortSignal.timeout(15000),
    });
    if (!updated.ok) throw new ReadinessError(`FAILED: callback configuration returned HTTP ${updated.status}; values withheld.`);
    const verified = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/config/auth`,{
      headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(15000),
    });
    if (!verified.ok) throw new ReadinessError('FAILED: callback setting could not be independently reread.');
    config = await verified.json();urls = String(config.uri_allow_list || '').split(',').map((v) => v.trim());
    if (!urls.includes(`${origin}/auth/callback`)) throw new ReadinessError('FAILED: exact callback missing after configuration.');
    console.log('PASSED: exact local application callback added and reread; existing entries and provider credentials preserved.');
  }
  console.log(JSON.stringify({check:'Google configuration',googleEnabled:config.external_google_enabled === true,
    googleClientConfigured:typeof config.external_google_client_id === 'string' && config.external_google_client_id.length > 0,
    siteURLMatches:config.site_url === origin,exactCallbackAllowed:urls.includes(`${origin}/auth/callback`),
    applicationOrigin:origin,applicationCallback:`${origin}/auth/callback`,credentials:'not logged',operation:process.argv[2] === 'configure-redirect' ? 'callback allowlist only' : 'read-only'}));
}
main().catch(safeFailure);
