import 'server-only';
import {headers} from 'next/headers';
import {requestAppOrigin} from './deployment';

// Server Components have headers rather than a Request. Apply the same boundary.
export async function currentAppOrigin() {
  return requestAppOrigin({headers:await headers()},process.env);
}
