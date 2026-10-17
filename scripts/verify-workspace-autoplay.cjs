/* Local UI proof only; signed test clearance is not genuine entrance acceptance.
   node scripts/verify-workspace-video.cjs <evidence-root> <development|production> */
const fs = require('node:fs');
const path = require('node:path');
const {createHmac, randomUUID} = require('node:crypto');
const {chromium, expect} = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const sharp = require('sharp');
process.loadEnvFile('.env.local');
const parent = path.resolve(process.argv[2]);
const mode = process.argv[3] || 'production';
const root = path.join(parent, `${mode}-browser-${randomUUID().slice(0, 8)}`);
fs.mkdirSync(root);
const base = 'http://localhost:3000';
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), {flag: 'wx'});
function clearance() {
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({v: 1, purpose: 'clearance', origin: base, iat, exp: iat + 1800, nonce: randomUUID()})).toString('base64url');
  return payload + '.' + createHmac('sha256', process.env.PALMSTEEZE_SECURITY_SECRET).update('palmsteeze-clearance-v1.' + payload).digest('hex');
}
const position = visual => visual.evaluate(node => scrollTo({top: scrollY + node.getBoundingClientRect().top - 20, behavior: 'instant'}));
const time = video => video.evaluate(node => node.currentTime);
const paused = video => expect.poll(() => video.evaluate(node => node.paused)).toBe(true);
const active = video => expect.poll(() => video.evaluate(node => !node.paused && node.readyState >= 2)).toBe(true);
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {count: values.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1)};
}
async function contextFor(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.addCookies([{name: 'ps-clearance', value: clearance(), url: base, httpOnly: true, sameSite: 'Lax'}]);
  await context.addInitScript(() => {
    window.__videoProof = {contexts: 0, longTasks: [], events: [], writes: 0, measuring: false};
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgl' || type === 'webgl2') window.__videoProof.contexts++;
      return getContext.call(this, type, ...args);
    };
    new PerformanceObserver(list => {for (const entry of list.getEntries()) window.__videoProof.longTasks.push({start: entry.startTime, duration: entry.duration});}).observe({type: 'longtask', buffered: true});
    new PerformanceObserver(list => {for (const entry of list.getEntries()) window.__videoProof.events.push({name: entry.name, inputDelay: entry.processingStart - entry.startTime, duration: entry.duration});}).observe({type: 'event', buffered: true, durationThreshold: 16});
    new MutationObserver(list => {if (window.__videoProof.measuring) window.__videoProof.writes += list.filter(entry => entry.target.matches?.('[data-story-visual]')).length;}).observe(document, {subtree: true, attributes: true});
  });
  return context;
}
async function visit(context) {
  const page = await context.newPage(), errors = [], mutations = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url()); requests.push(url.pathname);
    if (url.origin === base && !['GET', 'HEAD'].includes(request.method()) && url.pathname.startsWith('/api/') && !['/api/preferences', '/api/verification'].includes(url.pathname)) mutations.push({method: request.method(), path: url.pathname});
  });
  await page.goto(base); await page.evaluate(() => document.fonts.ready);
  const necessary = page.getByRole('button', {name: 'Necessary only', exact: true}); if (await necessary.isVisible()) await necessary.click();
  return {page, errors, mutations, requests};
}
async function main() {
  const source = fs.readFileSync('src/components/workspace-experience.tsx', 'utf8');
  expect(source).not.toMatch(/workspaceManualPause|manualPause|reducedOptIn|controller/);
  const results = [];
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({channel, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--host-resolver-rules=MAP localhost 127.0.0.1']});
    try {
      for (const width of [1366, 390]) {
        const options = {viewport: {width, height: 900}, reducedMotion: 'no-preference', isMobile: width === 390, hasTouch: width === 390};
        const context = await contextFor(browser, options);
        const {page, errors, mutations} = await visit(context), section = page.locator('#workspace-story'), visual = section.locator('[data-story-visual]'), video = section.locator('video');
        await position(visual); await active(video);
        await expect(section.getByRole('button')).toHaveCount(0);
        expect(await video.evaluate(node => node.controls)).toBe(false);
        await page.waitForTimeout(1200);
        const decoded = await video.evaluate(node => ({frames: node.getVideoPlaybackQuality().totalVideoFrames, dropped: node.getVideoPlaybackQuality().droppedVideoFrames, muted: node.muted, inline: node.playsInline, loop: node.loop}));
        expect(decoded.frames).toBeGreaterThan(20); expect(decoded.muted && decoded.inline && decoded.loop).toBe(true);
        const layouts = [];
        for (const w of channel === 'chrome' && width === 1366 ? [1366, 1100, 1099, 800, 390, 320, 1366] : [width]) {
          await page.setViewportSize({width: w, height: 900}); await position(visual); await active(video);
          const geometry = await section.evaluate(node => {
            const rect = element => element.getBoundingClientRect().toJSON();
            return {section: rect(node), visual: rect(node.querySelector('[data-story-visual]')), copy: rect(node.querySelector('h2').parentElement), root: rect(document.documentElement), fit: getComputedStyle(node.querySelector('video')).objectFit, radius: getComputedStyle(node.querySelector('[data-story-visual]')).borderRadius, overflow: document.documentElement.scrollWidth > innerWidth};
          });
          expect(geometry.overflow).toBe(false); expect(geometry.fit).toBe('cover');
          if (w >= 1100) {
            for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(geometry.section[key] - geometry.visual[key])).toBeLessThan(1);
            expect(Math.abs(geometry.section.width - geometry.root.width)).toBeLessThan(1);
          } else {expect(geometry.visual.y).toBeGreaterThan(geometry.copy.y + geometry.copy.height); expect(geometry.radius).toBe('18px');}
          layouts.push({width: w, geometry});
        }
        await page.screenshot({path: path.join(root, `${channel}-${width}-autoplay.png`)});
        await page.evaluate(() => scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'})); await paused(video);
        const offscreen = await time(video); await page.waitForTimeout(400); expect(await time(video)).toBe(offscreen);
        await position(visual); await active(video); expect((await time(video) - offscreen + 12) % 12).toBeLessThan(.8);
        // A paused element and route return cannot revive the removed manual latch.
        await video.evaluate(node => node.pause());
        await page.locator('a[href="/portfolio"]').first().click(); await expect(page).toHaveURL(/\/portfolio/); await page.goBack();
        await position(visual); await active(video);
        await page.emulateMedia({reducedMotion: 'reduce'}); await expect(section).toHaveAttribute('data-motion', 'reduced'); await paused(video); await expect(video).toHaveAttribute('data-has-frame', 'false');
        await page.emulateMedia({reducedMotion: 'no-preference'}); await expect(section).toHaveAttribute('data-motion', 'time'); await active(video);
        await section.getByRole('link', {name: 'Choose your rhythm'}).click(); await expect(page).toHaveURL(/#plan$/); await expect(page.locator('#plan')).toBeInViewport();
        const telemetry = await page.evaluate(() => window.__videoProof);
        expect(telemetry.contexts).toBe(0); expect(errors).toEqual([]); expect(mutations).toEqual([]);
        await context.close();
        const reducedContext = await contextFor(browser, {...options, reducedMotion: 'reduce'});
        const reducedVisit = await visit(reducedContext); await position(reducedVisit.page.locator('[data-story-visual]')); await reducedVisit.page.waitForTimeout(300);
        expect(await reducedVisit.page.locator('video').getAttribute('src')).toBeNull(); expect(reducedVisit.requests.filter(request => request.endsWith('.mp4'))).toEqual([]);
        await expect(reducedVisit.page.locator('video')).toHaveAttribute('data-has-frame', 'false');
        await reducedVisit.page.screenshot({path: path.join(root, `${channel}-${width}-reduced-poster.png`)}); await reducedContext.close();
        const blockedContext = await contextFor(browser, options);
        await blockedContext.addInitScript(() => {
          const original = HTMLMediaElement.prototype.play; window.__autoplayAttempts = 0;
          HTMLMediaElement.prototype.play = function() {
            if (this.id !== 'workspace-video') return original.call(this);
            window.__autoplayAttempts++;
            return new Promise((resolve, reject) => setTimeout(() => reject(new DOMException('Controlled denial', 'NotAllowedError')), 120));
          };
        });
        const blockedVisit = await visit(blockedContext), blocked = blockedVisit.page;
        await position(blocked.locator('[data-story-visual]')); await expect(blocked.locator('#workspace-story')).toHaveAttribute('data-scene-status', 'blocked');
        for (const w of [width, width === 390 ? 800 : 390, width]) {
          await blocked.evaluate(() => scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'}));
          await blocked.setViewportSize({width: w, height: 900}); await position(blocked.locator('[data-story-visual]'));
          await blocked.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await blocked.waitForTimeout(150);
        }
        await blocked.emulateMedia({reducedMotion: 'reduce'}); await expect(blocked.locator('#workspace-story')).toHaveAttribute('data-motion', 'reduced');
        await blocked.emulateMedia({reducedMotion: 'no-preference'}); await expect(blocked.locator('#workspace-story')).toHaveAttribute('data-motion', 'time');
        expect(await blocked.evaluate(() => window.__autoplayAttempts)).toBe(1);
        await expect(blocked.locator('video')).toHaveAttribute('data-has-frame', 'false'); await paused(blocked.locator('video'));
        await expect(blocked.locator('#workspace-story').getByRole('button')).toHaveCount(0);
        expect(await blocked.locator('#workspace-story').innerText()).not.toMatch(/Press Play|unavailable|Preparing|retry/i);
        await blocked.screenshot({path: path.join(root, `${channel}-${width}-autoplay-denied-poster.png`)});
        await blockedContext.close();
        const result = {channel, width, decoded, layouts, noControls: true, noManualPauseState: true, offscreenAndResume: true, navigationBackAutoplays: true, reducedPosterAndNoMovieDownload: true, livePreferencePosterAndResume: true, denialAttemptsAfterSyncTriggers: 1, noIntrusiveDenialMessage: true, ctaWorks: true, errors, mutations};
        save(`${channel}-${width}.json`, result); results.push(result); console.log(channel + ' ' + width + ' PASSED');
      }
    } finally {await browser.close();}
  }
  save('results.json', results); console.log('PASSED ' + root);
}
main().catch(error => {save('failure.json', {message: error.message, stack: error.stack}); console.error(error); process.exitCode = 1;});
