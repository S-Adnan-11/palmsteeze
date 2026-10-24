/* Offline, fixed-timestamp export. Run with the project's isolated Node runtime.
   node scripts/export-workspace-video.cjs <new-evidence-directory> <ffmpeg.exe>
   Optional WORKSPACE_EXPORT_VARIANTS=desktop,tablet,mobile; existing output is
   never overwritten. Scene source is retained independently of the public UI. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {build} = require('esbuild');
const sharp = require('sharp');
const {chromium} = require('@playwright/test');
const root = path.resolve(process.argv[2] || '');
const ffmpeg = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !fs.existsSync(ffmpeg)) throw Error('Evidence directory and FFmpeg executable required');
const variants = [
  {name: 'desktop', width: 1600, height: 736},
  {name: 'tablet', width: 1200, height: 744},
  {name: 'mobile', width: 704, height: 864},
].filter(item => !process.env.WORKSPACE_EXPORT_VARIANTS || process.env.WORKSPACE_EXPORT_VARIANTS.split(',').includes(item.name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), {flag: 'wx'});
const run = args => {
  const result = spawnSync(ffmpeg, ['-n', '-hide_banner', '-loglevel', 'error', ...args], {encoding: 'utf8', windowsHide: true});
  if (result.status) throw Error(result.stderr || 'FFmpeg failed');
};
async function main() {
  fs.mkdirSync(root, {recursive: true});
  const bundle = await build({stdin: {contents: `import {createWorkspaceScene} from './src/components/workspace-scene';
    window.prepare = (width,height) => {
      const host=document.querySelector('#scene');host.style.width=width+'px';host.style.height=height+'px';
      const scene=createWorkspaceScene(host,()=>{throw Error('Offline renderer failed')},{visible:true,autoplay:false,exportSize:{width,height}});
      if(!scene)throw Error('No scene');window.scene=scene;
    };
    window.capture = time => {window.scene.renderAt(time);return document.querySelector('canvas').toDataURL('image/png').split(',')[1];};`, resolveDir: process.cwd(), loader: 'ts'}, bundle: true, write: false, format: 'iife', platform: 'browser'});
  const server = http.createServer((request, response) => {
    if (request.url === '/scene.js') {response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents);}
    else {response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><style>html,body{margin:0}canvas{display:block}</style><div id="scene"></div><script src="/scene.js"></script>');}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader']});
  try {
    const results = [];
    for (const variant of variants) {
      const directory = path.join(root, variant.name); fs.mkdirSync(directory);
      const page = await browser.newPage({viewport: {width: variant.width, height: variant.height}, deviceScaleFactor: 1});
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(({width, height}) => window.prepare(width, height), variant);
      const started = Date.now(), frames = [];
      for (let index = 0; index < 360; index++) {
        // Exactly 0, 1000/30, ..., 359*1000/30 ms. Slow rendering never skips,
        // catches up, interpolates a recording or creates replacement frames.
        const milliseconds = index * 1000 / 30;
        const bytes = Buffer.from(await page.evaluate(time => window.capture(time), milliseconds), 'base64');
        const name = `frame-${String(index).padStart(4, '0')}.png`;
        fs.writeFileSync(path.join(directory, name), bytes, {flag: 'wx'});
        frames.push({index, milliseconds, sha256: hash(bytes)});
        if (index % 30 === 0) console.log(`${variant.name}: ${index}/360 (${((Date.now() - started) / 1000).toFixed(1)}s wall time)`);
      }
      const repeated = [];
      for (const index of [0, 71, 135, 284, 359]) {
        const bytes = Buffer.from(await page.evaluate(time => window.capture(time), index * 1000 / 30), 'base64');
        if (hash(bytes) !== frames[index].sha256) throw Error(`Nondeterministic render at ${variant.name}/${index}`);
        repeated.push(index);
      }
      const end = Buffer.from(await page.evaluate(() => window.capture(12000)), 'base64');
      fs.writeFileSync(path.join(directory, 'seam-12000.png'), end, {flag: 'wx'});
      const poster = Buffer.from(await page.evaluate(() => window.capture(4500)), 'base64');
      await sharp(poster).webp({quality: 90}).toFile(path.join(directory, 'poster.webp'));
      const output = path.join(directory, 'workspace.mp4');
      const args = ['-framerate', '30', '-start_number', '0', '-i', path.join(directory, 'frame-%04d.png'), '-frames:v', '360', '-an', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-profile:v', 'high', '-level:v', '4.1', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-fps_mode', 'passthrough', '-movflags', '+faststart', output];
      run(args);
      const result = {...variant, fps: 30, durationSeconds: 12, frameCount: frames.length, distinctImageHashes: new Set(frames.map(frame => frame.sha256)).size, rerenderedMatches: repeated, wallSeconds: (Date.now() - started) / 1000, bytes: fs.statSync(output).size, posterBytes: fs.statSync(path.join(directory, 'poster.webp')).size, sha256: hash(fs.readFileSync(output)), frames, encodingArguments: args};
      save(variant.name + '-export.json', result); results.push(result);
      console.log(`${variant.name}: encoded ${result.bytes} bytes; ${result.distinctImageHashes} distinct rendered images`);
      await page.close();
    }
    save('export-manifest.json', {createdAt: new Date().toISOString(), sceneSourceSha256: hash(fs.readFileSync('src/components/workspace-scene.ts')), ffmpegVersion: spawnSync(ffmpeg, ['-version'], {encoding: 'utf8', windowsHide: true}).stdout.split('\n')[0], timestampRule: 'index * 1000 / 30 milliseconds, 0 <= index < 360; no wall-clock animation, capture duplication, fps filter or output frame synthesis', variants: results});
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
}
main().catch(error => {console.error(error); process.exitCode = 1;});
