// Exact development addresses. No wildcard tunnels, forwarded-host discovery,
// or caller-provided return URLs. Shared by Next and the payment worker.
export const developmentOrigins = [
  'http://localhost:3000',
  'https://4fs16bjg-3000.euw.devtunnels.ms',
] as const;

export const hostedOrigin = 'https://palmsteeze.devs.surf';
// One database and worker serve these owner-controlled environments. This is a
// backend destination list, never a grant for a hosted HTTP request's Host.
export const sharedServiceOrigins = [...developmentOrigins,hostedOrigin] as const;
export function paymentReturnOrigins(canonical:string):readonly string[] {
  return sharedServiceOrigins.some(value=>value===canonical)?sharedServiceOrigins:[canonical];
}

export function applicationOrigins(canonical:string,hosted=false):readonly string[] {
  return !hosted && developmentOrigins.some(value=>value===canonical)
    ? developmentOrigins : [canonical];
}
