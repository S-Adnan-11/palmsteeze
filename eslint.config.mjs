import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import next from '@next/eslint-plugin-next';
export default defineConfig([
  { files:['**/*.ts','**/*.tsx'],extends:[js.configs.recommended,...ts.configs.recommended],
    plugins:{'@next/next':next},rules:{...next.configs.recommended.rules,...next.configs['core-web-vitals'].rules} },
  globalIgnores(['.next/**', '.tools/**', '.npm-cache/**', '.playwright/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts']),
]);
