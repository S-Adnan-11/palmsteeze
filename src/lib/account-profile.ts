import type {User} from '@supabase/supabase-js';

export type AccountProfile={name:string;email:string;avatar:string|null;initials:string};
function text(value:unknown,max:number) {
  return typeof value==='string'?[...value].filter(character=>character.charCodeAt(0)>31&&character.charCodeAt(0)!==127).join('').trim().slice(0,max):'';
}
export function safeGoogleAvatar(value:unknown):string|null {
  if(typeof value!=='string'||value.length>2048)return null;
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&url.hostname==='lh3.googleusercontent.com'&&!url.port&&!url.username&&!url.password&&!url.hash&&!url.search
      &&/^\/a(?:-)?\/[A-Za-z0-9_=-]+$/.test(url.pathname)?url.href:null;
  } catch {return null;}
}
// Call only with Auth getUser()'s verified response. Editable user_metadata is
// not a provider identity and cannot choose a remote image host or display name.
export function accountProfile(user:User):AccountProfile {
  const google=user.identities?.find(identity=>identity.provider==='google')?.identity_data;
  const name=text(google?.full_name||google?.name,160)||'PalmSteeze visitor';
  const email=text(user.email,320);
  const words=name.split(/\s+/).filter(Boolean);
  const initials=(words.length>1?Array.from(words[0])[0]+Array.from(words.at(-1)!)[0]:Array.from(name).slice(0,2).join('')).toLocaleUpperCase();
  return {name,email,initials,avatar:safeGoogleAvatar(google?.avatar_url||google?.picture)};
}
