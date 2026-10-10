'use client';
import {useEffect,useRef} from 'react';
import Image from 'next/image';
import {ArrowLink} from '@/components/arrow-link';
const scenes=[
  {title:'Arrive. Take a little breath.',text:'Step into a sunlit workspace. Leave a little room for the day ahead.',image:'hero',label:'01 · Arrive'},
  {title:'Settle into your own desk.',text:'A place to put your ideas down. Find your focus, at your own pace.',image:'quiet-studio',label:'02 · Settle'},
  {title:'Gather around a good idea.',text:'Move into a meeting room. Bring your people and the conversation together.',image:'grove',label:'03 · Gather'},
];

export function WorkspaceExperience() {
  const section=useRef<HTMLElement>(null);
  useEffect(()=>{
    const node=section.current;if(!node) return;
    const media=window.matchMedia('(min-width: 761px) and (prefers-reduced-motion: no-preference)');
    const sticky=node.querySelector<HTMLElement>('.experience-sticky');
    let frame:number|null=null;
    function paint() {
      frame=null;if(!node) return;
      if(!media.matches){node.dataset.motion='static';node.removeAttribute('style');node.querySelectorAll<HTMLElement>('.experience-layer').forEach(layer=>layer.removeAttribute('style'));return;}
      node.dataset.motion='scroll';
      const rect=node.getBoundingClientRect();
      // Use the actual pinned element, including wrapped text/font changes.
      // The complete sequence now runs within its sticky travel on small desktops.
      const top=sticky?parseFloat(getComputedStyle(sticky).top)||0:window.innerHeight*.1;
      const travel=Math.max(1,rect.height-(sticky?.offsetHeight||window.innerHeight*.76));
      const progress=Math.max(0,Math.min(1,(top-rect.top)/travel));
      node.style.setProperty('--experience-progress',String(progress));
      const blend=(start:number,end:number)=>{const t=Math.max(0,Math.min(1,(progress-start)/(end-start)));return t*t*(3-2*t);};
      const desk=blend(.18,.42);const room=blend(.64,.88);
      const index=room>=.5?2:desk>=.5?1:0;node.dataset.scene=String(index);
      node.querySelectorAll<HTMLElement>('.experience-layer').forEach((layer,i)=>{
        // Keep the preceding image opaque beneath the next: no dark dip between scenes.
        layer.style.opacity=String(i===0?1:i===1?desk:room);
        layer.style.transform='translateY('+((i/2-progress)*10)+'px) scale(1.025)';
      });
    }
    function schedule(){if(frame===null) frame=requestAnimationFrame(paint);}
    const observer=new ResizeObserver(schedule);observer.observe(node);if(sticky)observer.observe(sticky);
    paint();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);media.addEventListener('change',schedule);
    return()=>{observer.disconnect();if(frame!==null) cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);media.removeEventListener('change',schedule);};
  },[]);
  return <section ref={section} className="workspace-experience" aria-labelledby="experience-title" data-motion="static" data-scene="0"><div className="experience-sticky"><div className="experience-copy"><p className="eyebrow">Arrive · Settle · Gather</p><h2 id="experience-title">A little room.<br/><em>A whole new rhythm.</em></h2><ol className="experience-steps">{scenes.map((scene,i)=><li key={scene.image} data-step={i}><Image className="experience-static-image" src={'/spaces/'+scene.image+'.webp'} alt="" width={768} height={512} sizes="(max-width: 760px) 100vw, 33vw"/><span>{scene.label}</span><h3>{scene.title}</h3><p>{scene.text}</p></li>)}</ol><ArrowLink href="#plan">Choose your rhythm</ArrowLink><p className="experience-disclosure">Generated impressions of a fictional workspace.</p></div><div className="experience-images" aria-hidden="true">{scenes.map(scene=><div className="experience-layer" key={scene.image}><Image src={'/spaces/'+scene.image+'.webp'} alt="" width={768} height={512} sizes="55vw"/><span>{scene.label}</span></div>)}<div className="experience-track"><span/></div></div></div></section>;
}
