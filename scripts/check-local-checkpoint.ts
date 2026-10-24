import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {loadLocalEnvironment} from './lib/database';

async function main() {
  const root=resolve(process.argv[2]||'');
  if(!existsSync(join(root,'run.json')))throw new Error('Unique run required');
  loadLocalEnvironment();
  const git=(...args:string[])=>{
    const result=spawnSync('git',args,{maxBuffer:60*1024*1024});
    if(result.status!==0)throw new Error('Git read failed; output withheld');
    return result.stdout;
  };
  const names=['DATABASE_PASSWORD','SUPABASE_SECRET_KEY','SUPABASE_ACCESS_TOKEN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','PALMSTEEZE_PAYMENT_WORKER_TOKEN','TURNSTILE_SECRET_KEY','PALMSTEEZE_SECURITY_SECRET','GOOGLE_CLIENT_SECRET','PALMSTEEZE_OWNER_ADMIN_EMAIL','PALMSTEEZE_OWNER_ADMIN_USER_ID'];
  const values=names.flatMap(name=>process.env[name]?[process.env[name]!,encodeURIComponent(process.env[name]!),JSON.stringify(process.env[name]).slice(1,-1)]:[]);
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1000`,{headers:{apikey:process.env.SUPABASE_SECRET_KEY!,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Identity read failed; response withheld');
  const users=(await response.json()).users as {id:string;email?:string}[];
  values.push(...users.flatMap(user=>[user.id,user.email].filter(Boolean) as string[]));
  const forbidden=/(^|\/)(\.env(?!\.example$)|\.tools|\.local-brand-kit|docs|reviews|test-results|playwright-report)(\/|$)|\.(zip|pem|crt)$/i;
  const suspect=/(?:sk|rk|rkcs)_(?:live|test)_[A-Za-z0-9]{24,}|whsec_[A-Za-z0-9]{24,}|sb_secret_[A-Za-z0-9_-]{24,}|sbp_[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  let files=0,blobs=0;
  function scan(data:Buffer,path:string) {
    if(forbidden.test(path)||values.some(value=>value.length>=8&&data.includes(Buffer.from(value)))||suspect.test(data.toString('utf8')))throw new Error('Possible private artifact or secret; values withheld');
  }
  for(const path of git('ls-files','--cached','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean)) {
    if(!existsSync(path))continue;
    scan(readFileSync(path),path);files++;
  }
  for(const line of git('rev-list','--objects','--all').toString().split('\n').filter(Boolean)) {
    const split=line.indexOf(' ');if(split<0)continue;
    const id=line.slice(0,split),path=line.slice(split+1);
    if(git('cat-file','-t',id).toString().trim()!=='blob')continue;
    scan(git('cat-file','blob',id),path);blobs++;
  }
  for(const id of ['1c8ed14','7c0d832','0e0becf'])git('cat-file','-e',id+'^{commit}');
  const result={at:new Date().toISOString(),status:'passed',workingFiles:files,historyBlobs:blobs,populatedPrivateNames:names.filter(name=>process.env[name]).length,actualIdentitiesScanned:users.length,valuesLogged:false,checkpointsPreserved:['1c8ed14','7c0d832','0e0becf']};
  writeFileSync(join(root,'checkpoint-scan-'+Date.now()+'.json'),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify(result));
}
void main().catch(()=>{console.error('Checkpoint scan failed; private details withheld.');process.exitCode=1;});
