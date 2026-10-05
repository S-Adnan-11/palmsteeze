import 'server-only';
import { NextResponse } from 'next/server';
import { appOrigin,privateHeaders } from './config';
export function authRedirect(path:string,status = 303) {
  const destination = new URL(path,appOrigin());
  destination.hash = '#'; // explicitly clear any provider-error fragment inherited by a redirect
  const response = NextResponse.redirect(destination,status);
  privateHeaders(response.headers);response.headers.set('Referrer-Policy','no-referrer');return response;
}
