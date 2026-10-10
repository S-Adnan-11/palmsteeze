import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import base from './playwright.config';

// These also belong to test workers, not only the web-server subprocess.
if(process.env.PALMSTEEZE_STRICT_ENTRANCE_REVIEW==='true') {
  process.env.PALMSTEEZE_REVIEW_ROOT='docs/evidence/m4-standardization/entrance';
  process.env.PALMSTEEZE_REVIEW_SCREENS='docs/screenshots/m4-standardization/regression';
}

export default defineConfig({
  ...base,
  testMatch:process.env.PALMSTEEZE_STRICT_ENTRANCE_REVIEW==='true'?'entrance.spec.ts':process.env.PALMSTEEZE_VISUAL_FIXTURES==='local-review'?'presentation-states.spec.ts':'standardization.spec.ts',
  outputDir:'test-results/m4-standardization',
  reporter:[['list'],['html',{open:'never',outputFolder:'docs/evidence/m4-standardization/browser-report'}]],
  use:{...base.use,trace:'off',screenshot:'off',launchOptions:{args:['--host-resolver-rules=MAP localhost 127.0.0.1']}},
  webServer:{
    ...(base.webServer as {command:string;url:string}),
    url:'http://127.0.0.1:3000/api/verification',
    env:{NEXT_TELEMETRY_DISABLED:'1',APP_ORIGIN:'http://localhost:3000',PALMSTEEZE_PROVIDER_FAULTS:'local-proof',PALMSTEEZE_REVIEW_ROOT:'docs/evidence/m4-standardization/entrance',PALMSTEEZE_REVIEW_SCREENS:'docs/screenshots/m4-standardization/regression',NODE_OPTIONS:`--require="${resolve('tests/browser/turnstile-provider-preload.cjs').replaceAll('\\','/')}" --require="${resolve('tests/browser/presentation-read-preload.cjs').replaceAll('\\','/')}"`},
  },
});
