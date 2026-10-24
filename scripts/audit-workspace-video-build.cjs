const fs = require('node:fs'), path = require('node:path');
const {createHash, createHmac, randomUUID} = require('node:crypto');
process.loadEnvFile('.env.local');
const root = path.resolve(process.argv[2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const base = 'http://localhost:3000', iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({v: 1, purpose: 'clearance', origin: base, iat, exp: iat + 1800, nonce: randomUUID()})).toString('base64url');
  const clearance = payload + '.' + createHmac('sha256', process.env.PALMSTEEZE_SECURITY_SECRET).update('palmsteeze-clearance-v1.' + payload).digest('hex');
  const response = await fetch(base, {headers: {Cookie: 'ps-clearance=' + clearance}, cache: 'no-store'});
  const html = await response.text();
  if (response.status !== 200 || !html.includes('id="workspace-video"')) throw Error('Updated homepage not served');
  const assetPaths = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)(?:\?[^" ]*)?"/g)].map(match => match[1]))];
  const assets = [];
  for (const assetPath of assetPaths) {
    const served = Buffer.from(await (await fetch(base + assetPath, {cache: 'no-store'})).arrayBuffer());
    const disk = fs.readFileSync('.next/' + assetPath.slice('/_next/'.length));
    if (sha(served) !== sha(disk)) throw Error('Served build differs from disk');
    assets.push({path: assetPath, bytes: served.length, sha256: sha(served)});
  }
  const jsFiles = [];
  const walk = directory => {for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {const file = path.join(directory, entry.name); if (entry.isDirectory()) walk(file); else if (entry.name.endsWith('.js')) jsFiles.push(file);}};
  walk('.next/static');
  const signatures = ['WebGLRenderer', 'CatmullRomCurve3', 'RoundedBoxGeometry', 'three.module', 'workspace-scene'];
  const runtimeHits = jsFiles.flatMap(file => {const source = fs.readFileSync(file, 'utf8'); return signatures.filter(signature => source.includes(signature)).map(signature => ({file, signature}));});
  if (runtimeHits.length) throw Error('Unused scene runtime remains in browser chunks');
  const exportRoot = path.resolve(fs.readFileSync(path.join(root, 'final-export-path.txt'), 'utf8').trim());
  const movies = [];
  for (const name of ['desktop', 'tablet', 'mobile']) {
    const moviePath = `/art/workspace-video/workspace-${name}.mp4`;
    const partial = await fetch(base + moviePath, {headers: {Range: 'bytes=0-1023'}, cache: 'no-store'});
    if (partial.status !== 206 || !partial.headers.get('content-type')?.startsWith('video/mp4')) throw Error('Public video range request failed');
    const publicMovie = fs.readFileSync('public' + moviePath), exported = fs.readFileSync(path.join(exportRoot, name, 'workspace.mp4'));
    if (sha(publicMovie) !== sha(exported)) throw Error('Served movie differs from export');
    const publicPoster = fs.readFileSync(`public/art/workspace-video/workspace-${name}-poster.webp`);
    if (sha(publicPoster) !== sha(fs.readFileSync(path.join(exportRoot, name, 'poster.webp')))) throw Error('Poster differs from export');
    movies.push({path: moviePath, bytes: publicMovie.length, sha256: sha(publicMovie), posterBytes: publicPoster.length, posterSha256: sha(publicPoster), anonymousRangeStatus: partial.status, contentType: partial.headers.get('content-type'), contentRange: partial.headers.get('content-range'), partialBytes: (await partial.arrayBuffer()).byteLength});
  }
  const result = {at: new Date().toISOString(), buildId: fs.readFileSync('.next/BUILD_ID', 'utf8').trim(), assets, staticJsFiles: jsFiles.length, runtimeHits, movies, access: 'Signed local UI-only entrance clearance for homepage integrity; video range requests use no clearance. No genuine provider or owner acceptance asserted.'};
  const file = path.join(root, 'final-running-build-' + randomUUID().slice(0, 8) + '.json'); fs.writeFileSync(file, JSON.stringify(result, null, 2), {flag: 'wx'});
  console.log(JSON.stringify({file, servedAssetsVerified: assets.length, staticJsFiles: jsFiles.length, sceneRuntimeHits: runtimeHits.length, movies}));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
