import {chromium} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

async function main() {
  const root=resolve(process.argv[2]||'');
  if(!existsSync(join(root,'run.json')))throw new Error('New evidence run required');
  const currentRecording=resolve(process.argv[3]).startsWith(root+'\\');
  const output=join(root,(currentRecording?'recording-timeline-':'reference-timeline-')+randomUUID().slice(0,8));mkdirSync(output);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<video muted></video>');
    const metadata=await page.evaluate(async({data,type})=>{
      const video=document.querySelector('video')!;video.src='data:'+type+';base64,'+data;
      await new Promise<void>((done,fail)=>{video.onloadeddata=()=>done();video.onerror=()=>fail(new Error('Cannot decode reference'));});
      return {duration:video.duration,width:video.videoWidth,height:video.videoHeight};
    },{data:readFileSync(process.argv[3]).toString('base64'),type:process.argv[3].endsWith('.webm')?'video/webm':'video/mp4'});
    for(let start=0;start<metadata.duration;start+=2) {
      const encoded=await page.evaluate(async({start,duration,height})=>{
        const video=document.querySelector('video')!;
        const canvas=document.createElement('canvas');canvas.width=1508;canvas.height=(height+25)*5;
        const pen=canvas.getContext('2d')!;pen.fillStyle='#fff';pen.fillRect(0,0,canvas.width,canvas.height);
        for(let frame=0;frame<20;frame++) {
          const time=start+frame*.1+.001;if(time>=duration)break;
          await new Promise<void>(done=>{video.onseeked=()=>done();video.currentTime=time;});
          const x=frame%4*377,y=Math.floor(frame/4)*(height+25);
          pen.drawImage(video,x,y+25,377,height);pen.fillStyle='#111';pen.font='16px monospace';pen.fillText(time.toFixed(1)+'s',x+8,y+18);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },{start,duration:metadata.duration,height:Math.round(metadata.height/metadata.width*377)});
      writeFileSync(join(output,`timeline-${String(start).padStart(2,'0')}.png`),Buffer.from(encoded,'base64'),{flag:'wx'});
    }
    writeFileSync(join(output,'reference.json'),JSON.stringify({...metadata,stepSeconds:.1,source:process.argv[3],kind:currentRecording?'Decoded current application recording; not historical recovery':'Decoded owner reference; not historical application recovery'},null,2),{flag:'wx'});
    console.log(output);
  } finally {await browser.close();}
}
void main().catch(error=>{console.error(error.message);process.exitCode=1;});
