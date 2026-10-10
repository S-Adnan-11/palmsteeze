import {chromium} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

async function main(){
  const root=resolve(process.argv[2]||'');if(!existsSync(join(root,'run.json')))throw new Error('New run required');
  const output=join(root,'reference-video-'+Date.now()+'-'+randomUUID().slice(0,8));mkdirSync(output);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:850}});
    const data=readFileSync(process.argv[3]).toString('base64');
    await page.setContent('<style>body{margin:0;background:#ddd}video{max-width:1100px;max-height:850px}</style><video muted></video>');
    await page.evaluate(async data=>{const video=document.querySelector('video')!;video.src='data:video/mp4;base64,'+data;await new Promise<void>((resolve,reject)=>{video.onloadedmetadata=()=>resolve();video.onerror=()=>reject(new Error('Reference decoder failed'));});},data);
    const duration=await page.locator('video').evaluate(video=>(video as HTMLVideoElement).duration);
    for(let second=0;second<duration;second+=2){
      await page.locator('video').evaluate(async(node,second)=>{const video=node as HTMLVideoElement;await new Promise<void>(resolve=>{video.onseeked=()=>resolve();video.currentTime=second+.01;});},second);
      writeFileSync(join(output,`frame-${second}.png`),await page.screenshot(),{flag:'wx'});
    }
    writeFileSync(join(output,'metadata.json'),JSON.stringify({source:process.argv[3],duration,kind:'Owner-supplied reference, not a recreated historical application capture'},null,2),{flag:'wx'});
    console.log(output);
  }finally{await browser.close();}
}
void main().catch(()=>{console.error('Reference video decoding failed');process.exitCode=1;});
