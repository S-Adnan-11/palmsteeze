import {test,expect} from '@playwright/test';
import {capture,record,recording} from './targeted-artifacts';

// Shared popup regressions use a signed local UI-only entrance clearance.
test('workspace video autoplays without controls and respects visibility and reduced motion',async({page},info)=>{
  const section=page.locator('#workspace-story'),visual=section.locator('[data-story-visual]'),video=section.locator('video');
  await visual.scrollIntoViewIfNeeded();
  await expect(section.getByRole('button')).toHaveCount(0);
  expect(await video.evaluate((node:HTMLVideoElement)=>node.controls)).toBe(false);
  await expect(visual.locator('canvas')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(section).toHaveAttribute('data-motion','reduced');
  await expect(visual).toHaveAttribute('data-render-state','paused');
  await expect(video).toHaveAttribute('data-has-frame','false');
  const still=await video.evaluate((node:HTMLVideoElement)=>node.currentTime);await page.waitForTimeout(300);
  expect(await video.evaluate((node:HTMLVideoElement)=>node.currentTime)).toBe(still);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(section).toHaveAttribute('data-motion','time');
  await expect(visual).toHaveAttribute('data-render-state','playing');
  await expect.poll(()=>video.evaluate((node:HTMLVideoElement)=>node.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(1);
  await page.evaluate(()=>scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  await expect(visual).toHaveAttribute('data-render-state','paused');
  const offscreen=await video.evaluate((node:HTMLVideoElement)=>node.currentTime);await page.waitForTimeout(300);
  expect(await video.evaluate((node:HTMLVideoElement)=>node.currentTime)).toBe(offscreen);
  for(const width of [760,761,320,page.viewportSize()!.width]) {
    await page.setViewportSize({width,height:page.viewportSize()!.height});await visual.scrollIntoViewIfNeeded();
    await expect(visual).toHaveAttribute('data-render-state','playing');
    expect(await video.evaluate((node:HTMLVideoElement)=>node.muted&&node.playsInline&&node.loop&&!node.controls)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
  await capture(page,'workspace-video-no-controls',info);
  await section.getByRole('link',{name:'Choose your rhythm'}).click();await expect(page).toHaveURL(/#plan$/);
  await expect(page.locator('#plan')).toBeInViewport();
  record('video-no-controls-'+info.project.name+'.json',{kind:'Local browser with UI-only signed clearance',offscreenAndResume:true,reducedMotionPoster:true,noPlaybackControls:true,sectionAcceptance:'Owner accepted',accessibility:'No pause mechanism for continuing automatic motion; no full accessibility compliance claim'});
  await recording(page,'video-no-controls',info);
});
