import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLocalEnvironment,ReadinessError,safeFailure } from './lib/database';
import { savePrivateEnvironment } from './lib/stripe-sandbox';

async function main() {
  loadLocalEnvironment();
  if (process.env.STRIPE_SECRET_KEY) throw new ReadinessError('NOT RUN: Stripe configuration already present; no second sandbox provisioned.');
  const email=process.env.STRIPE_SANDBOX_EMAIL;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ReadinessError('NOT RUN: fill your chosen STRIPE_SANDBOX_EMAIL privately in .env.local. No identity inferred.');
  mkdirSync('.tools/private/stripe',{recursive:true});
  const config=resolve('.tools/private/stripe/config.toml');
  if (existsSync(config) && readFileSync(config,'utf8').includes('test_mode_api_key')) {
    throw new ReadinessError('NOT RUN: isolated Stripe profile already has credentials; recover existing configuration instead of creating another sandbox.');
  }
  const env:NodeJS.ProcessEnv={NODE_ENV:'development'};
  for (const name of ['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA']) env[name]=process.env[name];
  let output:string;
  try {
    const result=await promisify(execFile)(resolve('node_modules/@stripe/cli-win32-x64/bin/stripe.exe'),[
      '--config',config,'--project-name','palmsteeze','--color','off','sandbox','create','--email',email,'--non-interactive',
    ],{env,windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
    output=result.stdout+'\n'+result.stderr;
  } catch(error) {
    const e=error as {stdout?:string;stderr?:string};
    writeFileSync('.tools/private/stripe/provision-output.txt',(e.stdout||'')+'\n'+(e.stderr||''),{mode:0o600});
    throw new ReadinessError('NOT RUN: temporary sandbox provisioning requires recovery or interactive account login; private output saved under .tools/private/stripe/provision-output.txt, not printed.');
  }
  writeFileSync('.tools/private/stripe/provision-output.txt',output,{mode:0o600});
  const match=output.match(/\{[\s\S]*?"secret_key"[\s\S]*?\}/);
  if (!match) throw new ReadinessError('NOT RUN: no sandbox credential result; private output saved for interactive recovery.');
  const data=JSON.parse(match[0]);
  if (!/^rkcs_test_/.test(data.secret_key||'') || !/^acct_[A-Za-z0-9]+$/.test(data.account_id||'')) {
    throw new ReadinessError('FAILED: generated sandbox response did not match expected test-only account fields; credentials withheld.');
  }
  const claim=new URL(data.claim_url);
  if (claim.protocol!=='https:' || claim.hostname!=='dashboard.stripe.com' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(data.expires_at||'')) {
    throw new ReadinessError('FAILED: claim URL or returned expiry could not be verified; values withheld.');
  }
  writeFileSync('.tools/private/stripe/claim.json',JSON.stringify(data,null,2),{mode:0o600});
  savePrivateEnvironment({STRIPE_SECRET_KEY:data.secret_key,STRIPE_ACCOUNT_ID:data.account_id,PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED:'true'});
  console.log(`PASSED: temporary sandbox created from privately chosen email; generated credentials/claim URL stored only in ignored local files. Actual returned expiry: ${data.expires_at}.`);
  console.log('OWNER STEP: privately open .tools/private/stripe/claim.json, follow its claim_url in your browser before expiry, and complete truthful Stripe account signup/claim. After claiming, privately replace the temporary key with a permanent restricted sandbox key. No live activation or paid service required for this proof.');
}
main().catch(safeFailure);
