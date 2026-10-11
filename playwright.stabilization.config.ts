import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import base from './playwright.targeted.config';

// All evidence is scoped by the fresh capture-run marker in the base config.
// Use the separately rebuilt genuine-key server, never replace its environment.
export default defineConfig({
  ...base,
  testMatch:['interaction-regression.spec.ts','stabilization.spec.ts','targeted.spec.ts'],
  reporter:[...(base.reporter as []),['json',{outputFile:resolve(process.env.PALMSTEEZE_CAPTURE_ROOT!,'results.json')}]],
  projects:base.projects?.map(project=>({...project,use:{...project.use,reducedMotion:undefined}})),
  webServer:undefined,
});
