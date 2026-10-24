# Repository guidelines

## Layout and toolchain

PalmSteeze uses Next.js App Router, strict TypeScript, CSS/Tailwind, Supabase PostgreSQL/Auth and Stripe sandbox. Routes/APIs are in `src/app/`, shared UI in `src/components/`, and domain/server helpers in `src/lib/`. Ordered SQL is in `supabase/migrations/`; Edge workers are in `supabase/functions/`.

Use the isolated Node 24.21.0/npm 11.19.0 runtime through PowerShell:

- `./scripts/bootstrap-runtime.ps1`
- `./scripts/npm.ps1 ci`
- `./scripts/npm.ps1 run dev`
- `./scripts/npm.ps1 run typecheck`
- `./scripts/npm.ps1 run lint`
- `./scripts/npm.ps1 test`
- `./scripts/npm.ps1 run build`, then `run start`

Read `documentation/development.md` before service tests. Browser modes can create database/Auth/payment fixtures; choose them explicitly and use a fresh output root. Database changes need independent concurrent connections and actual anonymous/customer/admin permission tests. Never reset the shared target or remove records not created by the proof.

## Editing and invariants

Use two-space indentation, kebab-case filenames, PascalCase components, camelCase functions and snake_case SQL identifiers. Prefer `@/` imports. Keep privileged modules server-only. Pin direct dependencies and update the lockfile with manifest changes. Preserve LF migration bytes and add forward migrations instead of editing applied SQL.

Store/calculate integer kobo and display naira. Keep immutable price/policy/identity snapshots, original JWT ownership, atomic single-use reservation authorization and idempotent requests. Entrance and reservation checks are independent. Return flags never prove payment; cancellation approval never proves reimbursement. Permanent refund rejection must preserve failed history, stop automatic retries and leave outstanding reimbursement visible. Use sandbox payments and synthetic preview identities only.

Retain the forest/ivory identity, curved primary wordmark, stacked secondary and small mark. Use Manrope/DM Serif Display with the naira fallback; Google Sans is scoped to the official Google action. Preserve the workspace scene, copy, CTA, responsive videos and posters. Normal motion autoplays only while visible; hidden tabs/offscreen suspend, return resumes. Reduced motion uses the matching poster without a Play override. Autoplay denial is quiet and latched for the mount. Do not add playback controls or manual-pause state. The absence of a pause mechanism is a WCAG 2.2 SC 2.2.2 tradeoff, not full accessibility conformance.

## Source and delivery

Preserve dirty work, branches and published history. `main` is the maintained source; use a dedicated branch for changes unless the task establishes the current branch as its target. Use focused imperative commit subjects and relevant validation in pull requests.

Keep secrets in ignored local configuration and never log values. Inspect dedicated target identity and certificate-verified TLS before database mutation. Preserve `git.deploymentEnabled: false`, the current deployment process and account settings. Publishing requires authorization for the action; packaging source alone does not deploy. Do not enable paid services or live payments.

## Framework documentation

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
