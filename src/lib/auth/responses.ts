import 'server-only';
import { NextResponse } from 'next/server';
import { privateHeaders } from './config';
import {validatedAppOrigin} from '@/lib/deployment';
export function authRedirect(path:string,origin:string,status = 303) {
  validatedAppOrigin(origin,process.env);
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('\\')||[...path].some(character=>character.charCodeAt(0)<=32||character.charCodeAt(0)===127)) throw new Error('Unsafe redirect.');
  const destination = new URL(path,origin);
  if(destination.origin!==origin) throw new Error('Unsafe redirect.');
  destination.hash = '#'; // explicitly clear any provider-error fragment inherited by a redirect
  const response = NextResponse.redirect(destination,status);
  privateHeaders(response.headers);response.headers.set('Referrer-Policy','no-referrer');return response;
}
