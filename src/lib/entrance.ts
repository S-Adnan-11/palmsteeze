const publicPages=new Set(['/privacy','/cookies','/terms','/verify','/robots.txt','/sitemap.xml']);
const publicEndpoints=new Set(['/api/verification','/api/preferences','/auth/callback','/auth/sign-out']);
export function entranceExempt(path:string) {
  if(publicPages.has(path)||publicEndpoints.has(path)) return true;
  return publicAsset(path);
}
// Static assets have no account, mutation or clearance authority. Next's image
// optimizer fetches these internally without forwarding request Host headers.
export function publicAsset(path:string) {
  if(path==='/favicon.ico'||path==='/_next/image'||path==='/_next/webpack-hmr'||path.startsWith('/_next/static/')) return true;
  if(/^\/art\/workspace-video\/workspace-(?:desktop|tablet|mobile)\.mp4$/.test(path)) return true;
  if(/^\/licenses\/[a-zA-Z0-9_-]+\.txt$/.test(path)) return true;
  return /^\/(?:brand|spaces|fonts|art)\/[a-zA-Z0-9_/-]+\.(?:svg|png|ico|webp|woff2?|txt|json)$/.test(path)
    ||path==='/auth/google-g.png';
}
export function entranceDestination(value:unknown):string|null {
  if(typeof value!=='string'||value.length>1500||value!==value.trim()||!value.startsWith('/')||value.startsWith('//')
    ||value.includes('\\')||[...value].some(character=>character.charCodeAt(0)<=32||character.charCodeAt(0)===127)
    ||/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value.split('?')[0])) return null;
  const url=new URL(value,'https://application.invalid');
  if(url.origin!=='https://application.invalid'||value.split(/[?#]/)[0]!==url.pathname||url.pathname==='/verify'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/')) return null;
  if(!['/','/login','/account','/portfolio','/preview/admin','/privacy','/cookies','/terms'].includes(url.pathname)
    &&!/^\/(?:booking|admin)(?:\/[a-zA-Z0-9-]+)*$/.test(url.pathname)) return null;
  return url.pathname+url.search+url.hash;
}
