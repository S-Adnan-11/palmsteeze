type Environment = Record<string,string | undefined>;

export function sameConfiguredOrigin(request:Request,origin:string) {
  return request.headers.get('origin') === origin && request.headers.get('host') === new URL(origin).host;
}

export function configuredAppOrigin(env:Environment) {
  const hosted = env.VERCEL === '1' || Boolean(env.VERCEL_ENV);
  const value = env.APP_ORIGIN || (hosted ? '' : 'http://localhost:3000');
  let url:URL;
  try { url = new URL(value); } catch { throw new Error('Configure APP_ORIGIN as the canonical application origin.'); }
  const local = url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname);
  if (url.origin !== value || url.username || url.password || (!local && url.protocol !== 'https:')
      || (hosted && (url.protocol !== 'https:' || ['localhost','127.0.0.1'].includes(url.hostname)))) {
    throw new Error('APP_ORIGIN must be an exact origin; hosted applications require HTTPS.');
  }
  return value;
}

export function assertHostedEnvironment(env:Environment) {
  const origin = configuredAppOrigin({...env,VERCEL:'1'});
  if(!/^[a-f0-9]{64}$/.test(env.PALMSTEEZE_SECURITY_SECRET||'')) throw new Error('Hosting requires the server-only application signing key and matching private database configuration.');
  if (!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY
      || env.PALMSTEEZE_TURNSTILE_TEST_MODE === 'true'
      || /^[123]x0{10,}/.test(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
      || /^[123]x0{10,}/.test(env.TURNSTILE_SECRET_KEY)
      || /your_|placeholder/i.test(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY+env.TURNSTILE_SECRET_KEY)) {
    throw new Error('Hosting requires genuine Turnstile keys and disabled test mode.');
  }
  if (!/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF || '')
      || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${env.SUPABASE_PROJECT_REF}.supabase.co`
      || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || env.PALMSTEEZE_DB_DEDICATED !== 'true' || env.PALMSTEEZE_DB_FREE_CONFIRMED !== 'true'
      || (env.PALMSTEEZE_PAYMENT_WORKER_TOKEN || '').length < 32) {
    throw new Error('Incomplete hosted configuration: use deployment/hosted.env.example.');
  }
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key.startsWith('sb_publishable_')) {
    // Legacy anon JWTs are allowed; a service_role JWT is never a browser key.
    try {
      const payload = JSON.parse(atob(key.split('.')[1]));
      if (payload.role !== 'anon') throw new Error();
    } catch { throw new Error('A public Supabase publishable/anon key is required.'); }
  }
  const privileged = ['DATABASE_PASSWORD','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN',
    'STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','PALMSTEEZE_STRIPE_KEY','PALMSTEEZE_STRIPE_WEBHOOK_SECRET'];
  if (privileged.some(name => Boolean(env[name]))) throw new Error('Remove tooling/Stripe/service credentials from the hosting environment.');
  return origin;
}

export function assertHostedNode(version:string) {
  const [major,minor] = version.replace(/^v/,'').split('.').map(Number);
  if (major !== 24 || minor < 21 || !Number.isInteger(minor)) {
    throw new Error('Hosting requires Node >=24.21.0 <25; check the provider build image before release.');
  }
}
