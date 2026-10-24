# Sandbox deployment

PalmSteeze runs on Vercel with Supabase Auth/PostgreSQL, the existing Edge payment worker and Stripe sandbox. The canonical demo is https://palmsteeze.devs.surf. `main` is the maintained source and configured Production branch; the deployed application baseline is [`a11ba0b`](https://github.com/S-Adnan-11/palmsteeze/commit/a11ba0bb46e965802189d0dbf1e81deafa892e21).

## Build environment

Use Node >=24.21.0 <25 and npm 11.19.0. `vercel.json` installs locked build dependencies and runs `scripts/hosted-build.mjs`. The preflight checks canonical HTTPS, genuine Turnstile keys, dedicated Supabase configuration and signing/recovery credentials before building.

[hosted.env.example](hosted.env.example) lists application variables. Keep tooling-only database, Auth Admin, Management API, Stripe and webhook credentials out of Vercel. The worker holds its own provider secrets. Test mode must remain false, and the signing key must match database capability configuration.

Google returns through Supabase; Supabase then uses the exact application `/auth/callback`. Keep valid callbacks and persisted payment return origins. Application deployment does not migrate the database or deploy the Edge worker.

## Package a release

Automatic Git deployments are disabled by `git.deploymentEnabled: false`. Validation does not deploy. Releases use a checked `main` commit and the existing project through a manual Production deployment. Automatic custom-domain assignment is enabled, so a successful Production deployment can update the canonical site.

From a clean checkout of the intended commit:

```powershell
./scripts/package-release.ps1
```

The script identifies the committed SHA, checks deployment inputs and creates a Git archive under `.tools/releases/<sha>/`. It refuses an existing destination. Review archive members and deploy only that directory with the existing project link. `.vercelignore` and Git tracking are independent upload boundaries. Do not upload a development working tree or test-key build.

The pinned `scripts/vercel.ps1` wrapper runs the CLI without a global installation. Inspect project/environment and SHA before publishing. Packaging or pushing source does not deploy.

## Verify and recover

Inspect the completed deployment's source SHA, build status, domain and HTTPS. `hosting:inspect` and `hosting:smoke` take an explicit `--origin`; PowerShell npm invocations use the quoted `'--'` separator. Review smoke tests before use; they include controlled negative requests and preference cookies.

Check public introduction/legal routes, entrance enforcement, callback cancellation, notices and video range delivery. These do not prove a completed Google grant or authenticated payment journey.

For rollback, inspect deployment order and choose a compatible verified artifact. Do not assume an old ID is still the previous Production deployment. Recheck schema/worker compatibility. Never reset the database, rewrite snapshots or remove origins with unresolved payments.

Database recovery needs separately protected service backups and an isolated restore procedure. Git archives and frontend rollback do not contain database/Auth records or provider configuration. Use free/nontrial capacity and sandbox payments for this demonstration.
