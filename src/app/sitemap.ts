import type {MetadataRoute} from 'next';
import {canonicalOrigin,searchablePaths,searchEnabled} from '@/lib/search';

export const dynamic='force-dynamic';
export default function sitemap():MetadataRoute.Sitemap {
  return searchEnabled(process.env)?searchablePaths.map(path=>({url:canonicalOrigin+path})):[];
}
