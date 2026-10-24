# Contributing to PalmSteeze

Start with [local setup](README.md#run-locally) and the [development reference](documentation/development.md). Open an issue for a reproducible bug or substantial proposed change before investing in a large implementation.

## Make a change

Work on a dedicated branch from current `main`. Keep changes focused and preserve existing work and published history. Use two-space indentation for new TypeScript, kebab-case filenames, PascalCase components and camelCase functions. Follow surrounding code and prefer `@/` imports in application code. Keep privileged modules server-only.

Direct dependencies are pinned; update `package.json` and `package-lock.json` together when a dependency change is necessary. Do not edit applied SQL migrations. Add a forward migration, retaining LF line endings so recorded checksums remain stable.

## Verify the change

```powershell
./scripts/npm.ps1 run typecheck
./scripts/npm.ps1 run lint
./scripts/npm.ps1 test
./scripts/npm.ps1 run build
```

For interface changes, inspect keyboard navigation, visible focus, readable labels, narrow layouts and reduced motion. Include sanitized desktop/mobile captures when useful. Run relevant browser checks with a fresh output directory.

Database changes need actual anonymous/customer/admin permission checks and independent concurrent connections. Use dedicated targets and isolated fixtures. Mutation tests can affect a configured database or Stripe sandbox: inspect each script and target first, run them sequentially, and remove only run-owned fixtures. Never reset a database for cleanup.

Keep integer kobo, immutable snapshots, original JWT ownership, allocation conflict protection and stable provider idempotency intact. A return parameter is not payment evidence; cancellation approval is not reimbursement. The synthetic administration preview must remain separate from real records and actions.

## Send a pull request

Explain the problem, resulting behavior and relevant validation. State migration impact and checks that could not run. Small documentation fixes need link/command review, not repeated service tests. Use a focused imperative commit subject; no prefix is required.

Keep screenshots, logs and examples free of identities, tokens and customer data. Use reserved example domains and synthetic records. For privacy and demo questions, use the README contact; do not post sensitive reports publicly.

The [license](LICENSE) covers first-party code and developer documentation. Check [asset terms](documentation/assets.md#licensing-boundaries) before copying or replacing visual material.
