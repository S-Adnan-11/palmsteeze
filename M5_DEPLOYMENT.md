# PalmSteeze M5 deployment preparation

Status, 5 October 2026: code preparation complete; **application publication NOT RUN**. The owner partially reviewed M4 and accepted the current direction to progress. Uninspected screens, Safari and physical devices remain acceptance work. M3 remains closed under the approved permanent-refund-rejection criterion; original replacement FAILED evidence and outstanding-reimbursement semantics remain unchanged.

## Concrete intended target and release gate

Use **Vercel Hobby**, a personal, noncommercial portfolio demo, with project name `palmsteeze` subject to account/name availability. Source: `delivery/m5-hosted-preview`. Technical **Production** environment means the stable sandbox demo hostname, not live payments. Candidate canonical origin: `https://palmsteeze.vercel.app`; it is **not reserved or verified**. Use the account's available stable `*.vercel.app` alias if that candidate is unavailable. No custom domain is required.

The redesign was reviewed/sanitized and pushed **before deployment changes** as `7c0d832a9444a1683995ec0bc0c9fc22c8afa9c4` on `redesign/m4-brand-v2`. `main`/`origin/main` remain `0e0becf3286a61e58012cb385f62cc515e2135f6`. All outgoing baseline blobs and current files were checked against populated private credentials and actual Auth IDs/emails. Local plan/reports/evidence/brand archive remain excluded. No reset or force-push occurred.

