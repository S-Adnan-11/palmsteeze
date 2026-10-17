import {writeEvidence} from './evidence';
import Stripe from 'stripe';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { loadLocalEnvironment,ReadinessError } from './database';

export function savePrivateEnvironment(values:Record<string,string>) {
  let content=readFileSync('.env.local','utf8');
  for (const [name,value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /[\r\n]/.test(value)) throw new ReadinessError('Private configuration value refused.');
    const line=`${name}=${JSON.stringify(value)}`;
    const expression=new RegExp(`^${name}=.*$`,'m');
    content=expression.test(content) ? content.replace(expression,()=>line) : `${content.trimEnd()}\n${line}\n`;
    process.env[name]=value;
  }
  writeFileSync('.env.local',content,{mode:0o600});
}
export async function verifiedStripeSandbox() {
  loadLocalEnvironment();
  const key=process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ReadinessError('NOT RUN: fill STRIPE_SECRET_KEY privately from the dedicated Stripe sandbox, or supply STRIPE_SANDBOX_EMAIL privately for temporary setup.');
  if (!/^(?:sk_test_|rk_test_|rkcs_test_)/.test(key)) throw new ReadinessError('NOT RUN: only sandbox/test Stripe keys are permitted; live or unknown key refused.');
  if (!/^acct_[A-Za-z0-9]+$/.test(process.env.STRIPE_ACCOUNT_ID||'') || process.env.PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED!=='true') {
    throw new ReadinessError('NOT RUN: fill STRIPE_ACCOUNT_ID and confirm PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED privately for the dedicated sandbox.');
  }
  const stripe=new Stripe(key,{maxNetworkRetries:2,timeout:15000});
  let account:Stripe.Account;
  try {account=await stripe.accounts.retrieveCurrent();}
  catch (error) {
    // Only fixed-format diagnostic fields are safe to report. Raw provider
    // messages can contain a supplied key and must never reach the console.
    const provider=error as {type?:string;code?:string;statusCode?:number;param?:string};
    const safe=(value:unknown)=>typeof value==='string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'unavailable';
    const status=Number.isInteger(provider.statusCode) ? provider.statusCode : 'unavailable';
    mkdirSync('docs/evidence',{recursive:true});
    writeEvidence('m2b-stripe-access.json',{checkedAt:new Date().toISOString(),
      operation:'GET /v1/account',selectedSandboxVerification:'FAILED',type:safe(provider.type),
      code:safe(provider.code),status,parameter:safe(provider.param),paymentCreated:false,
      requiredPermission:'connected_account_read',
      requiredAction:'Enable Read for Connect connected-account access on the existing sandbox restricted key; use the failed GET /v1/account request log to locate the named permission. Update STRIPE_SECRET_KEY privately only if the key is replaced.',
    });
    throw new ReadinessError(`NOT RUN: Stripe account retrieval failed (${safe(provider.type)}, ${safe(provider.code)}, HTTP ${status}, parameter ${safe(provider.param)}). The observed missing permission is connected_account_read (Connect account Read). Raw provider text and identity withheld.`);
  }
  if (account.id!==process.env.STRIPE_ACCOUNT_ID) throw new ReadinessError('NOT RUN: Stripe selected-account mismatch; no payment created.');
  mkdirSync('docs/evidence',{recursive:true});
  writeEvidence('m2b-stripe-access.json',{checkedAt:new Date().toISOString(),
    operation:'GET /v1/account',selectedSandboxVerification:'PASSED',paymentCreated:false,
  });
  console.log('PASSED: dedicated owner-selected Stripe account matches the sandbox/test key configuration. No account identity or credentials logged.');
  return stripe;
}
