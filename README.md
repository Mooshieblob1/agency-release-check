# Agency release-check — local prototype

A$0 independent prototype. TypeScript capture CLI, Playwright Test acceptance suite, one Vue/Vite operator review interface, versioned JSON manifests/review revisions and an offline HTML handover. No AI runtime/API, database or hosted service.

**Works locally against the synthetic fixture. Real-site capture is disabled.** No client or prospect site was tested. This repository contains synthetic evidence only. No outreach, purchases or commercial commitments were made. The sample decisions are explicitly illustrative agent decisions, not a human review.

## Run

Tested on Ubuntu 24.04.3 LTS, Linux 6.18.44, x86_64; Node v24.19.0, npm 11.9.0. Playwright Test 1.62.1; packaged Chromium 153.0.8010.0 from pinned `@sparticuz/chromium` 153.0.0; Vue 3.5.43, Vite 8.3.2, TypeScript 6.0.3. Exact dependency versions/integrity are in package-lock.json. NixOS, Windows and macOS environments have not been tested. No cross-OS pixel parity claim.

From this directory:

```bash
npm ci
npm run check
npm run build
npm test
npm run demo
```

The demo starts/stops its own fixture on exact `http://127.0.0.1:4317`. It prints new baseline/candidate IDs. Each invocation uses a timestamp so evidence is never overwritten. `npm run demo -- YOUR_UNIQUE_LABEL` uses explicit IDs; reuse is refused. The source bundle includes `demo-release-baseline`, `demo-release-candidate` and their audit records.

Review the included candidate:

```bash
npm run review -- artifacts demo-release-candidate
```

Open `http://127.0.0.1:4321`. It binds loopback with strict Host/Origin and token-protected mutations. Stop with Ctrl+C. Use Tab/Shift+Tab and Enter; the skip link moves to evidence. Visual and browser reviews are separate. Promotion is an explicit local attestation and preserves historical evidence.

For a newly printed run ID, substitute it in the commands. Export uses exclusive creation; choose a new filename for each reviewed report:

```bash
npm run cli -- export demo-release-candidate my-reviewed-report.html
```

### Capture manually

Keep the owned fixture running in another terminal:

```bash
node --import tsx src/fixture.ts
npm run cli -- capture configs/example.json baseline
npm run cli -- promote BASELINE_ID "REVIEWER NAME" "I reviewed this synthetic baseline"
npm run cli -- capture configs/example.json candidate BASELINE_ID
```

Do not enter a reviewer name until that person has actually reviewed evidence. The demo uses `Synthetic demo agent` instead. Missing/unapproved/incompatible baselines never produce an unchanged result.

A CLI review JSON must include `item`, `aspect` (`visual` or `browser`), `decision`, `reviewer`, `rationale`, `severity`, `comment` and `expectedRevision`. See `src/store.ts` for validated values. UI writes this schema automatically. Revisions are append-only, hash-linked, and reject conflicting writes.

### Browser distribution

The normal `npx playwright install chromium` attempt returned invalid ZIP archives in this workspace. The verified demo uses a pinned npm-distributed Chromium binary instead; the program extracts it into `.browser` with no system configuration changes. Standard Playwright launch arguments are used, without the package's permissive web-security flags. This combination is tested here, not promised as the vendor's officially matched binary.

To explicitly test a standard Playwright browser in a supported environment:

```bash
npx playwright install chromium
RELEASE_BROWSER=playwright npm test
RELEASE_BROWSER=playwright npm run demo
```

These alternate commands were not successfully exercised here. Regenerate/reapprove baselines when the fingerprint changes. Do not bypass certificates or denied downloads. The packaged fallback intentionally refuses non-Linux-x64 platforms. `node --import tsx` avoids the tsx CLI's unnecessary local IPC server.

## Delivered evidence

- `deliverables/sample-report-release.html`: standalone, offline report with 36 intact inline evidence images; final QA observed zero outbound requests.
- `artifacts/runs/demo-release-*`: baseline/candidate manifests and hashed before/after/diff/first-frame PNGs.
- `artifacts/reviews/demo-release-*`: illustrative promotion/review revisions, kept separately from runs.
- `docs/ACCEPTANCE.md` and `test-results/acceptance.json`: actual acceptance mapping/results.
- `playwright-report/`: Playwright's generated test report.
- `configs/example.json`, `src/fixture.ts`: synthetic configuration and dependency-free fixture.
- `docs/PILOT.md`, `docs/VALIDATION.md`, `docs/prospects.json`: draft offer, five researched fit records and two unsent personalized inquiries.
- `deliverables/pilot-validation.html`: readable combined offer and validation pack.

Sample scope: six pages × two profiles = 12 inspections per run; 24 primary page-view captures across baseline/candidate, 48 stability frames and 12 diff images. Redirect transitions add disclosed navigation attempts. Candidate result: eight unchanged, four visually changed; two unresolved visual items and four unresolved browser items. Browser observations survive visual acceptance. Complete means planned inspections executed, not defect-free or release-approved.

## Limits and next approval

Real-mode execution fails closed pending tested connection-time destination enforcement/network isolation. Host allowlisting and initial DNS checks are not enough. Subresource/iframe redirects, query URLs, authenticated work, forms, writes, security/load testing, certification, fixes and deployment are excluded. Inspections are sequential, bounded and operate on only approved documents. Out-of-scope links are listed without requests. No scrolling or lazy-load sweep. Oversized screenshots/anchor or observation truncation, blocked resources, failures and missing rows are disclosed.

Two identical frames prove only bounded stability. Masks hide declared content. Pixel differences require interpretation. Redaction is best effort; screenshots can still contain private data. Errors have ANSI/Playwright diagnostic call logs removed to avoid exporting request headers. PNG budgets exclude JSON and exported HTML. No network-byte budget or encryption service is implemented. SIGINT/SIGTERM retain incomplete evidence; hard kills can leave partial runs/stale locks. See `docs/PRIVACY-AND-AUTHORIZATION.md`.

Hash chains are local integrity checks, not authenticated signatures. Never publish screenshots, change production or contact anyone without the separately required authorization. Every prospect remains on hold: prior contact/opt-outs unknown and consent not established. The A$350–500 range is an experimental hypothesis, not an approved quote. No buyer interview or paid engagement has occurred. Confirm whether the A$1,000/week goal is gross or take-home before assessing income viability.

## Official references checked 5 October 2026 (Perth)

- https://playwright.dev/docs/intro
- https://playwright.dev/docs/test-snapshots
- https://playwright.dev/docs/api/class-pageassertions
- https://playwright.dev/docs/api/class-page
- https://playwright.dev/docs/api/class-request
- https://playwright.dev/docs/network
- https://vite.dev/guide/
- https://vite.dev/config/server-options
- https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- https://github.com/microsoft/playwright/blob/main/LICENSE
- https://www.acma.gov.au/avoid-sending-spam
- https://diffy.website/free-visual-regression-testing/

Playwright native screenshot assertions/reporters are used for tests; the operator adapter uses its screenshot API and pixelmatch to keep immutable evidence and explicit baseline approval. See `docs/SCHEMA.md` and `docs/PLAN-AND-RISKS.md` for schema and decisions.
