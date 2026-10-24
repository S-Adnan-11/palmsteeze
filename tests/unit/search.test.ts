import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canonicalOrigin,searchEnabled,searchablePaths} from '../../src/lib/search';
import {entranceExempt,publicAsset} from '../../src/lib/entrance';

test('only the exact canonical production deployment opts into search',()=>{
  assert.equal(searchEnabled({APP_ORIGIN:canonicalOrigin,VERCEL_ENV:'production'}),true);
  for(const env of [
    {APP_ORIGIN:canonicalOrigin,VERCEL_ENV:'preview'},
    {APP_ORIGIN:canonicalOrigin,VERCEL_ENV:'development'},
    {APP_ORIGIN:canonicalOrigin},
    {APP_ORIGIN:'https://palmsteeze.vercel.app',VERCEL_ENV:'production'},
    {APP_ORIGIN:'http://localhost:3000',VERCEL_ENV:'production'},
  ])assert.equal(searchEnabled(env),false);
});
test('search discovery exempts no protected application or mutation route',()=>{
  assert.deepEqual(searchablePaths,['/','/privacy','/cookies','/terms']);
  for(const path of ['/robots.txt','/sitemap.xml','/privacy','/cookies','/terms'])assert.equal(entranceExempt(path),true);
  for(const path of ['/account','/admin','/booking/review','/api/holds','/api/checkout','/robots.txt/checkout','/sitemap.xml/checkout']){
    assert.equal(entranceExempt(path),false);assert.equal(publicAsset(path),false);
  }
});
