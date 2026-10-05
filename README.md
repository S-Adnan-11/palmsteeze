# PalmSteeze Workspaces

A fictional Lagos coworking venue: 24 desks and three whole meeting rooms, 27 resources / 44 seats. M1/M2/M3 are complete in the development sandbox; M3 uses the owner's approved permanent-refusal exception, preserving actual replacement creation FAILED. Brand Kit v2 is approved. On 5 October 2026 the owner accepted the redesign's current visual direction for progressing to M5 after partial screen review. Comprehensive visual and physical-device acceptance remain outstanding. No publication, paid service or live-money payment occurred.

Local review: `http://localhost:3000` (customer browsing), `/preview/admin` (explicitly synthetic/read-only), `/portfolio` (architecture explanation). [M4 review and screenshots](M4_REDESIGN_REVIEW.md), [architecture](docs/ARCHITECTURE.md), [asset provenance](ASSET_PROVENANCE.md). Public demo/captures contain no real customer/admin identity. Hosting remains M5.

[M5 deployment readiness, exact owner setup and hosted acceptance checklist](M5_DEPLOYMENT.md). Code preparation targets Vercel Hobby; no application publication has occurred. The stable hostname/account and hosted callbacks remain to be configured. Use only `deployment/hosted.env.example` for hosting, keeping local tooling credentials private.

Hours, desk split, room names and rates remain **proposed configurable working defaults**. Brand Kit v2 logo family, palette and typography are owner-approved. The owner explicitly approved the **40% working deposit** after Stripe rejected the original NGN 600 minimum. New deposits start at NGN 800; original customer bookings retain their 30% snapshots. Money storage/calculation/provider amounts are integer kobo; all monetary displays and entry use naira. Initial payment can be minimum deposit, a higher amount or full price; approval returns the entire collected payment less prior refunds. Historical snapshots remain intact. Time is Africa/Lagos.

Actual hosted payment, natural signed webhook, authoritative confirmation, full sandbox refund and unattended protected recovery passed. Read [checkout/recovery flow and key files](docs/M2_CUSTOMER_CHECKOUT.md) and [test results](TEST_REPORT.md). Existing accounts/bookings are preserved; no further M2 account setup is needed.

The explicitly assigned verified owner account can open `/admin` after Google sign-in. Booking decisions/refund recovery, resources/future rates, closures/hours and audit are protected on the server and database. Two additional verified administrators can be assigned deliberately later. All eight owner-observed checks remain passed. [Administration](docs/M3_ADMINISTRATION.md), [identity/payment decisions](docs/M3_IDENTITY_AND_PAYMENT_DECISIONS.md). Actual delayed refund failure/signed receipt and permanent provider refusal are verified; the revised stop/history/assistance criteria separately passed, while replacement creation remains FAILED. [Future manual assistance](docs/REFUND_ASSISTANCE.md). No external reimbursement or settlement operation exists.

## Run on this Windows workspace

```powershell
.\scripts\bootstrap-runtime.ps1
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run dev
```

Open `http://localhost:3000` in the VM's browser. Use this exact origin for Google sign-in; `127.0.0.1` is the server's bind address but is a different browser origin. The portable Node 24.21.0 runtime is SHA-256 checked against the official manifest and lives in ignored `.tools/`; machine-wide Node is unchanged. The npm wrapper uses its bundled npm 11.19.0, disables Next telemetry, and keeps caches/browser downloads in the workspace. npm's `engine-strict` prevents silently using a different runtime. Direct package pins and `package-lock.json` reproduce dependencies. On other platforms install the exact Node version through your usual version manager and use the equivalent npm commands.

Without Supabase configuration, the page explicitly displays **preview inventory and sample quotes**. It never claims that fixtures are available, creates a fixture booking, or returns simulated live API success. A configured provider failure shows an unavailable state instead of quietly falling back to fixtures. The redesign uses self-hosted OFL fonts and six generated fictional interiors, with no remote asset dependency or paid stock. See ASSET_PROVENANCE.md and THIRD_PARTY_NOTICES.md.

