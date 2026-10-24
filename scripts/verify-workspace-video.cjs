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
  const cases = mode === 'development' ? [['chrome', 1366, 900], ['chrome', 390, 844]] : [['chrome', 1366, 900], ['chrome', 390, 844], ['msedge', 1366, 900], ['msedge', 390, 844]];
  const results = [];
  for (const [channel, width, height] of cases) {
    console.log(`${mode}: ${channel} ${width}`);
    const browser = await chromium.launch({channel, headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--host-resolver-rules=MAP localhost 127.0.0.1']});
    try {
      const options = {viewport: {width, height}, reducedMotion: 'no-preference', deviceScaleFactor: width === 390 ? 3 : 1, isMobile: width === 390, hasTouch: width === 390};
      const context = await contextFor(browser, options);
      const {page, errors, mutations, requests} = await visit(context);
      const section = page.locator('#workspace-story'), visual = page.locator('[data-story-visual]'), video = page.locator('#workspace-video');
      await expect(visual.locator('canvas')).toHaveCount(0);
      await position(visual); await active(video); await expect(section).toHaveAttribute('data-scene-status', 'ready');
      const layout = await section.evaluate(node => {
        const rect = element => element.getBoundingClientRect().toJSON();
        return {section: rect(node), visual: rect(node.querySelector('[data-story-visual]')), copy: rect(node.querySelector('h2').parentElement), root: rect(document.documentElement), hero: rect(document.querySelector('.rhythm-copy')), overflow: document.documentElement.scrollWidth > innerWidth, fit: getComputedStyle(node.querySelector('video')).objectFit, pointer: getComputedStyle(node.querySelector('[data-story-visual]')).pointerEvents};
      });
      expect(layout.overflow).toBe(false); expect(layout.fit).toBe('cover'); expect(layout.pointer).toBe('none');
      if (width >= 1100) {
        for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(layout.section[key] - layout.visual[key])).toBeLessThan(1);
        expect(Math.abs(layout.section.width - layout.root.width)).toBeLessThan(1);
        expect(Math.abs(layout.copy.x - layout.hero.x)).toBeLessThan(1);
      } else expect(layout.visual.y).toBeGreaterThan(layout.copy.y + layout.copy.height);
      // Match the prior warmed 16s / 16s comparison; no recording or profiling
      // during this interval. Video callbacks measure submitted decoded frames.
      await page.waitForTimeout(mode === 'production' ? 16000 : 1500);
      const measurement = await video.evaluate(async node => {
        const samples = [], qualityBefore = node.getVideoPlaybackQuality();
        const start = performance.now(); window.__videoProof.measuring = true;
        let callback;
        const frame = (now, metadata) => {samples.push({now, mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, expectedDisplayTime: metadata.expectedDisplayTime, processingDuration: metadata.processingDuration}); callback = node.requestVideoFrameCallback(frame);};
        callback = node.requestVideoFrameCallback(frame);
        await new Promise(resolve => setTimeout(resolve, 16000));
        node.cancelVideoFrameCallback(callback); window.__videoProof.measuring = false;
        const qualityAfter = node.getVideoPlaybackQuality();
        return {start, end: performance.now(), samples, qualityBefore: {total: qualityBefore.totalVideoFrames, dropped: qualityBefore.droppedVideoFrames}, qualityAfter: {total: qualityAfter.totalVideoFrames, dropped: qualityAfter.droppedVideoFrames}, writes: window.__videoProof.writes};
      });
      const fps = (measurement.samples.length - 1) * 1000 / (measurement.samples.at(-1).now - measurement.samples[0].now);
      const wraps = measurement.samples.slice(1).flatMap((sample, index) => sample.mediaTime < measurement.samples[index].mediaTime ? [{before: measurement.samples[index], after: sample, gapMs: sample.now - measurement.samples[index].now}] : []);
      expect(fps).toBeGreaterThan(27); expect(wraps.length).toBeGreaterThan(0);
      const dropped = measurement.qualityAfter.dropped - measurement.qualityBefore.dropped;
      expect(dropped).toBeLessThan(5);
      // Actual browser-decoded image, independent of encoded metadata.
      await section.getByRole('button', {name: 'Pause workspace animation'}).click(); await paused(video);
      await video.evaluate(async node => {node.currentTime = 4.5; await new Promise(resolve => node.addEventListener('seeked', resolve, {once: true}));});
      const decodedImage = Buffer.from(await video.evaluate(node => {
        const canvas = document.createElement('canvas'); canvas.width = node.videoWidth; canvas.height = node.videoHeight;
        canvas.getContext('2d').drawImage(node, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
      }), 'base64');
      fs.writeFileSync(path.join(root, `${channel}-${width}-video-frame-135.png`), decodedImage, {flag: 'wx'});
      const exportPath = fs.readFileSync(path.join(parent, 'final-export-path.txt'), 'utf8').trim();
      const sourcePixels = await sharp(path.join(exportPath, width >= 1100 ? 'desktop' : 'mobile', 'frame-0135.png')).removeAlpha().raw().toBuffer();
      const decodedPixels = await sharp(decodedImage).removeAlpha().raw().toBuffer();
      let absoluteDifference = 0;
      for (let i = 0; i < sourcePixels.length; i++) absoluteDifference += Math.abs(sourcePixels[i] - decodedPixels[i]);
      const browserDecodedRgbMeanAbsoluteDifference = absoluteDifference / sourcePixels.length;
      await page.screenshot({path: path.join(root, `${channel}-${width}-decoded-4.5s.png`)});
      const audit = await new AxeBuilder({page}).include('#workspace-story').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(audit.violations).toEqual([]);
      const beforeScroll = await time(video);
      await page.evaluate(() => scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'})); await paused(video); await page.waitForTimeout(350);
      await position(visual); await page.waitForTimeout(350); await paused(video); expect(Math.abs(await time(video) - beforeScroll)).toBeLessThan(.05);
      await page.emulateMedia({reducedMotion: 'reduce'}); await page.emulateMedia({reducedMotion: 'no-preference'}); await paused(video);
      await section.getByRole('button', {name: 'Resume workspace animation'}).click(); await active(video);
      await page.evaluate(() => scrollTo({top: document.documentElement.scrollHeight, behavior: 'instant'})); await paused(video);
      const offscreenTime = await time(video); await page.waitForTimeout(500); expect(Math.abs(await time(video) - offscreenTime)).toBeLessThan(.05);
      await position(visual); await active(video); expect((await time(video) - offscreenTime + 12) % 12).toBeLessThan(.6);
      await section.getByRole('button', {name: 'Pause workspace animation'}).click(); await paused(video);
      const resizes = [];
      for (const w of [320, 760, 761, 1099, 1100, 1920, width]) {
        await page.setViewportSize({width: w, height}); await position(visual);
        await expect.poll(() => video.evaluate(node => node.currentSrc.split('/').at(-1))).toBe(`workspace-${w >= 1100 ? 'desktop' : w >= 761 ? 'tablet' : 'mobile'}.mp4`);
        await expect.poll(() => video.evaluate(node => node.readyState)).toBeGreaterThanOrEqual(2);
        await paused(video);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        resizes.push({width: w, source: await video.evaluate(node => [node.videoWidth, node.videoHeight, node.currentTime])});
      }
      // Manual pause also survives unmount/Back within the same local tab.
      await page.locator('a[href="/portfolio"]').first().click(); await expect(page).toHaveURL(/\/portfolio/); await page.goBack();
      await expect(section).toBeAttached(); await position(visual); await page.waitForTimeout(350); await paused(video);
      await section.getByRole('button', {name: /Play workspace animation|Resume workspace animation/}).click(); await active(video);
      const wheelBefore = await page.evaluate(() => scrollY); await page.mouse.move(width * .8, Math.min(height - 100, 300)); await page.mouse.wheel(0, 300);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(wheelBefore);
      const clicks = [];
      for (const id of ['resource', 'date', 'start', 'duration']) {
        const trigger = page.locator('#' + id); await trigger.scrollIntoViewIfNeeded(); const before = await trigger.boundingBox(), at = Date.now();
        await trigger.click(); await expect(page.locator('.brand-popup')).toHaveAttribute('data-state', 'open');
        clicks.push({id, openAutomationMs: Date.now() - at});
        const during = await trigger.boundingBox(); expect(Math.abs(before.x - during.x)).toBeLessThan(2); expect(Math.abs(before.width - during.width)).toBeLessThan(2);
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      }
      const quoteResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/quote' && response.request().method() === 'GET');
      await page.getByRole('button', {name: /^Check availability/}).click(); await expect(page.locator('.quote-summary')).toHaveAttribute('data-feedback', 'checked');
      const quote = (await (await quoteResponse).json()).quote;
      for (const key of ['total_kobo', 'deposit_kobo', 'balance_kobo']) expect(Number.isSafeInteger(quote[key])).toBe(true);
      expect(quote.deposit_kobo + quote.balance_kobo).toBe(quote.total_kobo);
      const telemetry = await page.evaluate(() => window.__videoProof);
      expect(telemetry.contexts).toBe(0); expect(errors).toEqual([]); expect(mutations).toEqual([]);
      const js = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.js(?:\?|$)/.test(entry.name)).map(entry => new URL(entry.name).pathname));
      const result = {mode, channel, width, height, browserVersion: browser.version(), layout, fps, frameGapsMs: summarize(measurement.samples.slice(1).map((sample, index) => sample.now - measurement.samples[index].now)), droppedFrames: dropped, decodedFrames: measurement.qualityAfter.total - measurement.qualityBefore.total, browserDecodedRgbMeanAbsoluteDifference, wraps, measurement, resizes, clicks, quote, telemetry, js, requests, errors, mutations, axeViolations: audit.violations.length, lifecycle: 'Offscreen freezes; normal return resumes without catchup; manual pause survives scroll, preference change and App Router Back; responsive source replacement stays paused'};
      save(`${channel}-${width}.json`, result); results.push(result);
      console.log(JSON.stringify({channel, width, fps, droppedFrames: dropped, wraps: wraps.length, clicks}));
      await context.close();
      // Separate context proves reduced-motion does not download a movie.
      const reducedContext = await contextFor(browser, {...options, reducedMotion: 'reduce'});
      const reducedVisit = await visit(reducedContext); const reducedPage = reducedVisit.page;
      await position(reducedPage.locator('[data-story-visual]')); await reducedPage.waitForTimeout(500);
      const reducedVideo = reducedPage.locator('video'); await paused(reducedVideo);
      expect(await reducedVideo.getAttribute('src')).toBeNull(); expect(reducedVisit.requests.filter(url => url.endsWith('.mp4'))).toEqual([]);
      await reducedPage.screenshot({path: path.join(root, `${channel}-${width}-reduced-poster.png`)});
      await reducedPage.getByRole('button', {name: 'Play workspace animation'}).click(); await active(reducedVideo);
      await expect(reducedPage.locator('[data-story-visual]')).toHaveAttribute('data-render-state', 'playing');
      await reducedPage.waitForTimeout(200);
      await reducedPage.emulateMedia({reducedMotion: 'no-preference'});
      try {
        await expect(reducedPage.locator('#workspace-story')).toHaveAttribute('data-motion', 'time');
      } catch (error) {
        save(`${channel}-${width}-motion-failure.json`, await reducedPage.evaluate(() => ({matches: matchMedia('(prefers-reduced-motion: reduce)').matches, hidden: document.hidden, state: document.querySelector('#workspace-story').dataset, player: {paused: document.querySelector('video').paused, time: document.querySelector('video').currentTime}})));
        throw error;
      }
      await reducedPage.emulateMedia({reducedMotion: 'reduce'}); await paused(reducedVideo);
      save(`${channel}-${width}-reduced.json`, {noAutomaticMovieDownload: true, explicitPlayWorks: true, livePreferenceStops: true}); await reducedContext.close();
    } finally {await browser.close();}
  }
  save('results.json', results);
  console.log('PASSED ' + root);
}
main().catch(error => {save('failure.json', {message: error.message, stack: error.stack}); console.error(error); process.exitCode = 1;});
