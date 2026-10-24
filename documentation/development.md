# Development

## Toolchain and first run

The exercised local workflow uses Windows x64, PowerShell, Git, Node 24.21.0 and npm 11.19.0. The PowerShell wrappers download an official checksum-verified runtime into `.tools/`, use a project-local npm cache and leave the machine-wide Node installation alone.

From the checkout root:

```powershell
./scripts/bootstrap-runtime.ps1
./scripts/npm.ps1 ci
./scripts/npm.ps1 run dev
```

Open http://localhost:3000. The public introduction renders without configuration. Keep the terminal open; Ctrl+C stops development. Production uses `./scripts/npm.ps1 run build`, then `./scripts/npm.ps1 run start`. Both servers bind to loopback and need port 3000 free.

`package.json` declares Node >=24.21.0 <25 and exact npm 11.19.0. Other operating systems may run the JavaScript application with that toolchain, but the bootstrap and tunnel wrappers are Windows-specific. No cross-platform local test claim is made.

## Configuration

Copy `.env.example` to `.env.local` only when the destination does not already exist. Merge missing names into existing configuration. Keep values out of Git, command output and screenshots. Next.js loads environment from the checkout root; process environment takes precedence. Public build-time values require a rebuild when changed.

| Group | Names and purpose |
| --- | --- |
| Application origin | `APP_ORIGIN`, default `http://localhost:3000` |
| Public Supabase configuration | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_REF`; URL/reference must match |
| Dedicated target declarations | `PALMSTEEZE_DB_DEDICATED`, `PALMSTEEZE_DB_FREE_CONFIRMED`; required for configured service access |
| Signing | `PALMSTEEZE_SECURITY_SECRET`: server-only random 32 bytes as 64 lowercase hex characters; must match reservation database configuration |
| Turnstile | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `PALMSTEEZE_TURNSTILE_TEST_MODE`; matching keys for the exact hostname |
| Recovery | `PALMSTEEZE_PAYMENT_WORKER_TOKEN`: server-only credential for the existing worker |
| Database tooling | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, optional `DATABASE_CA_FILE`, `SUPABASE_ACCESS_TOKEN` |
| Auth fixture tooling | `SUPABASE_SECRET_KEY`, used by integration scripts for run-owned Auth users |
| Stripe tooling | `STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_ID`, `PALMSTEEZE_STRIPE_SANDBOX_CONFIRMED`, `STRIPE_WEBHOOK_SECRET`; sandbox only |
| Explicit role assignment | Exactly one of `PALMSTEEZE_OWNER_ADMIN_EMAIL` / `PALMSTEEZE_OWNER_ADMIN_USER_ID` for an existing verified Google account |

Blank Supabase URL/key selects synthetic inventory after entrance. Partial or failed configuration does not silently select a healthy service. The administration preview uses separate synthetic data and cannot operate the database.

For isolated loopback UI development, Cloudflare's [official test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) require `PALMSTEEZE_TURNSTILE_TEST_MODE=true`, a loopback `APP_ORIGIN`, and a matching official site/secret test pair. Supply a local signing secret too. Test-widget success establishes integration, not a genuine human challenge. Never use this configuration for hosting or against retained data without reviewing the test's mutation scope.

Google configuration lives in Supabase Auth. Register the exact application `/auth/callback` URL in Supabase and keep Google's provider callback directed to Supabase. The application requests `openid email profile`; it has no Google password field or provider secret in its frontend environment.

`supabase/functions/_shared/application-origins.ts` defines exact origins. Request Host headers select only from that list; forwarded headers cannot add origins. The authenticated tunnel wrapper reconnects an existing configured tunnel. It requires the signed CLI under `.tools/devtunnel/` and account access; ordinary localhost development does not require it.

## Persistence and migrations

Inventory, bookings, policies, payments and audits live in Supabase PostgreSQL. Signing configuration and durable recovery queues use a private schema. Supabase also holds Auth identities; a source checkout is not a database backup.

Database tooling requires the matching dedicated healthy `palmsteeze-dev` project, session pooler on 5432 and certificate-verified TLS. It refuses unrelated schemas and changed applied migration checksums. These guards make it unsuitable as a general database bootstrapper.

`db:inspect` reads the target. `db:migrate` changes schema/signing configuration; `db:seed` changes catalog/settings data. Review them before use and do not replay seeds over retained records. A shared development/hosted target means local mutations also affect hosting. Never reset it or restore over it to test recovery.

Generated `.next/`, `next-env.d.ts`, TypeScript build state, dependencies and browser caches can be recreated. SQL, lockfiles, fonts, posters and MP4s are build inputs and must be retained.

## Testing

| Check | What it establishes | Service access |
| --- | --- | --- |
| `run typecheck`, `run lint` | Route types, TypeScript and ESLint | None for normal source checks |
| `test` | Domain money/dates, destinations, signatures and verified-state presentation | None |
| `run build` | A production application build | No service credentials needed for public/synthetic build |
| `run check:browser-secrets` | Configured secret values/encoded forms absent from client assets | Populated local secrets and an existing build; does not scan history |
| `run test:db` | Constraints, permissions and concurrency | Dedicated database/Auth credentials; creates fixtures |
| `run test:payments`, `run test:payment-options`, `run test:admin-db` | Payment contracts, snapshots and assigned-role behavior | Dedicated target; inspect each script's controlled/provider scope |
| `run test:browser` | Selected desktop/mobile workflows | Mode-dependent; some create Auth/database/sandbox payment fixtures |

Units use `*.test.ts`; browser files use `*.spec.ts`. Browser configuration can load `.env.local` and defaults to a live mode when Supabase is configured. Select a mode explicitly, inspect its suite and build with matching security settings. Most modes use installed Chrome; mobile is Chromium emulation. Install Chrome separately if absent.

`PALMSTEEZE_BROWSER_MODE=portfolio` selects `portfolio.spec.ts`; it is not a universal offline smoke command. Auth, payments and admin modes need legitimate fixtures and dedicated credentials. Release suites are prepared by `scripts/prepare-release-tests.cjs` and selected through `PALMSTEEZE_RELEASE_SUITES` / `playwright.release.config.ts`. Use fresh ignored output roots. Do not publish session-bearing traces or reports.

Run mutation suites sequentially. Clean only run-owned fixtures, preserving paid/uncertain history. Controlled failures, official test keys, real signed events and physical-device observations establish different things.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Runtime/engine mismatch | Bootstrap and use `scripts/npm.ps1` to pin Node/npm |
| Port 3000 in use | Stop the service you started with Ctrl+C |
| Entrance fails | Matching hostname/widget pair, signing-secret format and explicit local test mode |
| Inventory unavailable | Matching project URL/reference, dedicated-target flags and service health |
| Callback rejected | Exact registered callback, initiating origin and cookies; external destinations are refused |
| Quote changed | Review the new authoritative quote before retrying |
| Checkout/refund uncertain | Reconcile the existing attempt; do not create a replacement to hide uncertainty |
| Database command refused | Inspect target/TLS guards rather than disabling them |
| Applied checksum differs | Restore original migration bytes and add a forward migration |

See [architecture](architecture.md), [deployment](../deployment/README.md) and [contribution guidance](../CONTRIBUTING.md).
