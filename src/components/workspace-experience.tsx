'use client';

import {useEffect, useRef, useState} from 'react';
import {ArrowLink} from '@/components/arrow-link';
import styles from './workspace-experience.module.css';

export function WorkspaceExperience() {
  const visual = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('loading');
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const host = visual.current!;
    const player = video.current!;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const desktop = matchMedia('(min-width: 1100px)');
    const tablet = matchMedia('(min-width: 761px)');
    const section = host.closest('section')!;
    let disposed = false;
    let visible = false;
    let near = false;
    let blocked = false;
    let failed = false;
    let pending = false;
    let generation = 0;
    let asset = '';
    let restoreTime = 0;
    let viewportWidth = 0;
    player.muted = true;
    const canPlay = () => !disposed && !failed && !blocked &&
      !preference.matches && visible && !document.hidden;
    const sizeViewport = () => {
      const width = document.documentElement.getBoundingClientRect().width;
      if (width === viewportWidth) return;
      viewportWidth = width;
      section.style.setProperty('--workspace-viewport', `${width}px`);
    };
    const selectAsset = () => {
      const next = desktop.matches ? 'desktop' : tablet.matches ? 'tablet' : 'mobile';
      player.poster = `/art/workspace-video/workspace-${next}-poster.webp`;
      // Reduced motion and rejected autoplay keep the matching poster. A
      // rejection stays latched for this mount, including resize/tab changes.
      if (blocked || failed || (!near && !visible) || preference.matches || document.hidden || next === asset) return;
      restoreTime = asset ? player.currentTime : 0;
      asset = next;
      generation++;
      pending = false;
      setHasFrame(false);
      setStatus('loading');
      player.src = `/art/workspace-video/workspace-${next}.mp4`;
      player.load();
    };
    const sync = () => {
      if (disposed) return;
      selectAsset();
      if (!canPlay()) {
        generation++;
        pending = false;
        player.pause();
        setPlaying(false);
        if (preference.matches) setHasFrame(false);
        return;
      }
      if (!asset || pending || !player.paused) return;
      const attempt = ++generation;
      pending = true;
      void player.play().then(() => {
        if (disposed || generation !== attempt) return;
        pending = false;
        if (!canPlay()) player.pause();
      }).catch(error => {
        if (disposed) return;
        if (error?.name === 'AbortError') {
          if (generation === attempt) pending = false;
          return;
        }
        // A denial is terminal for this mount even if visibility changed while
        // play() was pending. It must not become a retry loop on return.
        blocked = true;
        generation++;
        pending = false;
        player.pause();
        setHasFrame(false);
        setStatus('blocked');
        setPlaying(false);
      });
    };
    const onPlaying = () => {
      if (!canPlay()) {player.pause(); return;}
      setStatus('ready');
      setHasFrame(true);
      setPlaying(true);
    };
    const onPause = () => {if (!disposed) setPlaying(false);};
    const onMetadata = () => {
      if (restoreTime > 0 && Number.isFinite(player.duration)) player.currentTime = restoreTime % player.duration;
      restoreTime = 0;
    };
    const onData = () => {if (!blocked && !preference.matches) {setHasFrame(true); setStatus('ready');}};
    const onError = () => {
      if (disposed || !asset) return;
      failed = true;
      generation++;
      player.pause();
      setHasFrame(false);
      setStatus('failed');
      setPlaying(false);
    };
    const changePreference = () => {
      setReduced(preference.matches);
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= .05;
      sync();
    }, {threshold: [0, .05]});
    const preparationObserver = new IntersectionObserver(([entry]) => {
      near = entry.isIntersecting;
      sync();
    }, {rootMargin: '160px 0px'});
    const viewportObserver = new ResizeObserver(sizeViewport);
    viewportObserver.observe(document.documentElement);
    sizeViewport();
    setReduced(preference.matches);
    setStatus('ready');
    selectAsset();
    observer.observe(host);
    preparationObserver.observe(host);
    preference.addEventListener('change', changePreference);
    desktop.addEventListener('change', sync);
    tablet.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', sync);
    function onPageHide() {generation++; pending = false; player.pause();}
    player.addEventListener('playing', onPlaying);
    player.addEventListener('pause', onPause);
    player.addEventListener('loadedmetadata', onMetadata);
    player.addEventListener('loadeddata', onData);
    player.addEventListener('error', onError);
    return () => {
      disposed = true;
      generation++;
      observer.disconnect();
      preparationObserver.disconnect();
      viewportObserver.disconnect();
      preference.removeEventListener('change', changePreference);
      desktop.removeEventListener('change', sync);
      tablet.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', sync);
      player.removeEventListener('playing', onPlaying);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('loadedmetadata', onMetadata);
      player.removeEventListener('loadeddata', onData);
      player.removeEventListener('error', onError);
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, []);

  return <section id="workspace-story" className={`${styles.section} workspace-experience`}
    aria-labelledby="experience-title" data-motion={reduced ? 'reduced' : 'time'} data-scene-status={status}>
    <div className={styles.copy}>
      <p className="eyebrow">Arrive · Settle · Gather</p>
      <h2 id="experience-title">A little room<br/>to <em>breathe.</em></h2>
      <p className={styles.introduction}>Through the palms. Into your flow.<br/>A quieter start to a good workday.</p>
      <ol className={styles.stages} aria-label="The camera journey">
        <li><span>01</span> A moment to arrive</li>
        <li><span>02</span> A place to settle</li>
        <li><span>03</span> Room to come together</li>
      </ol>
      <ArrowLink href="#plan">Choose your rhythm</ArrowLink>
      <p className={styles.disclosure}>An original 3D impression of the imagined workspace.</p>
    </div>
    <figure className={styles.figure}>
      <div ref={visual} className={styles.visual} data-story-visual data-render-state={playing ? 'playing' : 'paused'} role="img"
        aria-label="A camera moves through palm foliage, past a timber desk and green chair, into a warm communal workspace.">
        <picture aria-hidden="true">
          <source media="(min-width: 1100px)" srcSet="/art/workspace-video/workspace-desktop-poster.webp"/>
          <source media="(min-width: 761px)" srcSet="/art/workspace-video/workspace-tablet-poster.webp"/>
          {/* Original rendered still, with the same aspect and camera as the movie. */}
          <img src="/art/workspace-video/workspace-mobile-poster.webp" alt="" width="704" height="864" loading="lazy"/>
        </picture>
        <video ref={video} id="workspace-video" muted playsInline loop controls={false} preload="none" aria-hidden="true"
          tabIndex={-1} data-has-frame={hasFrame ? 'true' : 'false'}/>
      </div>
      <div className={styles.frameLabel} aria-hidden="true"><span>IN A MOMENT</span><span> </span></div>
      <figcaption className={styles.caption}>
        <span>{reduced ? 'Still view · reduced motion' : 'Take a breath. Stay a while.'}</span>
      </figcaption>
    </figure>
  </section>;
}
