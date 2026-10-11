import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';

const root=resolve(process.argv[2]||''),captures=process.argv[3],recordings=process.argv[4];
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
assert.ok(existsSync(join(root,'run.json')));
const results=read(join(root,captures,'results.json'));
assert.equal(results.stats.unexpected,0);assert.equal(results.stats.expected,18);
const preservation=read(join(root,'preservation-audit.json'));
assert.equal(preservation.historicalFilesChanged.length,0);assert.equal(preservation.unrecoveredHistoricalItems,21);
const database=read(join(root,'database-preservation.json'));
assert.equal(database.newSyntheticAuthFixturesRemaining,0);
const build=read(join(root,'final-running-build.json'));
const baseline=[
  ['Branding and general visual direction','Owner accepted. Frozen. Curved primary logo, approved imagery, forest/ivory, Manrope/DM Serif Display.','No branding, imagery or wording changes.'],
  ['Booking controls and popup collision','Owner-observed fixed. Frozen. Branded date, grouped selects, whole-room cards and individual desk IDs.','Frame-by-frame opening/closing, stable page/trigger/list geometry and contents, arrows, placement, Escape/outside/toggle dismissal, focus restoration and 320px calendar pass.'],
  ['Account presentation','Implemented baseline. General direction accepted; genuine Google walkthrough outstanding.','Current synthetic verified-Auth profile, restricted image-error/initials fallback and preview isolation pass. Seeded metadata is not Google OAuth.'],
  ['Sandbox test-card helper','Implemented baseline. Preserve the accepted presentation and copy.','Existing 34-unit suite protects the ten-card catalogue, deterministic per-checkout number/expiry/CVC and storage independence. Prior actual sandbox reload/companion/payment evidence is preserved; no new checkout or card payment was created.'],
  ['Entrance and cookie experience','Frozen baseline; earlier owner-reported entrance success preserved.','Controlled automatic continuation confirms a signed cookie. Necessary-only, optional acceptance, withdrawal, retained input and focus pass. No genuine reservation challenge success inferred.'],
  ['Financial and security behaviour','Frozen baseline; M3 remains closed under its revised criterion.','Exact money/refund units, rejected checkout side effects and actual old-RPC privilege checks pass. All 14 domain/security boundary files and original nine-table records are preserved.'],
  ['Workspace story','Engineering checks complete; NOT visually accepted by owner.','Loaded arrival → desk → meeting-room imagery, synchronized stage emphasis, intermediate crossfades, pinning, reverse progression and smooth entry/exit pass at 1440×1000, 1280×800, 960×720 and 800×600.'],
  ['Mobile and reduced motion','Deliberate static fallback preserved; physical-phone acceptance outstanding.','390px emulation, 760/761 boundary and dynamic reduced-motion changes pass. All three static scenes and ordinary scrolling/booking remain usable.'],
];
const outstanding=[
  ['Owner motion acceptance','Review the continuous forward/reverse story in the regular owner browser. Exact past viewport/preference is unknown (owner answered “I don’t know”). This package displays current local measurements below; no preference is overridden.'],
  ['Genuine reservation Turnstile','Regular-browser review idle >5 minutes, Continue and retry remain unconfirmed. Latest preserved genuine automated attempts timed out with zero reservation requests; earlier 600010 failures remain failures. Controlled checks and entrance clearance establish no genuine reserve success.'],
  ['Completed Google walkthrough','Complete genuine Google sign-in and verify account identity and saved destination. Current evidence proves initiation/cancellation and seeded Auth presentation only.'],
  ['Physical phone','Confirm booking controls, static story, consent, copy/manual-copy and switching to hosted Stripe on an actual phone. Chrome/iPhone emulation does not establish device/Safari acceptance.'],
  ['Privacy owner decisions (publication gate)','Controller/operator and contact; retention/rights responsibility; security basis and transfer/provider assessment; access, storage/backup retention and Turnstile dashboard settings remain owner items from PRIVACY_OPERATIONS.md. M5 stays paused; no new redesign or implementation round is proposed.'],
  ['Historical incident','21 original items remain unrecovered: 17 PNG and four JSON. Five of the 26 affected files were previously recovered with matching hashes. The incident inventory is unchanged; these new captures are not recovery.'],
];
const summary=`Only the workspace story stylesheet changed in the application. At 800×600 the previous sticky copy was 692px tall with a 60px top offset, cutting off Gather and the booking link. Short desktop heights now use a compact, readable arrangement, keeping the existing imagery, copy and fades. Removing the 1700px minimum reduces unnecessary short-viewport travel; 1440×1000 retains the existing composition. The coordinated animation itself was present and visually matched the surviving earlier recording, so no new library or surrounding-homepage rebuild was needed.`;
const failures=`Failed harness runs remain separate. The first runner had incorrect PowerShell argument forwarding and was stopped. Initial checks assumed #plan immediately displayed its lower scheduling trigger, omitted the controlled script onload callback, used a role selector hidden by modal semantics and measured during page-entry animation. A later diagnostic filename contained punctuation and was refused by the exclusive artifact writer. The harness was corrected, without changing accepted controls. The bundled FFmpeg could not create a contact sheet; browser decoding succeeded. No failed run is labelled a pass.`;
const md=`# M4 stabilization and acceptance — 11 October 2026

M4 is open only for the listed acceptance/provider/device work. M3 stays closed under the revised permanent-provider-rejection criterion, retaining original replacement FAILED evidence and outstanding reimbursement. M5 publication stays paused. No feature, provider/schema/configuration cutover, paid service, live payment, push or deployment occurred.

Owner feedback: dropdown/calendar collision is owner-observed fixed; general visual direction is accepted; intended workspace motion is NOT visually accepted; Google, physical-phone and genuine reservation-Turnstile results are not inferred.

Local baseline checkpoint: \`cdcccc8\` on \`refinement/m4-booking-auth-motion\`. Existing branches and 1c8ed14, 7c0d832, 0e0becf remain intact. Source/history scans cover populated private credentials and actual Auth identities without exporting values. Ignored plans/reviews/evidence/private configuration remain excluded.

## Actual changes

${summary}

Shared controls, account, helper, entrance/preferences and financial/security code are unchanged. Test changes protect actual regressions. Surviving source and the full 28.20-second polish recording were compared with the running page. Final 1440px and 800px story recordings and desktop control recording were decoded at 0.1-second intervals; rendered images, crossfades and entry/exit were inspected directly.

## Consolidated acceptance checklist

| Area | Acceptance/baseline | Completed checks |
| --- | --- | --- |
${baseline.map(row=>'| '+row.join(' | ')+' |').join('\n')}

## Specifically outstanding

${outstanding.map(([name,detail])=>`- [ ] **${name}:** ${detail}`).join('\n')}

## Final verification and evidence

- Production build, TypeScript, ESLint and all 34 existing units pass. All 18 final desktop/mobile cases pass; uncaught browser/framework errors are checked. Expected controlled transport faults are recorded separately.
- Final build \`${build.buildId}\`: nine assets served by the running production process match the final build bytes. Genuine configured keys; official test keys absent; invalid token denied 403 without clearance. Browser-secret scan: 29 assets, eight populated private credentials, no matches.
- ${preservation.historicalFilesChecked} prior evidence/report files and all 14 server/domain boundary files match the starting hashes. Nine original business/refund/audit snapshots remain identical. The retained sandbox booking is still confirmed: 100001 kobo collected, 200000 total, 99999 remaining. Isolated synthetic Auth/admin roles were cleaned; no business mutation or new payment in this pass.
- [Continuous story and controls, before/after and local measurements](index.html). [Machine-readable final checks](${captures}/results.json), [recording measurements](${recordings}/recordings.json), [running-build verification](final-running-build.json), [preservation](preservation-audit.json), [database](database-preservation.json).
- New curated recordings use the genuine-key application build and trusted test-issued entrance clearance to isolate presentation. **No test-key footage in this run. No genuine successful challenge, Google or phone claim.** Earlier official test-key footage in M4_TARGETED/ENTRANCE/STANDARDIZATION remains labelled as such.

${failures}

Running review: http://localhost:3000. No executable implementation blocker remains. Owner motion/unknown environment and genuine provider/device checks remain open; historical loss and reimbursement remain accurately outstanding.
`;
const esc=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const video=(file:string,label:string)=>`<figure><video controls preload="metadata" src="${recordings}/${file}" aria-label="${esc(label)}"></video><figcaption>${esc(label)} · <a href="${recordings}/${file}">Open recording</a></figcaption></figure>`;
const image=(path:string,label:string)=>`<figure><img loading="lazy" src="${path}" alt="${esc(label)}"><figcaption>${esc(label)}</figcaption></figure>`;
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PalmSteeze · M4 stabilization acceptance</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f3e9;color:#173d32;font:16px/1.6 system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:32px}h1{font-size:clamp(30px,4vw,48px);line-height:1.15}h2{margin-top:40px}p{max-width:90ch}a{color:inherit;text-underline-offset:4px}.status,aside{border:1px solid #819585;padding:14px 18px;border-radius:12px;background:#fffdf8}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0;padding:12px;border:1px solid #b5c4ac;border-radius:14px;background:#fffdf8;min-width:0}img,video{display:block;width:100%;max-height:760px;object-fit:contain}figcaption{font-size:14px;padding-top:10px}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border:1px solid #b5c4ac;padding:12px}th{background:#e7ebdc}li{margin:10px 0}@media(max-width:760px){main{padding:20px}.grid{grid-template-columns:1fr}}</style><main>
<p class="status">M4 bounded stabilization · M3 closed under revised criterion · M5 publication paused</p><h1>Workspace story.<br>One acceptance package.</h1>
<p><strong>Owner-observed fixed:</strong> dropdown/calendar collision. <strong>Accepted:</strong> general visual direction. <strong>Still awaiting owner visual acceptance:</strong> the workspace scroll story.</p><p><a href="http://localhost:3000">Open genuine-key running preview</a> · <a href="review.md">Full review and evidence notes</a></p>
<aside><strong>Current review-window measurement</strong><p id="environment">Measuring locally…</p><p>This describes the current browser window, not the unknown earlier review session. It sends and saves nothing and does not change reduced-motion settings. Review the application in this same window to compare.</p></aside>
<h2>Continuous desktop story and booking controls</h2><p>Forward and reverse scrolling, section entry/exit, arrival → desk → meeting room. Genuine-key build with test-issued entrance clearance for presentation only; no genuine Turnstile success or owner acceptance is claimed.</p><div class="grid">${video('story-forward-reverse-desktop.webm','1440 × 1000 · continuous forward and reverse')}${video('controls-desktop.webm','1440 × 1000 · open, scroll and dismiss controls')}</div>
<h2>Before and after · the actual fix</h2><p>${esc(summary)}</p><div class="grid">${image('before/800-0.5.png','Before · 800 × 600 · lower stage and booking link cut off')}${image(recordings+'/settle-desktop-800.png','After · 800 × 600 · all stages and booking link visible')}</div>
<h2>Previously problematic desktop sizes</h2><div class="grid">${video('story-forward-reverse-desktop-960.webm','960 × 720 · continuous forward and reverse')}${video('story-forward-reverse-desktop-800.webm','800 × 600 · continuous forward and reverse')}${video('story-forward-reverse-desktop-1280.webm','1280 × 800 · continuous forward and reverse')}${video('controls-desktop-800.webm','800 × 600 · unchanged shared controls')}</div>
<h2>Deliberate static fallbacks</h2><p>Measured scenarios: 390 × 664 uses the ≤760px mobile layout; 1440 × 1000 with prefers-reduced-motion: reduce uses static cards. No preference is overridden in the owner application.</p><div class="grid">${video('story-forward-reverse-mobile.webm','390px emulation · static mobile story')}${video('story-forward-reverse-reduced.webm','1440px · reduced-motion static story')}${video('controls-mobile.webm','390px emulation · booking controls')}${image(recordings+'/static-reduced.png','Reduced motion · three static scenes')}</div>
<h2>Consolidated acceptance checklist</h2><div class="table"><table><thead><tr><th>Area</th><th>Acceptance/baseline</th><th>Completed checks</th></tr></thead><tbody>${baseline.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(cell)+'</td>').join('')+'</tr>').join('')}</tbody></table></div>
<h2>Specifically outstanding</h2><ul>${outstanding.map(([name,detail])=>`<li><strong>${esc(name)}:</strong> ${esc(detail)}</li>`).join('')}</ul>
<p class="status">18 final browser cases and 34 units pass. Build/typecheck/lint pass. ${preservation.historicalFilesChecked} earlier files preserved; 21 historical originals remain unrecovered. Current recordings are new evidence. Original M3 failure/reimbursement remains unchanged. No push or publication.</p><p><a href="${captures}/results.json">Final results</a> · <a href="preservation-audit.json">Preservation audit</a> · <a href="final-running-build.json">Verified running build</a> · <a href="../m4-standardization/evidence-incident.json">Incident inventory</a></p>
<script>const preference=matchMedia('(prefers-reduced-motion: reduce)');function measure(){const reduced=preference.matches;const reason=innerWidth<=760?'Static mobile layout: CSS viewport is at or below 760px.':reduced?'Static layout: prefers-reduced-motion is active.':'Normal desktop: pinned story is enabled by width and motion preference.';document.getElementById('environment').textContent=innerWidth+' × '+innerHeight+' CSS px; device pixel ratio '+devicePixelRatio+'; reduced motion '+(reduced?'active':'inactive')+'. '+reason;}measure();addEventListener('resize',measure);preference.addEventListener('change',measure);</script></main></html>`;
writeFileSync(join(root,'review.md'),md,{flag:'wx'});writeFileSync(join(root,'index.html'),html,{flag:'wx'});
const link='../'+relative('.',root).replaceAll('\\','/');
writeFileSync('reviews/M4_STABILIZATION_REVIEW.md',`# M4 bounded stabilization and acceptance — 11 October 2026\n\n[Open the consolidated review package](${link}/index.html) or [read the checklist and evidence notes](${link}/review.md).\n\nOwner-observed popup collision fixed; visual direction accepted; workspace motion NOT visually accepted. Genuine reservation Turnstile, Google and physical-phone checks remain outstanding. M3 remains closed under its revised criterion; M4 open only for listed acceptance; M5 publication paused. No push or deployment. Prior reports and the 21 unrecovered-item incident remain unchanged.\n`,{flag:'wx'});
console.log(join(root,'index.html'));
