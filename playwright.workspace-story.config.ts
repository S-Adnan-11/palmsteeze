import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const root=process.env.PALMSTEEZE_CAPTURE_ROOT;
if(!root||!existsSync(resolve(root,'capture-run.json')))throw new Error('Fresh capture-run.json required.');
export default defineConfig({
  testDir:'./tests/browser',testMatch:['interaction-regression.spec.ts'],fullyParallel:false,workers:1,timeout:180000,
  outputDir:resolve(root,'playwright'),
  reporter:[['list'],['json',{outputFile:resolve(root,'results.json')}]],
  use:{baseURL:'http://localhost:3000',channel:'chrome',actionTimeout:20000,trace:'off',screenshot:'off',video:'on',launchOptions:{ignoreDefaultArgs:['--hide-scrollbars'],args:['--host-resolver-rules=MAP localhost 127.0.0.1']}},
  projects:[
    {name:'wide-desktop',use:{viewport:{width:1366,height:633},reducedMotion:'no-preference'}},
    {name:'reduced-motion',use:{viewport:{width:1366,height:633},reducedMotion:'reduce'}},
    {name:'desktop',use:{viewport:{width:800,height:600},reducedMotion:'no-preference'}},
    {name:'mobile',use:{viewport:{width:390,height:664},isMobile:true,hasTouch:true,reducedMotion:'no-preference'}},
  ],
});
