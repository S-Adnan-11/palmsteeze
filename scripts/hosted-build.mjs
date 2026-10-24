import { spawnSync } from 'node:child_process';
import { assertHostedEnvironment,assertHostedNode } from '../src/lib/deployment.ts';

try {
  assertHostedNode(process.versions.node);
  assertHostedEnvironment(process.env);
  console.log(`Hosted preflight passed: Node ${process.versions.node}; canonical HTTPS origin; dedicated sandbox configuration. Values withheld.`);
  const result = spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{
    stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Hosted configuration preflight failed.');
  process.exitCode = 1;
}
