# Shared demo release continuation — 17 October 2026

The owner has authorized M5 publication to **https://palmsteeze.devs.surf** once checks/configuration are ready; older publication-pause statements below are historical. Preserve localhost and this exact authenticated tunnel. Application request privileges remain environment-specific: hosting accepts only its canonical origin. The shared backend capability/return destination list now includes the exact hosted origin as well as the two development origins. Worker v21 supports persisted initiating origins while retaining all secrets, historical localhost fallback, webhook and the existing single recovery schedule. Existing Stripe sessions/return URLs remain immutable. Current venue settings/default are Agege, Lagos (0026), with historical snapshots untouched.

Vercel Hobby project preparation is separate from actual publication. Supabase hosted URL configuration and genuine hosted Turnstile remain required. The owner controls only palmsteeze.devs.surf; Vercel currently requires a parent-level `_vercel.devs.surf` TXT, which needs operator assistance. Do not replace the intended canonical address or assume parent DNS access. Local database mutations affect the hosted demo; keep proofs fixture-scoped.

# PalmSteeze development tunnel

M4 remains open. M5 publication remains **PAUSED**. This change supports a development preview and retains the approved UI, video, business rules and historical records.

**Current status (17 October 2026): development tunnel activation complete.** Migration 0025 is committed; development worker version 20 retains all existing function secrets. All 43 actual-role/concurrency checks and historical business-record preservation hashes pass. Both exact Supabase OAuth callbacks are allowed. The existing tunnel is reconnected at **https://4fs16bjg-3000.euw.devtunnels.ms**, with Host and Origin preserved on port 3000, the original hostname/policies unchanged and anonymous connect explicitly denied. All **19 actual authenticated HTTPS checks** pass, and real desktop/mobile Chrome renders the genuine verification widget. Genuine successful verification, completed Google sign-in, sandbox returns and owner/physical-phone acceptance remain unconfirmed.

## Tunnel operation

Owner GitHub device authorization completed. No further CLI account action is required. The existing VS Code tunnel is `joyful-pond-fhc87t8.euw`, verified from its actual port-forwarding URLs rather than inferred from the short web hostname. Both the tunnel defaults and port 3000 now set `isHostHeaderUnchanged=true` and `isOriginHeaderUnchanged=true`. Full service readback confirms the root and port access policies and exact hostname match the private before snapshots. The port retains its explicit anonymous-connect deny.

Inspection also found zero host connections (last connected on 16 October). The CLI reconnected the **same existing ID**, with its existing port and access policy. Both the local Next server and this authenticated relay are now running. If they stop, restart them in separate PowerShell terminals from this repository:

```powershell
./scripts/npm.ps1 run dev
```

```powershell
./scripts/tunnel.ps1
```

**After a PC restart:** start the dev server, then run `./scripts/tunnel.ps1` in a second terminal. It validates the exact existing hostname before making changes, restores header preservation on both levels, and leaves the access policies unchanged. If VS Code already hosts the tunnel, the helper checks real HTTPS and returns. If disconnected, it reconnects the same existing ID and stays open. `./scripts/tunnel.ps1 -CheckOnly` inspects without changing settings. If the CLI login expires, use `./.tools/devtunnel/devtunnel.exe user login -g -d` with the same owner account.

Keep the explicit existing ID. Do not use a bare `devtunnel host`, create a replacement or add anonymous access. CLI authentication is separate from VS Code authentication and Google sign-in inside PalmSteeze. Authenticated external proof used a private connect-only token attached only to the exact application hostname; no token or cookie values appear in the review artifacts.

## Restart regression and correction - 17 October, 18:41 UTC

After the owner restarted the PC and forwarded port 3000 in VS Code, live metadata showed the same tunnel/hostname and unchanged authenticated policy, but the port options had reverted to `{isGloballyAvailable:true}`. Both preservation flags were absent; the tunnel defaults also lacked them. Actual HTTPS reproduced the application's 403 origin rejection. The earlier port-only fix did not survive that re-forwarding.

Restored both flags at the tunnel and port levels. To verify the observed reset pattern, temporarily removed only the port flags while keeping the port, hostname and access controls intact: the real tunnel inherited the parent defaults and returned the correct verification redirect (307) and same-origin POST (200). Explicit port flags were then restored. This proves the observed settings-reset case; a new physical-PC reboot was not performed. The new restart helper also repairs either level if VS Code changes the defaults in a later session. Application origin checks, genuine Turnstile, cookies and provider/database configuration were not weakened or changed.

