import {defineConfig,devices} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const root=process.env.PALMSTEEZE_CAPTURE_ROOT;
if(!root||!existsSync(resolve(root,'capture-run.json')))throw new Error('Run requires a newly reserved capture directory.');
export default defineConfig({
  testDir:'./tests/browser',testMatch:['targeted.spec.ts','interaction-regression.spec.ts'],fullyParallel:false,workers:1,timeout:90000,
  outputDir:resolve(root,'playwright'),
  reporter:[['list'],['html',{open:'never',outputFolder:resolve(root,'browser-report')}]],
  use:{baseURL:'http://localhost:3000',channel:'chrome',actionTimeout:20000,trace:'off',screenshot:'off',video:'off',launchOptions:{ignoreDefaultArgs:['--hide-scrollbars'],args:['--host-resolver-rules=MAP localhost 127.0.0.1']}},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000},reducedMotion:'no-preference'}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium',reducedMotion:'no-preference'}}],
  webServer:{command:`"${process.execPath}" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000`,url:'http://localhost:3000/api/verification',reuseExistingServer:process.env.PALMSTEEZE_REUSE_LOCAL_TEST_SERVER==='true',timeout:60000,env:{NEXT_TELEMETRY_DISABLED:'1',APP_ORIGIN:'http://localhost:3000'}},
});
