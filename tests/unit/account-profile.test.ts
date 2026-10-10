import assert from 'node:assert/strict';
import test from 'node:test';
import type {User} from '@supabase/supabase-js';
import {accountProfile,safeGoogleAvatar} from '../../src/lib/account-profile';

test('profile uses a verified Google identity response, never editable user metadata',()=>{
  const user:User={id:'fixture',aud:'authenticated',created_at:'2026-10-10',app_metadata:{},email:'fixture@palmsteeze.invalid',user_metadata:{full_name:'Spoofed name',avatar_url:'https://evil.invalid/a'}};
  assert.equal(accountProfile(user).name,'PalmSteeze visitor');
  user.identities=[{id:'google-fixture',user_id:'fixture',identity_id:'identity-fixture',provider:'google',identity_data:{full_name:'Ada Example',avatar_url:'https://lh3.googleusercontent.com/a/example=s96-c'}}];
  assert.deepEqual(accountProfile(user),{name:'Ada Example',email:user.email,initials:'AE',avatar:'https://lh3.googleusercontent.com/a/example=s96-c'});
});
test('untrusted avatar inputs are restricted to direct Google profile images',()=>{
  for(const url of ['http://lh3.googleusercontent.com/a/x','https://lh3.googleusercontent.com.evil.invalid/a/x','https://evil.invalid/a/x','https://user@lh3.googleusercontent.com/a/x','https://lh3.googleusercontent.com:444/a/x','https://lh3.googleusercontent.com/a/x?redirect=https://evil.invalid','data:image/png;base64,x','https://lh3.googleusercontent.com/redirect/x','https://lh3.googleusercontent.com/a/../x'])assert.equal(safeGoogleAvatar(url),null,url);
  assert.ok(safeGoogleAvatar('https://lh3.googleusercontent.com/a-/example_123=s96-c'));
});
