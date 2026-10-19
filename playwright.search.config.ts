import {defineConfig} from '@playwright/test';
import entrance from './playwright.entrance.config';

const root=process.env.PALMSTEEZE_RELEASE_ROOT;
if(!root)throw new Error('Use a new private evidence directory.');
export default defineConfig({...entrance,
  testMatch:['homepage-verification.spec.ts','entrance.spec.ts','search.spec.ts'],
  grepInvert:/genuine widget investigation/,
  outputDir:root+'/test-results',
  reporter:[['list'],['json',{outputFile:root+'/results.json'}]],
});
