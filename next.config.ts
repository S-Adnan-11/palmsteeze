import type { NextConfig } from 'next';
import {developmentOrigins} from './src/lib/deployment';
const config: NextConfig = {
  allowedDevOrigins:developmentOrigins.map(origin=>new URL(origin).hostname),
  poweredByHeader:false,
  async headers() {
    return ['/','/verify','/privacy','/cookies','/terms','/account','/login','/booking/:path*','/admin/:path*','/auth/:path*','/api/:path*'].map((source) => ({source,headers:[
      {key:'Cache-Control',value:'private, no-store, no-cache, max-age=0, must-revalidate'},
      {key:'Vary',value:'Cookie, Authorization'},
      {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    ]}));
  },
};
export default config;
