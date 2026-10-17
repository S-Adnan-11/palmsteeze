const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const sharp = require('sharp');
const root = path.resolve(process.argv[2]);
const ffmpeg = path.resolve(process.argv[3]);
const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
function run(executable, args) {
  const result = spawnSync(executable, args, {encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024});
  if (result.status) throw Error(result.stderr);
  return result;
}
async function difference(first, second) {
  const a = await sharp(first).removeAlpha().raw().toBuffer(), b = await sharp(second).removeAlpha().raw().toBuffer();
  let total = 0, changed = 0;
  for (let i = 0; i < a.length; i++) {const delta = Math.abs(a[i] - b[i]); total += delta; if (delta > 8) changed++;}
  return {meanAbsoluteChannelDifferenceOf255: total / a.length, fractionChannelsChangingOver8: changed / a.length};
}
async function sheet(directory, indices, name, columns) {
  const meta = await sharp(path.join(directory, 'frame-0000.png')).metadata();
  const cellWidth = 400, cellHeight = Math.round(cellWidth * meta.height / meta.width), composites = [];
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i], left = i % columns * cellWidth, top = Math.floor(i / columns) * (cellHeight + 24);
    const input = await sharp(path.join(directory, `decoded-${index}.png`)).resize(cellWidth, cellHeight).png().toBuffer();
    composites.push({input, left, top: top + 24}, {input: Buffer.from(`<svg width="400" height="24"><text x="8" y="18" font-size="16">frame ${index} / ${(index / 30).toFixed(3)}s</text></svg>`), left, top});
  }
  await sharp({create: {width: cellWidth * columns, height: (cellHeight + 24) * Math.ceil(indices.length / columns), channels: 3, background: '#fff'}}).composite(composites).png().toFile(path.join(directory, name));
}
async function main() {
  const results = [];
  for (const name of ['desktop', 'tablet', 'mobile']) {
    const directory = path.join(root, name), movie = path.join(directory, 'workspace.mp4');
    const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', movie]).stdout);
    const frames = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,duration_time', '-of', 'json', movie]).stdout).frames;
    if (frames.length !== 360 || probe.streams.length !== 1 || probe.streams[0].r_frame_rate !== '30/1') throw Error('Invalid encoded stream');
    for (let i = 0; i < frames.length; i++) if (Math.abs(Number(frames[i].best_effort_timestamp_time) - i / 30) > .00001) throw Error('Nonuniform encoded timestamps');
    const md5 = run(ffmpeg, ['-v', 'error', '-i', movie, '-f', 'framemd5', '-']).stdout;
    fs.writeFileSync(path.join(directory, 'decoded-framemd5.txt'), md5, {flag: 'wx'});
    const hashes = md5.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1).trim());
    const bytes = fs.readFileSync(movie), atoms = [];
    for (let offset = 0; offset < bytes.length;) {const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8); if (size < 8) throw Error('Unexpected MP4 atom'); atoms.push({type, offset, size}); offset += size;}
    if (atoms.find(atom => atom.type === 'moov').offset > atoms.find(atom => atom.type === 'mdat').offset) throw Error('Fast-start metadata missing');
    const ssim = run(ffmpeg, ['-hide_banner', '-i', movie, '-framerate', '30', '-i', path.join(directory, 'frame-%04d.png'), '-lavfi', '[0:v]format=gbrp[decoded];[1:v]format=gbrp[original];[decoded][original]ssim', '-frames:v', '360', '-f', 'null', '-']).stderr;
    fs.writeFileSync(path.join(directory, 'ssim-log.txt'), ssim, {flag: 'wx'});
    const indices = [...new Set([...Array.from({length: 12}, (_, i) => i * 30), 135, 354, 357, 359, 2, 5])];
    for (const index of indices) run(ffmpeg, ['-n', '-v', 'error', '-i', movie, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', path.join(directory, `decoded-${index}.png`)]);
    await sheet(directory, Array.from({length: 12}, (_, i) => i * 30), 'decoded-full-loop.png', 3);
    await sheet(directory, [354, 357, 359, 0, 2, 5], 'decoded-seam.png', 3);
    const result = {name, bytes: bytes.length, probe, uniform30fpsTimestamps: true, decodedFrames: hashes.length, distinctDecodedHashes: new Set(hashes).size, atoms, ssimAll: Number(ssim.match(/All:([\d.]+)/)?.[1]), seam: {decodedLastToFirst: await difference(path.join(directory, 'decoded-359.png'), path.join(directory, 'decoded-0.png')), authoredEndpointToStart: await difference(path.join(directory, 'seam-12000.png'), path.join(directory, 'frame-0000.png'))}};
    fs.writeFileSync(path.join(root, `${name}-inspection.json`), JSON.stringify(result, null, 2), {flag: 'wx'}); results.push(result);
    console.log(JSON.stringify({name, bytes: result.bytes, distinctDecodedHashes: result.distinctDecodedHashes, ssimAll: result.ssimAll, seam: result.seam}));
  }
  fs.writeFileSync(path.join(root, 'asset-inspection.json'), JSON.stringify(results, null, 2), {flag: 'wx'});
}
main().catch(error => {console.error(error); process.exitCode = 1;});
