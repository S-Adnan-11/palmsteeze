import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {assertHostedEnvironment} from '../src/lib/deployment';
import {hostedOrigin} from '../supabase/functions/_shared/application-origins';

// Explicit application-only transfer. Never log request/response bodies or
// import .env.local wholesale into hosting. CLI authentication stays in memory.
async function main() {
  const link=JSON.parse(readFileSync('.vercel/project.json','utf8'));
  if(link.projectName!=='palmsteeze')throw new Error('Wrong linked project');
  const auth=JSON.parse(readFileSync(join(process.env.APPDATA!,'com.vercel.cli','Data','auth.json'),'utf8'));
  if(!auth.token)throw new Error('Authorize the pinned Vercel CLI first');
  const local=parseEnv(readFileSync('.env.local','utf8'));
  const hosted=existsSync('.env.hosted.local')?parseEnv(readFileSync('.env.hosted.local','utf8')):{};
  const names=['APP_ORIGIN','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_PROJECT_REF','PALMSTEEZE_DB_DEDICATED','PALMSTEEZE_DB_FREE_CONFIRMED','PALMSTEEZE_PAYMENT_WORKER_TOKEN','PALMSTEEZE_SECURITY_SECRET','PALMSTEEZE_TURNSTILE_TEST_MODE','NEXT_PUBLIC_TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY'];
  const values:Record<string,string|undefined>={};
  for(const name of names)values[name]=name.includes('TURNSTILE')?hosted[name]:local[name];
  values.APP_ORIGIN=hostedOrigin;values.PALMSTEEZE_TURNSTILE_TEST_MODE='false';
  const missing=names.filter(name=>!values[name]);
  if(!missing.length)assertHostedEnvironment(values);
  const api=async(path:string,init:RequestInit={})=>{
    const response=await fetch('https://api.vercel.com'+path+(path.includes('?')?'&':'?')+'teamId='+link.orgId,{...init,headers:{Authorization:'Bearer '+auth.token,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('Selected-project API returned HTTP '+response.status+'; response withheld');return response;
  };
  const team=await (await api('/v2/teams/'+link.orgId)).json();
  if(team.billing?.plan!=='hobby'||team.billing?.status!=='active'||team.billing?.trial)throw new Error('Active nontrial Hobby plan required');
  const envs=names.filter(name=>values[name]).map(key=>({key,value:values[key],type:['PALMSTEEZE_PAYMENT_WORKER_TOKEN','PALMSTEEZE_SECURITY_SECRET','TURNSTILE_SECRET_KEY'].includes(key)?'sensitive':'plain',target:['production']}));
  if(process.argv[2]==='apply')await api('/v10/projects/'+link.projectId+'/env?upsert=true',{method:'POST',body:JSON.stringify(envs)});
  const configured=await (await api('/v9/projects/'+link.projectId+'/env')).json();
  const report={at:new Date().toISOString(),project:link.projectName,plan:'hobby',trial:false,origin:hostedOrigin,configured:(configured.envs||[]).map((entry:{key:string;type:string;target:string[]})=>({key:entry.key,type:entry.type,target:entry.target})),missing,hostedPreflight:missing.length?'NOT READY':'PASSED',valuesLogged:false,publicationPerformed:false};
  mkdirSync('docs/evidence/m5-release-20261017',{recursive:true});writeFileSync('docs/evidence/m5-release-20261017/hosting-env-'+Date.now()+'.json',JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Hosted configuration stopped; account/configuration details withheld. Verify CLI login, active Hobby and hosted template.');process.exitCode=1;});
