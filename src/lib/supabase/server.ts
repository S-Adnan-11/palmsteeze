import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { authCookieOptions } from '@/lib/auth/config';

const uncachedFetch:typeof fetch = (input,init) => fetch(input,{...init,cache:'no-store'});

export function publicConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url && !key) return null;
  if (!url || !key || !/^[a-z0-9]{20}$/.test(process.env.SUPABASE_PROJECT_REF || '')
      || url !== `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
      || process.env.PALMSTEEZE_DB_DEDICATED !== 'true' || process.env.PALMSTEEZE_DB_FREE_CONFIRMED !== 'true') {
    throw new Error('Incomplete or mismatched dedicated project configuration');
  }
  return {url,key};
}
export function publicClient() {
  const config = publicConfiguration();
  return config ? createClient(config.url,config.key,{global:{fetch:uncachedFetch},auth:{persistSession:false,autoRefreshToken:false}}) : null;
}
export async function sessionClient(writable = false) {
  const config = publicConfiguration();if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url,config.key,{global:{fetch:uncachedFetch},cookieOptions:authCookieOptions(),cookies:{
    getAll:() => store.getAll(),
    ...(writable ? {setAll:(items: {name:string;value:string;options:import('@supabase/ssr').CookieOptions}[]) => {
      items.forEach(({name,value,options}) => store.set(name,value,{...options,...authCookieOptions()}));
    }} : {}),
  }});
}
export async function customerSession() {
  try {
    const client = await sessionClient();if (!client) return null;
    const {data,error} = await client.auth.getUser();
    return error || !data.user ? null : {client,user:data.user};
  } catch {return null;}
}
export async function authenticatedContext(request: Request) {
  const config = publicConfiguration();
  if (!config) return null;
  const bearer = request.headers.get('authorization');
  if (bearer) {
    if (!bearer.startsWith('Bearer ')) return null;
    const client = createClient(config.url,config.key,{global:{fetch:uncachedFetch,headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error} = await client.auth.getUser(bearer.slice(7));
    return error || !data.user ? null : {client,user:data.user};
  }
  const client = await sessionClient(true);if (!client) return null;
  // getUser verifies the session with Auth; no trusted client-provided identity or role.
  const {data,error} = await client.auth.getUser();
  return error || !data.user ? null : {client,user:data.user};
}
export async function authenticatedClient(request:Request) {return (await authenticatedContext(request))?.client||null;}