## Private database configuration

Copy `.env.example` to ignored `.env.local` in a private editor. Do not send secrets to chat. Fill:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: this project's public API URL/key.
- `SUPABASE_PROJECT_REF`: the same project's reference. Name must be `palmsteeze-dev`.
- `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`: **Connect > Session pooler** values. User is `postgres.<reference>`, port 5432, database `postgres`. Do not use the transaction pooler for proof connections.
- `SUPABASE_ACCESS_TOKEN`: a private personal Management API token from Supabase account token settings; only tooling uses it to verify this exact project's name/reference/healthy status. It is not a browser key.
- `SUPABASE_SECRET_KEY`: this project's server-only secret/legacy service-role key, used only by the integration runner for creating and deleting genuine Auth test identities. Application routes never use it.
- Set `PALMSTEEZE_DB_DEDICATED` and `PALMSTEEZE_DB_FREE_CONFIRMED` to `true` only after checking that this is the dedicated development project on Free. Billing remains owner-attested; tooling does not list unrelated projects or change subscriptions.
- `DATABASE_CA_FILE` is optional only when Node already trusts the chain. On this VM, inspection returned `SELF_SIGNED_CERT_IN_CHAIN`, so it is required: in the `palmsteeze-dev` dashboard open **Database Settings → SSL Configuration → Download Certificate**. Save the PEM certificate as `C:\Users\Administrator\Desktop\projects\palmsteeze\.tools\certs\prod-ca-2021.crt`, then privately set `DATABASE_CA_FILE=.tools/certs/prod-ca-2021.crt` in `.env.local`. Both paths are Git-ignored. Keep certificate and hostname verification enabled. [Supabase's certificate instructions](https://supabase.com/docs/guides/platform/ssl-enforcement).

Existing dedicated project access can be configured now. If one must be created, use Supabase Free, name `palmsteeze-dev`, choose an available region, and save the generated database password privately. Do not reuse unrelated projects or upgrade to bypass free capacity. No Google/Stripe/Vercel credentials are needed for M1.

```powershell
.\scripts\npm.ps1 run db:inspect
.\scripts\npm.ps1 run db:migrate
.\scripts\npm.ps1 run db:seed
.\scripts\npm.ps1 run test:db
```

Inspection verifies project identity through the Management API, reference consistency, session pooler, certificate-verified TLS, PostgreSQL version, relevant roles, schema permissions and extension availability. A target with unknown tables/routines/types or no recognized migration history is refused. No reset/adoption operation exists. Inspect output contains only nonsecret status and selected schema metadata. Migration tooling uses a transaction, advisory lock, and migration checksums; seed is insert-only and repeatable. Changing applied SQL is refused. Test setup/cleanup touches only run-owned Auth identities/bookings/closures; rate/policy-change checks roll back.

## Request and database flow

1. The server loads public inventory/settings through the public Supabase key and RLS. The customer chooses a resource and explicit Lagos hours. A browser estimate is advisory.
2. `GET /api/availability` asks PostgreSQL for resource IDs and occupied/free booleans. `GET /api/quote` validates operating hours, lead time and horizon in PostgreSQL, then reads the latest effective rate and calculates the quote. No private customer/allocation details are disclosed.
3. `POST /api/holds` requires same origin and a genuine Supabase session verified with `getUser`. Only `resourceId`, `startsAt`, `endsAt`, `requestId` are accepted; ownership comes from `auth.uid()` in SQL. No login bypass, client role, client price, or payment status is accepted. M2a's Google UI supplies cookie sessions; genuine bearer tokens remain supported for API clients. Invalid bearer credentials are rejected even if the request also has a valid cookie.
4. `create_hold` serializes repeated work for one customer, validates the selected resource/settings, computes an authoritative quote, and inserts both the booking snapshot and active allocation in one transaction. A GiST exclusion constraint on `(resource_id, period)` rejects overlapping active allocations. Holds and administrator closures share this table and constraint; `[start,end)` permits adjacent intervals. Any failure rolls back both inserts. Retry with the same request ID returns the same active hold; changed or expired requests cannot reuse it.
5. Customers may read their own booking/allocation records and release their holds. They cannot directly write those tables, prices, venue settings, or roles. RLS filters cross-customer reads, and guarded SQL routines authorize mutations. The admin assignment lives in a private table; profile metadata never grants administration. Closure operations require that protected assignment.

Legacy M1 holds remain unpaid with original snapshots and their existing local-expiry rule. M2 payment-backed allocations are protected until authoritative provider reconciliation verifies expired/unpaid or paid state; a local timer alone cannot release them. One protected operational minute schedule performs bounded durable recovery. See the checkout guide for the complete current contract.

## M2a Google configuration and authentication flow

The nonsecret local configuration is:

| Setting | Exact value |
|---|---|
| Application origin / port | `http://localhost:3000` / `3000` |
| Google Web client authorized JavaScript origin | `http://localhost:3000` |
| Google Web client authorized redirect URI (Supabase provider callback) | `https://hjcntuysnzzkddpnulaa.supabase.co/auth/v1/callback` |
| Supabase Authentication → URL Configuration → Site URL | `http://localhost:3000` |
| Supabase allowed application redirect URL | `http://localhost:3000/auth/callback` |
| Public application variables | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — already populated privately |
| Server application variable | `APP_ORIGIN=http://localhost:3000` — also the local default, shown in `.env.example` |

The owner has created the Google Web OAuth client and privately entered its client ID/secret in **Supabase Authentication → Sign In / Providers → Google**. No Google client secret belongs in application code or a public variable. If Google's consent screen is in Testing, add the intended Google account to its test-user list privately in Google Cloud. Do not enable paid products. The read-only `auth:inspect` check verifies Google enabled, client configured, matching Site URL and exact app callback; it never displays provider credentials. Its attempted callback-only dashboard update returned HTTP 403; the owner saved the callback through the dashboard, and the read-only recheck passed.

Visitors browse live inventory without a session. Continue to booking review carries only the selected resource/date/hour/duration to `/login`. `POST /auth/sign-in` verifies the request Origin and Host, accepts only an allowed local destination, saves it in a short-lived HttpOnly cookie, and starts Supabase Google OAuth with PKCE. Supabase sends the visitor to Google and receives Google's response at its own provider callback. Supabase then sends a single-use code to the application's fixed `/auth/callback`.

The callback exchanges that code using the browser's PKCE verifier cookie and verifies the identity with Supabase Auth `getUser` before returning to the saved page. It accepts no callback-provided user or redirect destination. Cancelled, malformed or expired callbacks show a recovery message. On the review page the server asks PostgreSQL for fresh availability and an authoritative quote. The create-hold button rechecks both again; the database validates and allocates atomically on submission. A quote change asks the customer to review the new price. Sign-in itself never creates a hold.

`src/proxy.ts` refreshes sessions and forwards refreshed cookies to both server rendering and the browser. Every protected page/API independently verifies identity with Auth; cookie storage user data is never authoritative. Sessions use HttpOnly, SameSite=Lax cookies, with Secure enabled for HTTPS origins. The application uses server-side Auth only; it has no browser Supabase Auth client, password-login route or test-login bypass. New users have ordinary customer access. Administration still requires an explicit private database assignment; first sign-in and profile metadata cannot grant it.

`/account` shows the verified customer's own records under RLS. `POST /auth/sign-out` signs out this browser, clears its session cookies and returns to login. All dynamic pages/APIs/auth responses are private and no-store, and Supabase fetches bypass Next caching. JSON/auth handlers also vary on Cookie/Authorization; Next owns the HTML/RSC Vary header. No-store prevents response or refreshed-cookie reuse across customers. Callback redirects use no-referrer and clear inherited URL fragments.

This follows the supported `@supabase/ssr` cookie approach and Next 16 Proxy convention. We use `getUser` for fresh Auth-server identity validation rather than trusting stored session data. [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs), [Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [Next Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).

To run authentication checks, first stop any separately running local server; Playwright owns port 3000 during its tests:

```powershell
.\scripts\npm.ps1 run auth:inspect
.\scripts\npm.ps1 run build
$env:PALMSTEEZE_BROWSER_MODE='auth'
.\scripts\npm.ps1 run test:browser
```

In a fresh terminal, start the production app with `.\scripts\npm.ps1 run start`, then run `.\scripts\npm.ps1 run test:oauth-start` in another terminal. The latter proves the real application-to-Supabase-to-Google initiation only. It does not complete Google login. The automated auth suite uses genuine, temporary Supabase Auth identities and cleans up its own data. It disables session-bearing traces/videos/failure screenshots; captured customer-page screenshots redact only the fixture email.

**Manual Google check — PASSED by owner report:** the owner selected a visit, signed in through Google, created a hold, signed out, cleared cookies, signed in again and saw that hold. `.\scripts\npm.ps1 run auth:verify-google-evidence` corroborates Google-owned booking/allocation storage over verified TLS without exposing identity details or modifying data. This aggregate read is separate from the actual-role isolation tests. The exact selected-values/fresh-quote comparison, simple reload and direct `/account` access between sign-out and reauthentication were not individually reported; automated checks cover these behaviors.

For further manual regression: in the VM browser open `http://localhost:3000`, select a space and future date/hours, continue to review and Google, and complete login. Verify the same selection plus fresh quote, refresh to confirm persistence, open Your visits, sign out and revisit `/account` to confirm login is required. Report step outcomes or the visible message only; never share callback URLs/codes, cookies or credentials. For M2, continue through sandbox Checkout with test card 4242 4242 4242 4242, a future expiry and any three-digit CVC; verify confirmed/paid details and history. Use only sandbox test cards. Full M2 automated payment/recovery proofs pass; a new owner-interactive Google checkout walkthrough has not been reported.

## Key files

| File | Purpose |
|---|---|
| `src/app/page.tsx`, `src/components/workspace-explorer.tsx` | Responsive shell, filterable inventory, quote/availability interface |
| `src/lib/catalog.ts`, `src/lib/fixtures.ts` | Explicit live/preview/unavailable boundary |
| `src/lib/domain.ts` | Proposed defaults, Lagos input conversion, integer quote rounding |
| `src/lib/supabase/server.ts`, `src/app/api/` | Verified Auth sessions and protected server operations; no privileged key |
| `src/proxy.ts`, `src/lib/auth/` | Session refresh, safe destinations, same-origin checks and private response headers |
| `src/app/auth/`, `src/app/login/` | Google PKCE start, code callback, sign-out and recovery messages |
| `src/app/booking/review/`, `src/app/account/`, `src/components/hold-actions.tsx` | Protected fresh quote, customer history, authenticated hold/release requests |
| `scripts/auth-configuration.ts`, `scripts/prove-oauth-start.ts`, `scripts/verify-google-evidence.ts` | Secret-free configuration inspection, live Google initiation and read-only Google booking corroboration |
| `tests/browser/auth.spec.ts`, `tests/unit/auth.test.ts` | Genuine customer sessions, identity tampering, isolation, redirects and sign-out |
| `supabase/migrations/0001_foundation.sql` | Schema, shared conflict model, RLS and guarded routines |
| `supabase/seed.sql` | Repeatable 16 open desks, 8 quiet desks, rooms for 4/6/10 |
| `scripts/lib/database.ts`, `scripts/database.ts` | Safe inspection and checksummed migrations |
| `tests/database/proof.ts` | Real Auth fixtures, actual SQL roles, independent concurrent clients |
| `tests/unit/`, `tests/browser/` | Domain boundaries, production-server browser smoke, axe checks |

## Verification

M3 database proof: `.\scripts\npm.ps1 run test:admin-db`. Core administration browser proof: `$env:PALMSTEEZE_BROWSER_MODE='admin'; .\scripts\npm.ps1 run test:browser`. Keep the old `PALMSTEEZE_ADMIN_ASYNC_REFUND_PROOF` flag unset: its replacement-success condition is historical, not the owner-revised contract. Actual natural failure and permanent refusal were proved by the retained runner's `prepare revised`, `observe revised`, `replace revised`, `verify-blocked revised`, then `scripts/prove-refund-assistance.ts`; `archive-blocked revised` exports complete evidence before fixture-only retirement. The original FAILED artifact stays unchanged, while the revised exception is separately PASSED. Journals are now archived; do not rerun preparation over them. `run m3:final-audit` checks preservation/configuration. Stop the manually started app before full Playwright checks; they start a production server on port 3000. [Current results](TEST_REPORT.md).

M4 browser proof: `$env:PALMSTEEZE_BROWSER_MODE='portfolio'; .\scripts\npm.ps1 run test:browser`. This checks real Chrome desktop/mobile, accessibility/keyboard/overflow, live Auth identifiers/names absent from public content, and synthetic navigation without forms, mutations or API calls. Public presentation captures are `docs/screenshots/m4-*`; actual-role refund captures remain private. No hosting is performed by this command.

```powershell
.\scripts\npm.ps1 run typecheck
.\scripts\npm.ps1 run lint
.\scripts\npm.ps1 test
.\scripts\npm.ps1 run build
.\scripts\npm.ps1 run test:browser
```

Browser smoke uses the installed **Chrome channel** (154.0.8037.59 on this VM) against the production server, captures desktop/mobile screenshots in `docs/screenshots/`, and checks filters/quotes, responsive overflow, keyboard access, axe violations and unauthenticated API rejection. Live screenshots are `m1-live-desktop.png` and `m1-live-mobile.png`; earlier preview captures retain their original names. Playwright's matching Chromium download timed out; a real installed Chrome successfully runs the checks. Install Chrome if absent on another machine, or download Playwright Chromium and change the test channel there. Mobile checks use Chrome with an iPhone-sized touch viewport, not a physical iPhone or Safari.

Browser checks select the live suite when `.env.local` contains the public Supabase URL, otherwise the preview suite. Live checks require the migrated/seeded database and test real catalogue reads, availability and authoritative quotes, alongside anonymous rejection and layout/accessibility. `PALMSTEEZE_BROWSER_MODE=unavailable` explicitly selects a separate configured-service failure diagnostic; it cannot establish successful live integration. The original preview checks and screenshots remain preserved. On this managed execution environment, some commands need approved execution outside the sandbox for package downloads, Node user lookup, native compilers or browser subprocesses. That does not require changing AWS infrastructure.

See `TEST_REPORT.md` for actual results and remaining gates. Mocked/preview checks do not substitute for PostgreSQL, genuine Google login, or payment-provider verification.

## M4 Brand Kit v2 redesign

Checkpoint: `0e0becf3286a61e58012cb385f62cc515e2135f6` was verified against GitHub `origin/main` on 5 October 2026. Work continues on `redesign/m4-brand-v2`; no reset or force-push.

The homepage, real admin overview, explorer, review/payment choice, customer history, booking details, administration and six-section synthetic preview use the approved brand. Shared presentation components supply the real/preview sidebar, metrics, searchable booking list and refund obligations. The case study is linked as About this project in the footer; the admin demo is reachable from that project page. The preview remains independently synthetic and read-only. M4 requires owner visual acceptance; hosting remains M5.

Run the complete relevant browser regression after building and freeing port 3000:

```powershell
$env:PALMSTEEZE_BROWSER_MODE='redesign'
.\scripts\npm.ps1 run test:browser
```

This selects live catalogue/access checks, genuine sessions, actual sandbox checkout, administration and visual/state tests. The visual test additionally inspects 360px and 768px widths, focus/reduced motion, empty search, delayed checks, quote errors and unavailable selections. Fault responses in the visual test are controlled browser fixtures, not real provider failures. Current screenshots live under `docs/screenshots/m4-v2/`; reports/docs retain their existing Git exclusions. Authenticated screenshots use run-owned test records; real-admin totals are masked. [Assets and exact prompts](ASSET_PROVENANCE.md), [licences](THIRD_PARTY_NOTICES.md).
