'use client';

import {useEffect,useRef} from 'react';
import Image from 'next/image';
import {ArrowLink} from '@/components/arrow-link';
import styles from './workspace-experience.module.css';

const scenes=[
  {title:'Arrive. Take a little breath.',text:'Step into a sunlit workspace. Leave a little room for the day ahead.',image:'hero',label:'01 · Arrive'},
  {title:'Settle into your own desk.',text:'A place to put your ideas down. Find your focus, at your own pace.',image:'quiet-studio',label:'02 · Settle'},
  {title:'Gather around a good idea.',text:'Move into a meeting room. Bring your people and the conversation together.',image:'grove',label:'03 · Gather'},
];

// A paused Web Animation is a reversible set of keyframes, not a timer.
// One scroll position scrubs all images and highlights on the same timeline.
const offsets=[0,.18,.42,.58,.82,1];
const highlights=[[1,1,0,0,0,0],[0,0,1,1,0,0],[0,0,0,0,1,1]];

export function WorkspaceExperience() {
  const section=useRef<HTMLElement>(null);
  useEffect(()=>{
    const node=section.current!;
    const panel=node.querySelector<HTMLElement>('[data-story-panel]')!;
    const layers=[...node.querySelectorAll<HTMLElement>('[data-story-scene]')];
    const stages=[...node.querySelectorAll<HTMLElement>('[data-story-stage]')];
    const media=matchMedia('(min-width: 761px) and (prefers-reduced-motion: no-preference)');
    let animations:Animation[]=[];
    let frame=0;
    let start=0;
    let distance=1;
    let active=-1;

    function render() {
      frame=0;
      if(!media.matches)return;
      const progress=Math.max(0,Math.min(1,(scrollY-start)/distance));
      for(const animation of animations)animation.currentTime=progress*1000;
      const next=progress<.3?0:progress<.7?1:2;
      if(next!==active) {
        stages.forEach((stage,index)=>index===next?stage.setAttribute('aria-current','step'):stage.removeAttribute('aria-current'));
        active=next;
      }
    }
    function schedule() {if(!frame)frame=requestAnimationFrame(render);}
    function measure() {
      // Sticky entry and release define the timeline. No wheel interception,
      // synthetic scrolling, stateful direction tracking, or timed playback.
      start=scrollY+node.getBoundingClientRect().top-parseFloat(getComputedStyle(panel).top);
      distance=Math.max(1,node.offsetHeight-panel.offsetHeight);
      schedule();
    }
    function configure() {
      animations.forEach(animation=>animation.cancel());
      animations=[];
      active=-1;
      stages.forEach(stage=>stage.removeAttribute('aria-current'));
      node.dataset.motion=media.matches?'scroll':'static';
      if(!media.matches)return;
      const scrub=(element:HTMLElement,keyframes:Keyframe[])=>{
        const animation=element.animate(keyframes,{duration:1000,fill:'both'});
        animation.pause();
        animation.currentTime=0;
        animations.push(animation);
      };
      layers.forEach((layer,index)=>{
        const opacity=index===0?[1,1,1,1,1,1]:index===1?[0,0,1,1,1,1]:[0,0,0,0,1,1];
        scrub(layer,offsets.map((offset,key)=>({offset,opacity:opacity[key]})));
        scrub(layer.querySelector('img')!,[
          {transform:'translateY(4px) scale(1.025)'},
          {transform:'translateY(-4px) scale(1.025)'},
        ]);
      });
      stages.forEach((stage,index)=>scrub(stage,offsets.map((offset,key)=>({
        offset,
        backgroundColor:`rgba(231, 235, 220, ${highlights[index][key]*.5})`,
        borderLeftColor:`rgba(23, 61, 50, ${highlights[index][key]})`,
      }))));
      measure();
    }
    const observer=new ResizeObserver(measure);
    observer.observe(node);observer.observe(panel);
    configure();
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',measure);
    media.addEventListener('change',configure);
    return()=>{
      observer.disconnect();cancelAnimationFrame(frame);
      animations.forEach(animation=>animation.cancel());
      window.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',measure);
      media.removeEventListener('change',configure);
    };
  },[]);

  return <section id="workspace-story" ref={section} className={`${styles.section} workspace-experience`} aria-labelledby="experience-title" data-motion="static">
    <div className={styles.panel} data-story-panel>
      <div className={styles.copy}>
        <p className="eyebrow">Arrive · Settle · Gather</p>
        <h2 id="experience-title">A little room.<br/><em>A whole new rhythm.</em></h2>
        <ol className={styles.stages}>
          {scenes.map((scene,index)=><li className={styles.stage} key={scene.image} data-story-stage={index}>
            <Image className={styles.staticImage} data-story-static src={'/spaces/'+scene.image+'.webp'} alt="" width={768} height={512} sizes="(max-width: 760px) 100vw, 33vw"/>
            <span>{scene.label}</span><h3>{scene.title}</h3><p>{scene.text}</p>
          </li>)}
        </ol>
        <ArrowLink href="#plan">Choose your rhythm</ArrowLink>
        <p className={styles.disclosure}>Generated impressions of a fictional workspace.</p>
      </div>
      <div className={styles.visual} data-story-visual aria-hidden="true">
        {scenes.map((scene,index)=><div className={styles.scene} data-story-scene={index} key={scene.image}>
          <Image src={'/spaces/'+scene.image+'.webp'} alt="" width={768} height={512} sizes="55vw"/>
          <span>{scene.label}</span>
        </div>)}
      </div>
    </div>
  </section>;
}
