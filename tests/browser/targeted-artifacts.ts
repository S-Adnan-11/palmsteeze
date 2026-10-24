import {existsSync,writeFileSync,copyFileSync,constants,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import type {Page,TestInfo} from '@playwright/test';

const configured=process.env.PALMSTEEZE_CAPTURE_ROOT;
if(!configured)throw new Error('Reserve a unique output directory before this capture suite.');
export const captureRoot=resolve(configured);
if(!captureRoot.startsWith(resolve('docs/evidence')+'\\')||!existsSync(join(captureRoot,'capture-run.json')))throw new Error('Reserved capture-run.json marker required.');
export function artifact(name:string) {
  if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('Invalid artifact name');
  const path=join(captureRoot,name);
  if(existsSync(path))throw new Error('Refusing to overwrite existing evidence: '+name);
  return path;
}
export function record(name:string,value:unknown) {writeFileSync(artifact(name),JSON.stringify(value,null,2),{flag:'wx'});}
export async function capture(page:Page,name:string,info:TestInfo) {
  await page.evaluate(()=>document.fonts.ready);
  writeFileSync(artifact(`${name}-${info.project.name}.png`),await page.screenshot(),{flag:'wx'});
}
export async function recording(page:Page,name:string,info:TestInfo) {
  const video=page.video();await page.close();if(!video)return;
  copyFileSync(await video.path(),artifact(`${name}-${info.project.name}.webm`),constants.COPYFILE_EXCL);
}
export function reserveCaptureRun(root:string) {
  // Used only by runners, before Playwright starts; test workers never reserve.
  mkdirSync(root);writeFileSync(join(root,'capture-run.json'),JSON.stringify({at:new Date().toISOString()}),{flag:'wx'});
}