| Readiness item | Current evidence / remaining action |
|---|---|
| Free hosting suitability | Current [Hobby documentation](https://vercel.com/docs/plans/hobby) permits personal noncommercial use. This fictional sandbox portfolio is suitable by that description; actual owner account plan/remaining quotas are unverified. Choose Hobby, not a Pro trial. |
| Hosting access / hostname | No Vercel account connection, linked project or reserved hostname. Owner must authenticate and select the stable alias. |
| Build / install | Exact npm 11.19.0 bootstrap/locked clean install passed in an isolated folder. Node 24.21.0 production build passed with only seven hosted variables and no local secret file. Vercel cloud/Linux build NOT RUN. |
| Runtime constraint | Vercel supports [Node 24.x](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) and automatically updates its patches. Package requires >=24.21.0 <25. Hosted preflight refuses an older image; check cloud logs before release rather than weakening the pin. |
| OAuth / cookies | Local production proof passed canonical hosted initiation, Secure/HttpOnly/SameSite=Lax cookies, private caching and Origin/Host denial. Actual hosted login/callback NOT RUN; Supabase currently retains local URL configuration. |
| Payments / webhook | Existing dedicated persistent sandbox, enabled signed-event subscriptions, worker secret hashes and Vault token/URL match. Unsigned webhook and publishable-only recovery rejected. No new Stripe object/payment/refund was created in M5 preparation. |
| Recovery / records | One unchanged minute job, latest cron dispatch succeeded and recent recovery-shaped pg_net HTTP response was 200 without timeout; existing provider/restart recovery evidence remains valid. Two original 30% snapshots, new 40%, 27 resources/44 seats and zero test identities reverified with certificate-verified TLS. |
| Worker return URLs | Hosted HTTPS support is prepared/tested; deployed worker remains on localhost. Same-function code/origin cutover requires selected hostname and exact hosted Auth settings. |
| Synthetic preview | Static synthetic data, no forms/API requests/mutations, no Auth refresh or refreshed cookies; desktop/mobile proof passed with an untrusted cookie. |
| Security audit | Production dependency audit: zero advisories. Four high entries in the development-only Next ESLint → fast-glob → micromatch → braces chain concern one [unpatched nested-pattern advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Repository-controlled lint patterns do not accept customer input. Keep build inputs trusted; monitor an upstream patch. Automatic major downgrade is inappropriate for Next 16. |
| First publication | Pending exact account/plan, hostname and configuration readiness report, then the owner's publication decision. No application deployment or paid feature has been enabled. |

`vercel.json` disables all automatic Git deployments. It pins the install command and runs `scripts/hosted-build.mjs`, which checks runtime, canonical HTTPS origin, dedicated project flags, publishable key, worker token and exclusion of privileged tooling credentials before Next builds. Private server-rendered pages remain dynamic; `/preview/admin` and `/portfolio` are static. Routes awaiting 40-second recovery allow 60 seconds. Recovery runs in Supabase, independently of Vercel request lifetime.

## Exact owner setup, before publication

1. Sign in to Vercel using the GitHub identity that owns this repository. Select a **Hobby** personal scope. Confirm its current plan, available usage and project/name availability; do not start a paid trial, attach paid Marketplace services or enable paid observability. Install/connect the Vercel plugin if you want Codex to perform account configuration. Account credentials remain private.
2. Create/link a project **without deploying**. With authenticated Vercel access Codex can do this. For manual setup on this VM, the pinned local CLI wrapper below supplies equivalent project-only operations. Keep Git integration disconnected through first publication: `main` contains the older checkpoint. Do not use bare `vercel`, `deploy`, dashboard **Deploy**, or an import wizard's final deployment button during setup.

   ```powershell
   .\scripts\vercel.ps1 login
   .\scripts\vercel.ps1 project add palmsteeze --scope YOUR_HOBBY_SCOPE
   .\scripts\vercel.ps1 link --project palmsteeze --scope YOUR_HOBBY_SCOPE
   ```

   `scripts/vercel.ps1` pins CLI 62.2.0 in the ignored workspace cache, with no global installation. `project add` creates project configuration; `link` links this directory. Choose your existing project instead if one is already intended. In its dashboard inspect Domains and reserve/confirm the exact stable free alias; do not assume a hostname from the project name alone. Do not purchase a domain. [Project CLI](https://vercel.com/docs/cli/project), [link CLI](https://vercel.com/docs/cli/link).
3. Project settings: Next.js framework; repository root; Node **24.x**; default Next output directory; install `npx --yes --package=npm@11.19.0 npm ci --include=dev`; build `node scripts/hosted-build.mjs`. Keep automatic Git deployment disabled. If later connecting Git, choose `delivery/m5-hosted-preview` as the production branch and verify suppression before any push. Enter **only** these seven variables in **Production** scope, using [the blank template](deployment/hosted.env.example). Mark the worker token sensitive/server-only. Do not import `.env.local` or copy private tooling credentials.

   | Variable | Value / source |
   |---|---|
   | `APP_ORIGIN` | Exact stable HTTPS origin, with no trailing slash, path, query or fragment |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://hjcntuysnzzkddpnulaa.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing public publishable/anon key from private configuration or the dedicated project's API settings; never the service key |
   | `SUPABASE_PROJECT_REF` | `hjcntuysnzzkddpnulaa` |
   | `PALMSTEEZE_DB_DEDICATED` | `true`, confirming this existing dedicated target |
   | `PALMSTEEZE_DB_FREE_CONFIRMED` | `true` after reconfirming this project's Free billing/available usage |
   | `PALMSTEEZE_PAYMENT_WORKER_TOKEN` | Existing value in ignored `.env.local`; must match the worker and Vault. No rotation needed. |

   Database password, service-role/secret key, Supabase Management token, Google client secret, Stripe key and webhook signing secret stay out of Vercel. Keep functional ephemeral Preview deployments disabled/unconfigured: their changing origins are not accepted Auth/payment destinations. The stable Production alias hosts the sandbox preview.
4. In the **existing** Supabase project's Authentication → URL Configuration, set Site URL to the selected HTTPS origin and add the **exact** `https://YOUR-STABLE-HOST.vercel.app/auth/callback`. Preserve `http://localhost:3000/auth/callback` for local development and any other already accepted exact entries. Avoid wildcard production redirects. Google's Web OAuth authorized redirect remains `https://hjcntuysnzzkddpnulaa.supabase.co/auth/v1/callback`; provider/client secrets stay in Supabase. This app uses server OAuth via Supabase, so it needs no new direct Google browser integration. If consent is in Testing, privately include intended phone/reviewer accounts as test users. [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls).
5. In the existing Supabase and Stripe dashboards confirm Free usage capacity and the **persistent PalmSteeze Development sandbox**, then provide the selected Vercel scope/project/hostname and confirmation that variables/URLs are saved. These are nonsecret readiness details. Codex can recheck the selected infrastructure and report the exact publication configuration. **Do not publish yet.** This gate comes from the owner's instruction to report concrete target/readiness before first publication; the missing account and hostname prevent that final verification now.

## Cutover prepared for Codex after the publication decision

Use the same Supabase project, payment function, Stripe sandbox, endpoint, signing secret, opaque token and protected schedule. No migration, database reset, seed replay, new project, new webhook or new cron is needed. Stop local booking traffic while changing the single worker origin. Finish or safely expire existing open sandbox sessions before the walkthrough; their saved Stripe return URLs do not change retroactively. The tool refuses cutover if uncertain session creation exists, preserving Stripe's stable idempotency parameters.

From this VM, with the existing private local configuration intact and the chosen canonical origin substituted:

```powershell
.\scripts\npm.ps1 run hosting:inspect '--' '--origin' https://YOUR-STABLE-HOST.vercel.app
# After exact target/readiness report and publication decision:
.\scripts\npm.ps1 run hosting:prepare-worker '--' '--origin' https://YOUR-STABLE-HOST.vercel.app
```

`hosting:inspect` is read-only apart from new local sanitized evidence and rejection probes. Quote npm's `'--'` separator in PowerShell so it reaches npm and preserves `'--origin'`. `hosting:prepare-worker` verifies the existing sandbox/function/secrets/Vault/schedule, requires the exact hosted Auth settings and zero uncertain Session creations, deploys to the **same** `palmsteeze-payments` slug and changes **only** `PALMSTEEZE_APP_ORIGIN` to the canonical HTTPS origin. It then checks authenticated empty recovery for an independently verified unknown booking (zero jobs) and unsigned-webhook rejection. It preserves other secret values, Vault, cron and all records. Ordinary `payments:prepare` maintenance now preserves the established origin. The cutover branch is prepared, not executed or claimed verified on the provider.

The webhook remains `https://hjcntuysnzzkddpnulaa.supabase.co/functions/v1/palmsteeze-payments/webhook`; it verifies raw-body Stripe signatures. There is no Vercel webhook receiver or signing secret. Recovery remains `/recover`, protected by the existing opaque token. `palmsteeze-payment-recovery` invokes `private.invoke_payment_recovery()` every minute, at most two leased jobs per call, using the two existing Vault secrets. Reusing it avoids Vercel cron constraints and dependency on browser activity.

After the gate, deploy the reviewed M5 commit explicitly from this branch using the linked project/scope, then inspect cloud build logs, selected commit and the stable alias before testing:

```powershell
.\scripts\vercel.ps1 --prod --scope YOUR_HOBBY_SCOPE
.\scripts\npm.ps1 run hosting:smoke '--' '--origin' https://YOUR-STABLE-HOST.vercel.app
.\scripts\npm.ps1 run hosting:inspect '--' '--origin' https://YOUR-STABLE-HOST.vercel.app
```

The smoke probe checks real HTTPS, public pages, no-store responses, anonymous denial, canonical OAuth initiation, Secure cookies and unsigned-origin denial without making bookings or payments. It does **not** claim a completed Google login or real-device check. No hosted probe has been run yet. Hosted owner/customer cookies and records must never be captured in public screenshots or logs.

## Hosted acceptance checklist (pending)

- [ ] Cloud build: correct M5 commit, Node >=24.21.0 <25, exact npm 11.19.0, seven-variable preflight, no credential logging; stable HTTPS alias and fictional-venue/test-payment disclosures. Confirm no accidental old-main/ephemeral deployment.
- [ ] Actual phone: record phone/OS/browser/date; on Safari for iPhone or Chrome for Android, open the stable URL from a fresh normal-browser session. Browse/filter desks/rooms, use the native date/hour controls, inspect quote/40% minimum/higher/full options and invalid-amount disabled state, then Google sign in and return to the same selection. Cancelled sign-in should give usable recovery. Check text/naira, images, focus where available, portrait/landscape and no horizontal scrolling. Do not call desktop emulation a phone pass.
- [ ] One isolated **new sandbox** visit on that phone: complete the normal successful test card flow, verify the return stays on the stable URL and confirmation comes from reconciled Stripe state, reload/bookings history, then sign out/re-authenticate. Use only provider test details. Avoid repeating the M3 failed-replacement proof; its original failure stays historical. Clear/release only this walkthrough's fixtures using supported operations.
- [ ] Real administration: assigned owner only; inspect the previously unreviewed overview, booking detail/history, resource/rate, availability, refund/recovery and audit screens. Confirm collected money differs from booking value, cancellation differs from successful refund, and permanently rejected reimbursement remains outstanding. Signed-out and ordinary-customer admin denial must remain correct; do not edit old records merely to review UI.
- [ ] Synthetic preview: inspect all six sections with no real identifiers or mutation/API requests. Case study remains behind **About this project**; preview stays out of primary customer navigation. Inspect loading, empty, unavailable/error, disabled and reduced-motion states carried from M4, plus keyboard focus on desktop. Mark each unchecked screen explicitly rather than giving blanket visual acceptance.
- [ ] Hosted operations: signed completion is durably received/processed at the existing Supabase webhook; unsigned delivery fails; the existing minute schedule reconciles without a browser. Review provider delivery and cron/HTTP outcome separately from browser return. Run the non-mutating hosted smoke/infra probes and retain sanitized evidence. Recheck historical snapshots, fixture cleanup and original failed-refund evidence after the isolated walkthrough.

## Zero-budget operation and recovery

Current [Hobby quotas](https://vercel.com/docs/plans/hobby) include 100 GB transfer, 1 million function invocations, 4 CPU-hours and 360 GB-hours; exceeding limits may suspend functionality until replenishment. The [Supabase Free plan](https://supabase.com/pricing) currently includes a 500 MB database, 5 GB egress, 500,000 Edge invocations and a one-week inactivity-pause policy. One minute schedule is about 43,200 calls per 30 days before webhooks/customer recovery. Account-wide current usage is an owner dashboard check, not established by the per-project health check. Generated WebP images and fonts are local assets; no paid image service is required.

Keep free usage notifications enabled. Do not upgrade or add paid capacity if a quota is reached. Report/pause demo traffic, inspect scheduled calls and resume the existing Free project through supported dashboard controls if paused; retain durable jobs until verified reconciliation. Never disable signature checks or release uncertain inventory to mask an outage. Existing pending provider work needs reconciliation before reopening booking traffic.

For a bad application release, use the last **hosted-compatible** reviewed Vercel deployment at the same canonical origin. `0e0becf` and the M4 checkpoint are preserved source history, not verified hosted rollback artifacts. Never roll back database migrations or restore over existing bookings. Keep private exports/evidence outside Git; free hosting is not a backup guarantee. Rotate credentials only for a concrete need, synchronizing worker/Vault/Next server deliberately. No service spending, live Stripe configuration or external reimbursement is authorized.

## Verification record

Passed: 15 units; TypeScript through hosted and restored local production builds; lint; isolated locked install; zero production dependency advisories; 25 browser assets against six populated private credentials with zero matches; two desktop/mobile production checks with zero preview API/mutation requests or axe violations, plus two existing anonymous API regressions affected by the origin change; read-only actual infrastructure/snapshot audit. CLI 62.2.0 wrapper verified; `whoami` reports logged out. All 45 pre-M5 JSON evidence files remained byte-identical. Production screenshots use synthetic admin records and anonymous homepage data, in `docs/screenshots/m5/`; fresh reports are under `docs/evidence/m5/`. The first build attempt exposed a test-only TypeScript header union error, fixed before the passing run. No database or financial proof was manufactured.

Cloud hosting, actual hosted OAuth/payment return and an actual-phone walkthrough remain **NOT RUN**. M5 remains open until publication and hosted acceptance are completed.
