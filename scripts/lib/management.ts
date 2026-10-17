import { ReadinessError } from './database';
import {readFileSync} from 'node:fs';
export async function management(path:string,init:RequestInit={}) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/${path}`,{
    ...init,headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,...init.headers},signal:AbortSignal.timeout(30000)});
  if (!response.ok) {
    const permission=path.startsWith('secrets') ? 'Edge Function Secrets (Read-write)' : 'Edge Functions (Read-write)';
    throw new ReadinessError(`NOT RUN: ${init.method||'GET'} selected-project ${path.split('?')[0]} returned HTTP ${response.status}; response withheld. Required scoped permission: ${permission}.`);
  }
  return response;
}
export async function deployFunction(slug:string,source:string) {
  const body=new FormData();
  const sharedOrigins=slug==='palmsteeze-payments';
  body.append('metadata',JSON.stringify({name:slug,entrypoint_path:sharedOrigins?`${slug}/index.ts`:'index.ts',verify_jwt:false}));
  body.append('file',new Blob([source],{type:'application/typescript'}),sharedOrigins?`${slug}/index.ts`:'index.ts');
  if(sharedOrigins) body.append('file',new Blob([readFileSync('supabase/functions/_shared/application-origins.ts','utf8')],{type:'application/typescript'}),'_shared/application-origins.ts');
  await management(`functions/deploy?slug=${slug}`,{method:'POST',body});
}
