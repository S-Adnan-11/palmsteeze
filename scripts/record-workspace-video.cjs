/* Separate fault/recording proof: never used as the animation asset or benchmark. */
const fs = require('node:fs'), path = require('node:path');
const {createHmac, randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve('.playwright');
const {chromium, expect} = require('@playwright/test');
process.loadEnvFile('.env.local');
const root = path.join(path.resolve(process.argv[2]), 'playback-recordings-' + randomUUID().slice(0, 8));
const ffmpeg = path.resolve(process.argv[3]);
fs.mkdirSync(root);
const base = 'http://localhost:3000';
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), {flag: 'wx'});
function clearance() {
  const iat = Math.floor(Date.now() / 1000), payload = Buffer.from(JSON.stringify({v: 1, purpose: 'clearance', origin: base, iat, exp: iat + 1800, nonce: randomUUID()})).toString('base64url');
  return payload + '.' + createHmac('sha256', process.env.PALMSTEEZE_SECURITY_SECRET).update('palmsteeze-clearance-v1.' + payload).digest('hex');
}
async function contextFor(browser, options) {
  const context = await browser.newContext(options);
  await context.addCookies([{name: 'ps-clearance', value: clearance(), url: base, httpOnly: true, sameSite: 'Lax'}]);
  return context;
}
async function visit(context) {
  const page = await context.newPage(); await page.goto(base); await page.evaluate(() => document.fonts.ready);
  const necessary = page.getByRole('button', {name: 'Necessary only', exact: true}); if (await necessary.isVisible()) await necessary.click();
  await page.locator('[data-story-visual]').evaluate(node => scrollTo({top: scrollY + node.getBoundingClientRect().top - 20, behavior: 'instant'}));
  return page;
}
async function main() {
  const browser = await chromium.launch({channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--host-resolver-rules=MAP localhost 127.0.0.1']});
  try {
    for (const [width, height] of [[1366, 900], [390, 844]]) {
      const options = {viewport: {width, height}, isMobile: width === 390, hasTouch: width === 390, reducedMotion: 'no-preference'};
      const context = await contextFor(browser, {...options, recordVideo: {dir: path.join(root, 'raw-' + width), size: {width, height}}});
      const page = await visit(context), video = page.locator('#workspace-video');
      await expect.poll(() => video.evaluate(node => !node.paused && node.readyState >= 2)).toBe(true);
      await video.evaluate(async node => {
        node.pause(); node.currentTime = 0;
        await new Promise(resolve => node.addEventListener('seeked', resolve, {once: true}));
        await node.play();
      });
      await page.waitForTimeout(14500);
      const actual = await video.evaluate(node => ({time: node.currentTime, width: node.videoWidth, height: node.videoHeight, totalFrames: node.getVideoPlaybackQuality().totalVideoFrames, droppedFrames: node.getVideoPlaybackQuality().droppedVideoFrames}));
      const movie = page.video(); await context.close(); const raw = await movie.path();
      const output = path.join(root, `${width}-full-loop-playback.mp4`);
      const result = spawnSync(ffmpeg, ['-n', '-hide_banner', '-loglevel', 'error', '-sseof', '-14', '-i', raw, '-an', '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-movflags', '+faststart', output], {encoding: 'utf8', windowsHide: true});
      if (result.status) throw Error(result.stderr);
      save(`${width}-recording.json`, {actual, raw: path.relative(root, raw), output: path.basename(output), bytes: fs.statSync(output).size, durationSeconds: 14, method: 'Final 14 seconds of a separate stationary browser recording including a complete 12-second loop and wrap. Playwright screen recording is 25 fps; the served offline animation is 360 independently rendered frames at 30 fps. No recording used to create the animation or measure its performance.'});
      // Controlled autoplay rejection: poster stays visible and explicit Play recovers.
      const blockedContext = await contextFor(browser, options);
      await blockedContext.addInitScript(() => {
        const play = HTMLMediaElement.prototype.play; let rejectOnce = true;
        HTMLMediaElement.prototype.play = function() {
          if (this.id === 'workspace-video' && rejectOnce) {rejectOnce = false; return Promise.reject(new DOMException('Controlled autoplay denial', 'NotAllowedError'));}
          return play.call(this);
        };
      });
      const blocked = await visit(blockedContext);
      await expect(blocked.locator('#workspace-story')).toHaveAttribute('data-scene-status', 'blocked');
      await expect(blocked.locator('video')).toHaveAttribute('data-has-frame', 'false');
      await blocked.screenshot({path: path.join(root, `${width}-controlled-autoplay-denial.png`)});
      await blocked.getByRole('button', {name: 'Play workspace animation'}).click();
      await expect(blocked.locator('[data-story-visual]')).toHaveAttribute('data-render-state', 'playing');
      await blocked.getByRole('button', {name: 'Pause workspace animation'}).focus(); await blocked.keyboard.press('Enter');
      await expect(blocked.locator('[data-story-visual]')).toHaveAttribute('data-render-state', 'paused');
      await blocked.keyboard.press('Enter'); await expect(blocked.locator('[data-story-visual]')).toHaveAttribute('data-render-state', 'playing');
      await blockedContext.close();
      const failureContext = await contextFor(browser, options);
      await failureContext.route('**/art/workspace-video/*.mp4', route => route.abort('failed'));
      const failure = await visit(failureContext);
      await expect(failure.locator('#workspace-story')).toHaveAttribute('data-scene-status', 'failed');
      await expect(failure.locator('video')).toHaveAttribute('data-has-frame', 'false');
      await expect(failure.getByRole('button', {name: 'Play workspace animation'})).toBeDisabled();
      await failure.screenshot({path: path.join(root, `${width}-controlled-network-failure.png`)});
      await failureContext.close();
      const staticContext = await contextFor(browser, {...options, javaScriptEnabled: false});
      const still = await staticContext.newPage(); await still.goto(base); await still.locator('[data-story-visual]').scrollIntoViewIfNeeded();
      await expect(still.locator('[data-story-visual] img')).toBeVisible();
      await still.screenshot({path: path.join(root, `${width}-javascript-disabled-poster.png`)}); await staticContext.close();
      save(`${width}-fallbacks.json`, {controlledAutoplayDenialRecoversOnPlay: true, keyboardPauseResume: true, controlledMediaNetworkFailureShowsPoster: true, javascriptDisabledPoster: true});
      console.log('Recorded and checked fallbacks: ' + width);
    }
  } finally {await browser.close();}
  console.log(root);
}
main().catch(error => {save('failure.json', {message: error.message, stack: error.stack}); console.error(error); process.exitCode = 1;});
