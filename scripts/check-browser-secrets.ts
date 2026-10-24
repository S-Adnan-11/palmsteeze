import { readdirSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalEnvironment,ReadinessError,safeFailure } from './lib/database';

function files(directory:string):string[] {
  return readdirSync(directory,{withFileTypes:true}).flatMap((entry) => {
    const path = join(directory,entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
try {
  loadLocalEnvironment();
  const required = ['DATABASE_PASSWORD','SUPABASE_SECRET_KEY','SUPABASE_ACCESS_TOKEN'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new ReadinessError(`NOT RUN: populate ${missing.join(', ')} privately before the populated-secret browser check.`);
  const names=[...required,...['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','PALMSTEEZE_PAYMENT_WORKER_TOKEN','TURNSTILE_SECRET_KEY','PALMSTEEZE_SECURITY_SECRET'].filter(name=>Boolean(process.env[name]))];
  const secrets = names.flatMap((name) => {
    const value = process.env[name]!;
    return [value,encodeURIComponent(value),JSON.stringify(value).slice(1,-1)];
  });
  const assets = files('.next/static');
  if (!assets.length) throw new ReadinessError('NOT RUN: build the production application first.');
  for (const path of assets) {
    const content = readFileSync(path,'utf8');
    if (secrets.some((value) => content.includes(value))) throw new ReadinessError('FAILED: private credential material found in browser assets. Values and filenames withheld.');
  }
  console.log(`PASSED: ${assets.length} browser assets checked against ${names.length} populated private credentials and encoded variants; no matches. Values not logged.`);
} catch(error) {safeFailure(error);}
