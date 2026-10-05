import { defineConfig,devices } from '@playwright/test';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const mode = process.env.PALMSTEEZE_BROWSER_MODE || (process.env.NEXT_PUBLIC_SUPABASE_URL ? 'live' : 'preview');
if (!['live','preview','unavailable','auth','payments','admin','portfolio','redesign'].includes(mode)) throw new Error('Unsupported browser verification mode.');
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:30000,
  testMatch:mode === 'redesign' ? ['portfolio.spec.ts','redesign.spec.ts','live.spec.ts','auth.spec.ts','payments.spec.ts','admin.spec.ts'] : mode === 'portfolio' ? 'portfolio.spec.ts' : mode === 'admin' ? 'admin.spec.ts' : mode === 'payments' ? 'payments.spec.ts' : mode === 'auth' ? 'auth.spec.ts' : mode === 'live' ? 'live.spec.ts' : mode === 'unavailable' ? 'unavailable.spec.ts' : 'smoke.spec.ts',
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:3000',channel:'chrome',actionTimeout:30000,trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},
    {name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},
  ],
  webServer:{
    command:`"${process.execPath}" node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000`,
    url:'http://127.0.0.1:3000',reuseExistingServer:false,timeout:60000,
    env:{NEXT_TELEMETRY_DISABLED:'1'},
  },
});
