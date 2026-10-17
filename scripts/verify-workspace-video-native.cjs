const fs = require('node:fs'), path = require('node:path');
const {spawn} = require('node:child_process');
const {createHmac, randomUUID} = require('node:crypto');
process.loadEnvFile('.env.local');
const parent = require('node:path').resolve(process.argv[2]), label = process.argv[3] || 'production';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function clearance() {
  const iat = Math.floor(Date.now() / 1000), payload = Buffer.from(JSON.stringify({v: 1, purpose: 'clearance', origin: 'http://localhost:3000', iat, exp: iat + 1800, nonce: randomUUID()})).toString('base64url');
  return payload + '.' + createHmac('sha256', process.env.PALMSTEEZE_SECURITY_SECRET).update('palmsteeze-clearance-v1.' + payload).digest('hex');
}
(async () => {
  const results = [];
  for (const [channel, executable] of [['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'], ['msedge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]) {
    const profile = path.resolve('.tools/private/raw-visibility-' + randomUUID()); fs.mkdirSync(profile, {recursive: true});
    const child = spawn(executable, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--window-size=1366,900', '--host-resolver-rules=MAP localhost 127.0.0.1', 'about:blank'], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
    let socket;
    try {
      const endpoint = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Native browser endpoint unavailable')), 15000);
        child.stderr.on('data', bytes => {const match = bytes.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) {clearTimeout(timeout); resolve(match[1]);}}); child.on('error', reject);
      });
      socket = new WebSocket(endpoint); await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = () => reject(Error('Local CDP connection failed'));});
      let serial = 0; const pending = new Map();
      socket.onmessage = message => {const value = JSON.parse(message.data); if (!value.id) return; const request = pending.get(value.id); if (!request) return; pending.delete(value.id); clearTimeout(request.timeout); value.error ? request.reject(Error(request.method + ': ' + value.error.message)) : request.resolve(value.result);};
      const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++serial, timeout = setTimeout(() => {pending.delete(id); reject(Error(method + ' timed out'));}, 10000);
        pending.set(id, {resolve, reject, timeout, method}); socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
      });
      const targets = await send('Target.getTargets'), target = targets.targetInfos.find(t => t.type === 'page');
      const {sessionId} = await send('Target.attachToTarget', {targetId: target.targetId, flatten: true});
      await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
      await send('Target.activateTarget', {targetId: target.targetId}); await send('Page.bringToFront', {}, sessionId);
      const evaluate = async expression => {
        const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}, sessionId);
        if (result.exceptionDetails) throw Error('Native page evaluation failed'); return result.result.value;
      };
      await send('Network.setCookie', {name: 'ps-clearance', value: clearance(), url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax'}, sessionId);
      await send('Page.addScriptToEvaluateOnNewDocument', {source: `const observer=new MutationObserver(()=>{const node=document.querySelector('[data-story-visual]');if(node){node.setAttribute('data-scene-diagnostics','');observer.disconnect();}});observer.observe(document,{childList:true,subtree:true});`}, sessionId);
      await send('Page.navigate', {url: 'http://localhost:3000/'}, sessionId);
      for (let i = 0; ; i++) {if (await evaluate(`document.readyState==='complete'&&Boolean(document.querySelector('#workspace-story')?.style.getPropertyValue('--workspace-viewport'))`)) break; if (i > 150) throw Error('Native page did not load'); await sleep(100);}
      await evaluate('document.fonts.ready.then(()=>true)');
      await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Necessary only')?.click();const n=document.querySelector('[data-story-visual]');scrollTo({top:scrollY+n.getBoundingClientRect().top-20,behavior:'instant'});})()`);
      for (let i = 0; ; i++) {if (await evaluate(`document.querySelector('#workspace-story').dataset.sceneStatus==='ready'`)) break; if (i > 100) {console.log(JSON.stringify({nativeDiagnostic: await evaluate(`(()=>{const n=document.querySelector('[data-story-visual]');return {hidden:document.hidden,status:document.querySelector('#workspace-story').dataset.sceneStatus,state:n.dataset.renderState,rect:n.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight};})()`)})); throw Error('Native scene did not load');} await sleep(100);}
      const preference = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
      if (preference) await evaluate(`document.querySelector('button[aria-label="Play workspace animation"]').click()`);
      await sleep(2000);
      const active = await evaluate(`document.querySelector('[data-story-visual]').dataset.renderState`); if (active !== 'playing') throw Error('Native scene did not autoplay');
      const other = await send('Target.createTarget', {url: 'about:blank'}); await send('Target.activateTarget', {targetId: other.targetId});
      for (let i = 0; ; i++) {if (await evaluate('document.hidden')) break; if (i > 40) throw Error('Native tab did not become hidden'); await sleep(100);}
      await sleep(100);
      const before = await evaluate(`(()=>{const n=document.querySelector('[data-story-visual]');return {state:n.dataset.renderState,time:n.querySelector('video').currentTime*1000,frames:n.querySelector('video').getVideoPlaybackQuality().totalVideoFrames,hidden:document.hidden};})()`);
      await sleep(2000);
      const during = await evaluate(`(()=>{const n=document.querySelector('[data-story-visual]');return {state:n.dataset.renderState,time:n.querySelector('video').currentTime*1000,frames:n.querySelector('video').getVideoPlaybackQuality().totalVideoFrames,hidden:document.hidden};})()`);
      if (!before.hidden || before.state !== 'paused' || before.frames !== during.frames) throw Error('Hidden native tab kept rendering');
      await send('Target.activateTarget', {targetId: target.targetId});
      for (let i = 0; ; i++) {if (await evaluate(`!document.hidden&&document.querySelector('[data-story-visual]').dataset.renderState==='playing'`)) break; if (i > 40) throw Error('Native tab did not resume'); await sleep(100);}
      await sleep(300); await evaluate(`document.querySelector('button[aria-label="Pause workspace animation"]').click()`);
      const after = await evaluate(`document.querySelector('#workspace-video').currentTime*1000`), delta = (after - before.time + 12000) % 12000;
      if (delta > 1100) throw Error('Native resume advanced over the hidden interval');
      await send('Target.activateTarget', {targetId: other.targetId}); await sleep(500); await send('Target.activateTarget', {targetId: target.targetId}); await sleep(500);
      if(await evaluate("!document.querySelector('#workspace-video').paused"))throw Error('Manual pause lost on native tab return');
      results.push({manualPauseSurvivesNativeTabReturn:true,channel, method: 'Fresh native browser; raw CDP only, no Playwright focus, visibility or media emulation; actual foreground/background tab switch', rendering: 'Native decoded MP4; no WebGL initialization or forced motion preference; actual OS preference recorded', reducedPreference: preference, normalAutoplay: !preference, before, during, after, delta}); console.log(JSON.stringify(results.at(-1)));
      await send('Browser.close').catch(() => {});
    } finally {socket?.close(); if (child.exitCode === null) child.kill();}
  }
  fs.writeFileSync(path.join(parent, label + '-raw-visibility-' + randomUUID().slice(0, 8) + '.json'), JSON.stringify(results, null, 2), {flag: 'wx'});
})().catch(error => {console.error(error.message); process.exitCode = 1;});
