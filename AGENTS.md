# site-weight

Node + Playwright CLI that replays a user journey (`journey.js`) and measures its network weight per step, with an estimated EcoIndex. Published on npm as `@rezo-zero/site-weight`; open source on GitHub.

`src/cli.js` is the only entry point (`bin`); the package has no programmatic API, hence no `main`. Flow: `src/flow/load-config.js` → `run-journey.js` (browser + step loop) → `collect-metrics.js` → `write-report.js`.

## Commands

```bash
pnpm install
pnpm smoke                           # local smoke run, see below
pnpm journey                         # runs journey.sample.js against a real site
node src/cli.js <journey.js|folder>  # a folder must contain journey.js; --help lists the options
```

Reports land next to the journey file (or in `--out`) in `reports-<timestamp>/` (git-ignored): `<runId>.csv` (human), `technical_<runId>.csv`, `requests_<runId>.json`.

## Verify your work

Run `pnpm smoke` before calling a change done; GitHub Actions runs it on every pull request (`.github/workflows/ci.yml`). It serves `ci/site/`, runs `ci/journey.*.js` from a temp CommonJS project and checks the three reports. On that static site the sizes are stable from run to run, so a refactor must leave them unchanged. When a change touches a CLI option or a journey key, cover it in `ci/smoke.js`.

There is no linter and no test framework: `ci/smoke.js` is plain Node, and adding a framework needs approval.

## Conventions

- JavaScript ESM only, no TypeScript, no build step. Built-ins imported with the `node:` prefix, before third-party imports.
- Style is not enforced by a tool: `.editorconfig` sets 2-space indentation and LF; write double quotes and semicolons, like the existing code.
- Units are explicit in names and columns (`_kb`, `_ms`).
- The report schema is a public contract (users import the CSVs): add columns at the end, never rename or remove one. The human CSV headers are in French on purpose.
- Journey config keys and behaviour are documented in `README.md`; update it in the same change when you touch `load-config.js` or `run-journey.js`.
- `METHODOLOGY.md` explains the measurement to non-developers and lists the EcoIndex / GreenIT sources: keep it in sync when a metric changes.
- Code, comments, docs and commits are in English.

## Changes that need approval

- Changing the report schema (see above).
- Adding a build system, linter or test framework.
- Adding, removing or upgrading Playwright.

## Git

Git flow: branch from `develop`, pull request to `develop`, squash merge (the PR title becomes the commit). Releases and hotfixes go through `release/*` / `hotfix/*` and a signed tag on `main`. `main` and `develop` are protected: every change, even one line, goes through a branch and a PR.

Commits and PR titles follow Conventional Commits, in English and imperative: `cliff.toml` builds `CHANGELOG.md` from them, and a non-conventional message is dropped from it. One PR = one logical change: keep refactors, reformatting and features in separate PRs.