Evidence: `docs/evidence/m4-tunnel-restart-20261017184129/`. M5 remains paused; genuine verification, Google completion and sandbox returns remain unconfirmed.

## Diagnosis and origin boundary

The original Proxy built entrance redirects from the single configured `APP_ORIGIN`, defaulting to localhost. Correcting the browser address did not repair verification: the POST same-origin check still required localhost's Origin and Host, and Siteverify metadata was checked against the configured localhost hostname. Clearance signatures, secure-cookie selection, OAuth callbacks and worker-created Stripe return URLs used the same single-origin assumption. Cloudflare's dashboard hostname list was not independently inspected. The genuine widget now renders its challenge on the actual tunnel in desktop/mobile Chrome without a hostname error; successful human verification remains an owner check.

The centralized development list is [application-origins.ts](supabase/functions/_shared/application-origins.ts):

- `http://localhost:3000`
- `https://4fs16bjg-3000.euw.devtunnels.ms`

Keep local `APP_ORIGIN=http://localhost:3000` (its existing default also works). Host selects only an exact configured origin. Unknown hosts fail with 403, including public pages and assets. Forwarded headers never add an origin; supplied forwarded host/protocol must agree with the selected origin. Comma-separated, conflicting or spoofed claims fail closed. The internal Next URL may remain HTTP/localhost. Mutations additionally require an exact matching browser Origin; localhost and tunnel are **not** cross-origin mutation peers. Origin checks prevent browser cross-site requests; verified Auth, capability signatures and database permissions still establish authority.

Hosted `VERCEL`/`VERCEL_ENV` environments and canonical origins outside this development list accept only the configured canonical origin. Next.js **16.3.8** was inspected using its installed Proxy, async headers/cookies and `allowedDevOrigins` guides. The latter contains the two exact hostnames for dev assets/HMR; it does not authorize application requests. Browser test readiness/base URLs now use localhost, while the server still binds to loopback.

Entrance destinations retain safe relative paths/query/fragments; external, protocol-relative, encoded separators, traversal and auth/API/verification loops are rejected. Clearance remains signed, purpose/version/origin bound and absolutely expires after 30 minutes. Preferences remain separate, signed and origin bound. Genuine Siteverify checks require the **request's** hostname and the exact `entrance` or `reserve` action, with expiry and single-use checks intact. Dummy-key mode cannot serve the tunnel.

Auth, PKCE, saved-destination, clearance and preference cookies remain HttpOnly, SameSite=Lax and host-only, with Secure on external HTTPS. No localhost cookie Domain is set. OAuth start, callback, cancellation, retry and saved selection use the current validated origin and existing safe destination rules. Customer/admin navigation, assets and video remain relative. Return query flags never establish payment success.

## Owner configuration: exact values

