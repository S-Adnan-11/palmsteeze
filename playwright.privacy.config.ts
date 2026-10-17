import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import base from './playwright.config';
export default defineConfig({...base,testMatch:'privacy.spec.ts',use:{...base.use,launchOptions:{args:['--host-resolver-rules=MAP localhost 127.0.0.1']}},webServer:{
  ...(base.webServer as {command:string;url:string}),
  url:'http://localhost:3000/api/verification',
  env:{NEXT_TELEMETRY_DISABLED:'1',APP_ORIGIN:'http://localhost:3000',PALMSTEEZE_PROVIDER_FAULTS:'local-proof',
    NODE_OPTIONS:`--require="${resolve('tests/browser/turnstile-provider-preload.cjs').replaceAll('\\','/')}"`},
}});
