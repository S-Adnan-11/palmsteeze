import type {MetadataRoute} from 'next';
import {canonicalOrigin,searchEnabled} from '@/lib/search';

export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots {
  if(!searchEnabled(process.env))return {rules:{userAgent:'*',disallow:'/'}};
  // Let crawlers read noindex on utility pages. These rules are not access control.
  return {rules:{userAgent:'*',allow:'/',disallow:['/api/','/auth/','/account','/admin','/booking/','/preview/','/portfolio','/docs/','/reviews/','/*?']},sitemap:canonicalOrigin+'/sitemap.xml'};
}