1. **Tunnel forwarding:** preserve both Host and Origin for the existing tunnel's port 3000. Microsoft defaults can rewrite these headers to localhost; see the [official tunnel options contract](https://github.com/microsoft/dev-tunnels/blob/main/ts/src/contracts/tunnelOptions.ts). Set `isHostHeaderUnchanged=true` and `isOriginHeaderUnchanged=true`, with no overriding port-level rewrite. With an authenticated Dev Tunnels CLI, identify the existing tunnel (rather than creating a replacement), then use:

   ```powershell
   devtunnel update <existing-tunnel-id> --host-header unchanged --origin-header unchanged
   ```

   The flags are documented in [Microsoft's repository discussion](https://github.com/microsoft/dev-tunnels/issues/284). Confirm the existing port's options as well, since port options take precedence. The downstream Host must be `4fs16bjg-3000.euw.devtunnels.ms`; mutation Origin must be `https://4fs16bjg-3000.euw.devtunnels.ms`; forwarded protocol must be `https`. Do not solve rewritten headers by accepting arbitrary forwarded origins. Microsoft-signed CLI version 1.0.2115 is installed at `.tools/devtunnel/devtunnel.exe` and owner-authorized. Service metadata and live HTTPS checks confirmed both preservation options on port 3000. No replacement tunnel or anonymous access was created.

2. **Cloudflare Turnstile:** keep the existing genuine widget/key pair, Managed mode and pre-clearance disabled. In Hostname Management retain/add exactly `localhost` and `4fs16bjg-3000.euw.devtunnels.ms` (no scheme, port, slash or wildcard). Keep `PALMSTEEZE_TURNSTILE_TEST_MODE=false` or unset. See [Cloudflare hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/).

3. **Supabase → Authentication → URL Configuration:** retain the existing Site URL and entries; allow both exact additional redirect URLs:

   ```text
   http://localhost:3000/auth/callback
   https://4fs16bjg-3000.euw.devtunnels.ms/auth/callback
   ```

   Google stays enabled. Supabase must allow the application's `redirectTo`; otherwise its fallback can return a tunnel journey to localhost. See [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls). Management inspection on 17 October independently confirmed that both exact callbacks are allowed and Google is enabled; no Auth dashboard change was necessary.

4. **Google Cloud OAuth client:** retain the Supabase provider callback as an authorized redirect URI: `https://hjcntuysnzzkddpnulaa.supabase.co/auth/v1/callback`. The application's two `/auth/callback` entries belong in Supabase's allowlist. This implementation uses Supabase redirect OAuth; it introduces no Google GIS JavaScript SDK or new provider client. See [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).

5. **Tunnel access:** verified unauthenticated HTTPS requests to `/`, `/verify`, `/api/verification`, `/auth/callback` and the video all return 302 to `https://global.rel.tunnels.api.visualstudio.com/auth/github`. Use the tunnel owner's authorized browser/session for testing. Access policy was not changed. Authenticated access must remain enabled under the owner's 17 October instruction; no anonymous entry may be added. [Microsoft documents tunnel authentication](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/security).

No Stripe webhook URL, webhook secret, recovery URL, cron, Vault entry, provider account or canonical worker origin needs to change.

## Required development database/worker application

The existing private database boundary accepts only one capability origin, and scheduled workers cannot recover a browser origin from an HTTP request. Migration **0025_development_journey_origins.sql** therefore adds a private allowed-origin list and a nullable payment `return_origin`. It preserves the signing key, original JWT ownership, revoked legacy creators, authoritative quote/money/availability logic, atomic single-use consumption and idempotency.

The guarded Checkout wrapper stores the **signed initiating origin** only for a newly created attempt, in the same transaction as its job. The existing user lock prevents concurrent retries from changing that first origin. Historical attempts remain null and retain their previous configured-origin behavior. Existing Stripe sessions are reused, never recreated to change their URLs. Scheduled and request-triggered recovery read the persisted origin, validate it against the same explicit list, then construct their own success/cancel paths. Unsafe stored values defer creation. Production workers reject development return origins.

Before applying: refresh `SUPABASE_ACCESS_TOKEN` privately in ignored `.env.local`, without posting it in chat. Required scopes cover selected-project identity/Auth inspection, Edge Functions read/write and secrets readback. The tooling must verify healthy `palmsteeze-dev`, matching development project reference, dedicated/Free flags and certificate-verified database TLS. The earlier HTTP 401 was resolved by the owner's private token refresh. On 17 October the verified migration transaction committed, the existing worker advanced from version 19 to 20 with all secrets unchanged, and 43 actual-role/concurrency checks passed. No provider-dashboard mutation or M5 cutover was performed.

Run with the isolated Node runtime, in this order:

```powershell
$node = './.tools/node-v24.21.0-win-x64/node.exe'
& $node ./node_modules/tsx/dist/cli.mjs scripts/development-origins.ts before
./scripts/npm.ps1 run db:migrate
& $node ./node_modules/tsx/dist/cli.mjs scripts/development-origins.ts deploy-worker
$env:PALMSTEEZE_SECURITY_EVIDENCE='docs/evidence/m4-tunnel-20261016/database-security.json'
& $node ./node_modules/tsx/dist/cli.mjs tests/database/entrance-security.ts
& $node ./node_modules/tsx/dist/cli.mjs scripts/development-origins.ts after
```

The before/after proof compares aggregate historical-row hashes/counts without exporting records. The database proof uses actual anonymous/customer/assigned-admin/service roles and independent connections, including cross-origin concurrent retries and a signed unknown-origin rejection; it removes only its own fixtures and calls no payment provider. The worker command updates only the tracked development function, includes the shared module and asserts every existing secret is unchanged. It probes unsigned webhook and unauthorized recovery rejection. Migration history/checksums and local report/evidence exclusions stay intact. After the first recorded run, set `PALMSTEEZE_ORIGIN_EVIDENCE` to a new evidence directory and set `PALMSTEEZE_SECURITY_EVIDENCE` to its `database-security.json`, rather than overwriting preservation snapshots.

If application fails before commit, PostgreSQL rolls back. After application, the existing emergency rollback disables guarded reservation entry points while keeping legacy creators revoked; do not reset or undo historical rows. Keep the compatible worker when reverting application routing, since persisted return origins must remain safe and recoverable.

## Verification completed here

- Unit suite: **39 passed**, including both origins, unknown/spoofed hosts/proxy claims, cross-origin cookie rejection, independent Turnstile hostname/action checks, persisted worker origins, historical fallback and production rejection.
- TypeScript, ESLint and production build passed; the final rerun is recorded separately if subsequent changes require it.
- `scripts/verify-development-origins.ts` passes against the running local server using exact Host/Origin/proxy pairs for **both** journeys: entrance/deep-link redirects, unsafe next rejection, verification page, dev assets, MP4 206 range delivery, real Siteverify invalid-token rejection, cookie flags, OAuth start callback, cancel/retry selection restoration, forged callback rejection and authenticated/cross-origin mutation guards.
- Local Chrome desktop/mobile verification rendering and approved autoplay/no-controls playback pass. Screenshots and sanitized reports are in `docs/evidence/m4-tunnel-20261016/`.
- Earlier unauthenticated probes in `docs/evidence/m4-tunnel-20261016/external-tunnel.json` stopped at the tunnel authentication gate and remain preserved. Current **authenticated** external proof in `docs/evidence/m4-tunnel-activation-20261017/authenticated-https.json` passes **19 checks**: tunnel-preserving deep-link redirects, verification, Next dev assets, video range delivery, same-origin POST forwarding, secure host-only application cookies, three rejected foreign/null origins, unsafe destinations, genuine invalid-token Siteverify rejection, callback cancel/saved selection, forged callback rejection, Checkout gating and retained tunnel authentication. No fabricated successful clearance was used in this live proof.
- Remote database proof on 17 October: **43 checks passed**, including actual roles and independent concurrent connections. Sanitized before/after record hashes match exactly after fixture cleanup. Worker version **20** runs with all preexisting function secrets unchanged; unsigned webhook and unauthorized recovery still return 400/401. Current evidence: `docs/evidence/m4-tunnel-activation-20261017/`.
- `connected-tunnel.json` independently proves the same hostname, unchanged root/port policies, explicit anonymous-connect denial, connected host and both header-preservation flags. Real tunnel desktop/mobile screenshots and `tunnel-browser.json` show the genuine widget waiting for human verification; no challenge was solved by automation.
- Full Google completion, successful genuine entrance/reservation challenges, sandbox collection/cancel returns and physical-phone acceptance remain **not complete**.

## If the tunnel hostname changes

Update only the exact HTTPS entry in `supabase/functions/_shared/application-origins.ts`. `next.config.ts`, application checks and worker use that shared configuration; no wildcard or global localhost replacement is needed. Restart Next development (or rebuild/restart a production preview), provision the private database origin list using verified migration tooling, and update the same development worker with its shared module. Add the new exact Cloudflare hostname and Supabase `/auth/callback` URL; preserve Host/Origin on the replacement tunnel and repeat both-origin tests.

Resolve active Checkout attempts before removing the old origin. Their initiating origin and any existing Stripe URLs are intentionally immutable; removing an old origin causes new session creation for such attempts to fail closed. Do not rewrite booking/payment history to accommodate an expired tunnel. Retain an old origin temporarily only through an explicit reviewed configuration change when it remains owner-controlled. Remove its dashboard entries when no longer needed.

Browser login, PKCE, clearance, preferences and tab-scoped drafts are separate between localhost and the tunnel. Verification or sign-in on one does not sign in or clear the other. Both origins use the same Supabase development project, so database accounts and bookings remain shared; use the same Google identity to see the same visits after signing in on each.

## Short owner acceptance checklist

- [x] Apply migration 0025 and worker version 20; pass 43 actual-role checks and historical-record preservation hashes.
- [x] Complete owner CLI authorization; inspect/correct Host and Origin preservation on the same port, reconnect the same existing tunnel, prove unchanged authenticated policies and pass 19 live HTTPS checks.
- [ ] In a regular browser and on a physical phone, open the tunnel root and a booking deep link. Verify genuinely, confirm the address stays on the tunnel, refresh, check assets/video and verify again after clearance expires. Repeat on localhost independently.
- [ ] Choose a space/date/time, start Google, cancel once and retry; complete sign-in. Confirm the same origin and saved selection are restored and sign-out works. Repeat on localhost with the same identity.
- [ ] Complete a genuine reservation-action check and an intended **sandbox** booking/payment. Confirm Checkout success returns to the initiating origin and the visit reflects verified server/provider state. Test cancellation separately; it must not imply reimbursement completion. Confirm the same booking is visible after separate login on the other origin.

Record observed browser/device outcomes separately from automation. This checklist does not authorize M5 publication.
