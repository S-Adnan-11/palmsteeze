import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader:false,
  async headers() {
    return ['/','/account','/login','/booking/:path*','/admin/:path*','/auth/:path*','/api/:path*'].map((source) => ({source,headers:[
      {key:'Cache-Control',value:'private, no-store, no-cache, max-age=0, must-revalidate'},
      {key:'Vary',value:'Cookie, Authorization'},
      {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    ]}));
  },
};
export default config;
