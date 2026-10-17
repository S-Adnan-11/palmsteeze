# PalmSteeze sandbox hosting

Target: **https://palmsteeze.devs.surf**, personal/noncommercial Vercel Hobby demo. Reuse the existing Supabase project and Stripe sandbox. Localhost and the exact development tunnel remain independent application origins sharing the same database. Changes to that database affect the hosted demo.

Use [hosted.env.example](hosted.env.example) as an allowlist, not `.env.local`. No database password, Supabase service/Management key, Google secret, Stripe key or webhook secret belongs in Vercel. Hosted Turnstile must use genuine matching keys, exact hostname and disabled test mode. The server signing key must match the private capability configuration. Provider/API secrets remain server-only.

The release uses Node 24.x (preflight >=24.21.0 <25), npm 11.19.0, locked dependencies and `scripts/hosted-build.mjs`. Automatic Git deployments are disabled. Use `delivery/m5-final-personalization`; never deploy an older main checkpoint accidentally. The CLI wrapper pins Vercel 62.2.0 locally.

## Configuration

1. Confirm active Hobby/no trial and remaining free account usage. No paid capacity or live payments.
2. Set the exact hosted Supabase Site URL and `/auth/callback`, preserving localhost/tunnel and existing callbacks. Google's provider return stays on Supabase.
3. Provision only the reviewed exact shared capability origins. Hosted HTTP requests accept only their canonical origin; backend return validation supports the explicit localhost/tunnel/hosted destinations.
4. Keep the existing payment worker, signed webhook, secrets, Vault token and one minute recovery schedule. Historical null-origin attempts retain their existing fallback; persisted initiating origins and Stripe sessions are immutable. Do not add competing workers or replace sessions to change URLs.
5. Add the custom domain to the same project. Obtain its current exact DNS/verification records from Vercel; do not guess generic values or change unrelated DNS.

## Package and publish

Run the required release checks and populated-secret scans. Commit only explicitly reviewed application, migration, test, asset and operational files; do not force-add ignored files. Keep private guides/evidence in `docs/`, reviews in `reviews/` and secrets/tool state excluded.

```powershell
./scripts/package-release.ps1
```

This creates an archive-only directory for the exact committed SHA under ignored `.tools/releases/`. Review its members and deploy **that directory**, linked privately to the existing project, with the pinned CLI. Do not deploy the original working tree: `.vercelignore` is independent of Git exclusions. Do not deploy official loopback test-key build artifacts.

After deployment, inspect cloud build/runtime/revision and canonical HTTPS. Run `hosting:smoke` and `hosting:inspect` with the exact `--origin` (quote npm's `'--'` separator in PowerShell). The smoke test verifies the actual entrance gate, ungated policies/settings, secure preferences, invalid-token rejection, callback cancellation and asset/video delivery. It does not establish successful genuine verification, Google completion, authenticated customer/admin screens, signed payment delivery or phone acceptance; record those journeys separately.

## Rollback and maintenance

Use a previously verified hosted-compatible deployment at the same canonical origin. First publication has no previous hosted rollback artifact: retain its archive/deployment ID and use a bounded forward fix or disable traffic if necessary. Old source checkpoints are preserved history, not automatically safe hosted rollback targets.

Never reset/roll back the shared database, rewrite booking snapshots, remove an origin with unresolved payment attempts or downgrade the worker below the persisted-origin contract. Preserve old 30% snapshots, current 40% minimum, collected-minus-prior-refunds calculations and permanent-refusal history. Use fixture-scoped tests and cleanup only; retain paid/uncertain evidence.

Monitor free usage and the actual worker/pg_net outcome, not cron dispatch alone. Quota exhaustion can interrupt the demo; do not upgrade automatically. Privacy/demo contact: s.adnan.werk@gmail.com. There is no guaranteed availability, timed purge or alternative reimbursement service.
