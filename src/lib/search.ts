import type {Metadata} from 'next';
import {hostedOrigin} from '../../supabase/functions/_shared/application-origins';

export const canonicalOrigin=hostedOrigin;
export const searchablePaths=['/','/privacy','/cookies','/terms'] as const;
export const demoDescription='Explore a fictional coworking booking demo in Agege, Lagos, with desks, meeting rooms, Google sign-in and sandbox payments.';

// A configured production origin alone must never index a preview or tunnel.
export function searchEnabled(env:Record<string,string|undefined>) {
  return env.APP_ORIGIN===canonicalOrigin&&env.VERCEL_ENV==='production';
}
export function searchPage(path:typeof searchablePaths[number],title:string,description:string):Metadata {
  return {title,description,alternates:{canonical:canonicalOrigin+path},
    robots:{index:searchEnabled(process.env),follow:true},
    openGraph:{type:'website',siteName:'PalmSteeze',url:canonicalOrigin+path,title,description,images:[{url:canonicalOrigin+'/brand/v2/open-graph.png',width:1200,height:630,alt:'PalmSteeze — Find your work rhythm.'}]},
    twitter:{card:'summary_large_image',title,description,images:[canonicalOrigin+'/brand/v2/open-graph.png']}};
}
