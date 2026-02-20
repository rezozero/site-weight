# AGENTS.md
# Guidance for agentic coding in this repo.

## Purpose
- This repo is a small Node + Playwright script that measures network weight for a user journey.
- The primary entry point is `src/index.js` and JS configs like `theatredurondpoint.fr/journey.js`.

## Build / Lint / Test Commands
- No tests are configured in this repository. Do not add test commands unless requested.
- No linting or formatting tools are configured. Follow existing style in the code.

### Install
- `npm install`

### Run (main script)
- `node src/index.js theatredurondpoint.fr`
- Pass a folder name only; `journey.js` must exist inside that folder.

### Output
- Reports are written inside the journey folder under `reports-<timestamp>/` as JSON and CSV.
- Output filenames include a run id derived from the journey name and timestamp.
- Each report folder includes `report-schema.json` describing the CSV columns.
- Two CSV files are produced: `<runId>.csv` (human-friendly) and `technical_<runId>.csv` (full technical report).
- `request_count` is computed within a step window (start to end). `window_duration_ms` reports that window length. Each row includes `page_url` after the step finishes.

## Code Style and Conventions

### Language and Runtime
- JavaScript only. No TypeScript in this repo.
- ESM is used via `.js` files; `package.json` is `type: module`.
- Use Node built-ins with the `node:` prefix (example: `import fs from "node:fs"`).

### Imports
- Group Node built-ins first, then third-party imports.
- Use named imports for external libs when appropriate (example: `{ chromium }` from Playwright).
- Keep import lists sorted by module type (built-ins, then third-party).

### Formatting
- 2-space indentation for JavaScript.
- Double quotes for strings.
- Semicolons at statement ends.
- Prefer trailing commas in multiline objects and arrays when already used nearby.
- Keep lines readable; wrap long expressions over multiple lines with consistent indentation.

### Naming
- `camelCase` for variables and functions (`autoScrollIfEnabled`, `computeStepMetrics`).
- `UPPER_SNAKE_CASE` for constants (`KB`).
- Use descriptive names over abbreviations (`decompressedFallbackByRequestId`).

### Types and Data Shapes
- No explicit type system. Be explicit in runtime checks instead.
- Prefer `Number(...)` or `??` defaults when reading config values.
- Keep config-driven logic centralized; read all config once at startup.

### Error Handling
- Use guard clauses for invalid inputs (`if (!url) return false`).
- Use `try/catch` for best-effort operations (e.g., response body reads).
- Fail fast for unknown actions with clear error messages.
- Top-level errors should log and exit non-zero (`process.exit(1)`).

### Async and Promises
- Use `async/await` consistently.
- Small helper functions for repeated async steps (`settle`, `autoScrollIfEnabled`).
- Avoid unhandled promises; `await` all critical async calls.

### Browser Automation (Playwright)
- Use `chromium.launch({ headless: true })` unless a task requires otherwise.
- Prefer `page.waitForLoadState` for settling network activity.
- Keep timeouts explicit and realistic for UI actions.
- Use CDP (`context.newCDPSession`) only where needed for network metrics.

### Data Collection and Metrics
- Keep units explicit (bytes vs KB). Use helpers like `toKb`.
- Separate data collection from reporting.
- Keep report schema stable; add new fields in a backward-compatible way.

### Journey Config Files
- Use `journey.js` with a default export object.
- Keep config keys consistent (`name`, `startUrl`, `steps`, `settle`, `scroll`, `urls`, `actions`).
- If `steps` is empty or missing, `urls` is used instead.
- `urls` can be absolute or relative; relative entries require `startUrl`.
- When using `urls`, the runner tries a link click on matching `href` (absolute match first, then relative, with trailing slash tolerance). If no link is found, it falls back to `window.location.href` and logs a warning.
- Steps can define `actions` (multi-action sequence). If `actions` is present, `action` is ignored.

### File and Directory Conventions
- Place journey configs under a site-specific directory (example: `theatredurondpoint.fr/`).
- Reports are output to `/<folder>/reports-<timestamp>/`. Do not commit generated reports unless requested.

## Repo-Specific Workflow Notes
- No build step is required.
- No linting tools are set up.
- No tests are configured; avoid adding test instructions.

## Cursor / Copilot Rules
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` files are present.

## Practical Examples

### Measure a journey
```bash
npm install
node src/index.js theatredurondpoint.fr
```

### Add a new journey config
- Create a new folder per domain.
- Copy an existing `journey.js` and update `name`, `startUrl`, and `steps`.
- Keep the same overall shape and keys unless you also update the script.

## Changes to Avoid Without Approval
- Introducing a build system, linting, or test framework.
- Changing the report output schema.
- Adding or removing Playwright dependencies.
