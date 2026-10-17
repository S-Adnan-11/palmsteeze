const fs=require('node:fs');
const path=require('node:path');
const root=process.env.PALMSTEEZE_RELEASE_ROOT;
const base=path.resolve('docs/evidence');
if(!root||!path.resolve(root).startsWith(base+path.sep))throw Error('Set a new private PALMSTEEZE_RELEASE_ROOT under docs/evidence.');
if(fs.existsSync(path.join(root,'results.json')))throw Error('Preserve completed evidence; choose a new release root.');
fs.mkdirSync('.tools/release-tests',{recursive:true});
for(const name of fs.readdirSync('tests/browser')){
  if(!/\.(ts|cjs)$/.test(name))continue;
  let source=fs.readFileSync('tests/browser/'+name,'utf8');
  if(name!=='release.spec.ts')source=source.replace(/docs\/(screenshots|evidence)/g,(_,kind)=>root+'/'+(kind==='evidence'?'legacy-suite-evidence':'screenshots'))
    .replaceAll('.tools/private/m2-browser-fixtures.json',root+'/m2-fixtures.private.json')
    .replaceAll('.tools/private/m3-browser-fixtures.json',root+'/m3-fixtures.private.json');
  fs.writeFileSync('.tools/release-tests/'+name,source);
}
console.log('Prepared release tests with new private artifact paths. Historical source/evidence retained.');
