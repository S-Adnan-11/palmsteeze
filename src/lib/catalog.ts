import 'server-only';
import { previewResources } from './fixtures';
import { workingDefaults, type Resource, type VenueSettings } from './domain';
import { publicClient } from './supabase/server';
export type Catalog = { source: 'preview' | 'live' | 'unavailable'; resources: Resource[]; settings: VenueSettings };
export async function getCatalog(): Promise<Catalog> {
  try {
    const client = publicClient();
    if (!client) return {source:'preview',resources:previewResources,settings:workingDefaults};
    const [resources,rates,settings] = await Promise.all([
      client.from('resources').select('id,code,name,kind,seats,description').eq('active',true).order('code'),
      client.from('resource_rates').select('resource_id,hourly_kobo,effective_at').lte('effective_at',new Date().toISOString()).order('effective_at',{ascending:false}),
      client.from('venue_settings').select('*').single(),
    ]);
    if (resources.error || rates.error || settings.error) return {source:'unavailable',resources:[],settings:workingDefaults};
    const current = new Map<string,number>();
    for (const rate of rates.data) if (!current.has(rate.resource_id)) current.set(rate.resource_id,Number(rate.hourly_kobo));
    return {source:'live',settings:settings.data as VenueSettings,resources:resources.data.filter((r) => current.has(r.id)).map((r) => ({...r,hourly_kobo:current.get(r.id)!}) as Resource)};
  } catch { return {source:'unavailable',resources:[],settings:workingDefaults}; }
}
