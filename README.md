# Site Weight Journey Runner

This project measures the network weight of a real user journey on modern SPA + SSR websites (like Nuxt). It was built to address a limitation of GreenIT-Analysis: in SPA/SSR setups, forcing full SSR reloads on every page re-downloads JS/CSS and skews results. Instead, this tool captures the true cost of client-side navigation.

Goals:
- Reproduce a realistic user journey with configurable actions (clicks, waits, multi-action steps).
- Measure request count and transfer sizes per step within a controlled time window.
- Provide two CSV outputs, a human-friendly summary and a technical report, plus a JSON file with per-request details.
- Stay compatible with SPA navigation (URL changes, late async calls, prefetch behavior).

This repo contains a small Playwright-based CLI that measures network weight for a user journey. It executes a journey described in a `journey.js` file you provide.

## Install

Node 22 or later (any maintained LTS). Run it without installing:

```bash
npx @rezo-zero/site-weight ./journey.js
```

Or add it to a project, which also exposes the shorter `site-weight` command:

```bash
npm install --save-dev @rezo-zero/site-weight
npx site-weight ./journey.js
```

Always use the scoped name `@rezo-zero/site-weight` when the package is not installed: `npx site-weight` alone would look for an unrelated, unscoped `site-weight` package on npm.

Playwright needs a Chromium build the first time: `npx playwright install chromium`.

To work on this repository, use pnpm:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm journey   # runs journey.sample.js
```

## Usage

Pass either a folder (the CLI will look for `journey.js` inside it) or a direct path to a `journey.js` file.

```bash
npx @rezo-zero/site-weight ./journey.js
```

```bash
npx @rezo-zero/site-weight ./example.com/
```

| Option | Effect |
| --- | --- |
| `--out <dir>` | Writes the run folders into `<dir>` instead of `<journey-folder>/reports/`. |
| `--viewport <WxH>` | Browser viewport, e.g. `1920x1080`. Overrides the journey's `viewport`. |
| `--headed` | Shows the browser window, to watch or debug a journey. |
| `-h`, `--help` | Prints the usage. |

The default viewport is 1366×768. EcoIndex measures its own scores at 1920×1080: pass `--viewport 1920x1080` to compare with them.

## Journey Config (journey.js)

Export a default object. Use `steps` for detailed journeys. If `steps` is empty or missing, the script uses `urls` instead.

With `steps`, `startUrl` is required and must be an absolute `http(s)` URL. The first step measures the landing on `startUrl`: its `action` or `actions` are not run (a warning says so), so keep it as `noop`.

`journey.js` is always loaded as an ES module, whatever the `type` field of your `package.json` says. A CommonJS `module.exports = { ... }` also works. The local `.js` files it imports follow the same rule: ES module syntax loads as an ES module, anything else as CommonJS.

Each step runs its action(s), then settles: a first settle pass, a pause, the scroll (when enabled), and a second settle pass. These keys tune it:

| Key | Default | Effect |
| --- | --- | --- |
| `settle.waitUntil` | `"networkidle"` | Load state awaited by each settle pass; `"networkidle"` gives up after 5 s. |
| `settle.extraMs` | `1000` | Fixed wait at the end of each settle pass. |
| `settle.pauseMs` | `1000` | Pause between the two passes, for requests that start once the network is idle (hydration, lazy widgets). `0` skips it. |
| `scroll.enabled` | `false` | Scrolls down after the pause, to load lazy content. |
| `scroll.mode` | `"page"` | `"page"` scrolls the window; `"selector"` scrolls the element matched by `scroll.selector`, for sites that scroll inside a container. |
| `scroll.selector` | none | Scrollable element used by `mode: "selector"`. When no element matches, nothing scrolls. |
| `scroll.stepPx` | `800` | Distance of each scroll step, in pixels. |
| `scroll.pauseMs` | `250` | Wait after each scroll step, before waiting for the network to go idle. |
| `scroll.maxMs` | `12000` | Maximum scroll time. Scrolling also stops at the bottom of the page or element. |
| `scroll.backToTop` | `false` | Scrolls back to the top once done. |
| `viewport` | `{ width: 1366, height: 768 }` | Browser viewport. `--viewport` overrides it. |

### Actions

A step runs its `action` (or each entry of `actions`), with these keys:

| `action` | Keys | Effect |
| --- | --- | --- |
| `noop` | none | Does nothing: the step only settles and measures. |
| `click` | `selector` | Waits up to 15 s for the element to be visible, then clicks it. |
| `waitForSelector` | `selector`, `state` (default `"visible"`) | Waits up to 15 s for the element to reach `state`: `"attached"`, `"detached"`, `"visible"` or `"hidden"`. |
| `goto` | `url` | Loads `url`, an absolute URL, as a full page load (waits for `domcontentloaded`). |

An unknown `action` is reported as a failed action (see [Failed steps and timeout](#failed-steps-and-timeout)).

### Full steps example

```js
export default {
  name: "Example journey",
  startUrl: "https://www.example.com/",
  mode: "per_step",
  settle: {
    waitUntil: "networkidle",
    extraMs: 1200,
  },
  scroll: {
    enabled: true,
    mode: "page",
    stepPx: 800,
    pauseMs: 250,
    maxMs: 12000,
    backToTop: false,
  },
  steps: [
    {
      name: "Home (SSR)",
      action: "noop",
    },
    {
      name: "Go to the programme",
      action: "click",
      selector: "a[href*='programmation'], a[href*='spectacles']",
    },
    {
      name: "Open a show page",
      action: "click",
      selector: "main a[href*='spectacle'], main a[href*='spectacles']",
    },
  ],
};
```

### Measurement mode

`mode` sets what the transferred size, the request count and the EcoIndex of a step cover:

- `"per_step"` (default): only the requests started during the step.
- `"cumulative"`: the requests of every step since the start of the journey, up to this one (the sum of the step windows). The EcoIndex then uses these totals with the DOM of the current page.

Any other value is rejected. The decompressed size is reported both ways in every mode: per step and as a running total.

### Failed steps and timeout

When an action fails (selector not found, click refused…), the journey goes on and the step reports the failure in the last column of both CSV files (`error`, `erreur`) and in `requests_<runId>.json`.

`stepTimeoutMs` (default `120000`, in milliseconds) bounds each step, from its first action to the end of its measurement. When a step goes over it, the journey stops: the reports contain the steps measured so far plus the timed-out step (name, URL and error only), and the CLI exits with code 1.

The first step is the exception. There, `stepTimeoutMs` bounds the landing on `startUrl` and its settling, not the measurement that follows. When the landing goes over it, the run fails with an error, writes no report and exits with code 1.

```js
export default {
  startUrl: "https://www.example.com/",
  stepTimeoutMs: 60000,
  steps: [/* ... */],
};
```

### Simple urls example

`urls` can contain absolute or relative URLs, and each URL becomes a step named after the URL. The first URL is the landing page: it is loaded directly and measured as the first step. For each following URL, the script tries to click a link whose `href` matches the target URL (absolute match first, then relative, with a trailing slash tolerance). If no link is found, or the click fails, it falls back to `window.location.href` and logs a warning. In this mode, the journey starts on the first URL: `startUrl` only serves as the base of relative URLs, and is required when there are any.

```js
export default {
  name: "Simple journey",
  urls: [
    "https://www.example.com/",
    "https://www.example.com/programme/",
  ],
};
```

### Multi-actions step example

Use `actions` to run multiple actions in a single step. Actions run in order, with no settle between them; settle happens once at the end of the step. The report `action` field concatenates the action names (e.g. `click>click`) and `page_url` captures the final URL after the step finishes.

```js
export default {
  name: "Example journey",
  startUrl: "https://www.example.com/",
  steps: [
    {
      name: "Go to the programme",
      actions: [
        {
          action: "click",
          selector: "button[aria-controls='menu-id-api-menus-25']",
        },
        {
          action: "click",
          selector: "a[href='/programme/saison-25-26']",
        },
      ],
    },
  ],
};
```

## Output

Each run writes its reports to its own folder, `<journey-folder>/reports/<runId>/`, or `<dir>/<runId>/` with `--out <dir>`. The run id is the local date and time of the run followed by the journey `name` as a slug, e.g. `2026-11-18_15-17-32_example-journey`: run folders sort chronologically. Two runs started in the same second get a `-2`, `-3`… suffix. Add `reports/` to your `.gitignore`. `request_count` counts the requests started within a step window (start to end), except `data:`, `blob:`, `about:` and WebSocket (`ws:`, `wss:`) URLs, and `window_duration_ms` reports that window length. Each row also includes `page_url`, the current page URL after the step finishes. Three files are produced: `<runId>.csv` (human-friendly), `technical_<runId>.csv` (full technical report) and `requests_<runId>.json` (every request observed, per step).

[METHODOLOGY.md](METHODOLOGY.md) explains, for non-developers, what the numbers mean and their limits.

## EcoIndex sources

We compute EcoIndex using the official quantiles and formula from the EcoIndex Python project, and the public methodology description:

- Quantiles: https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/quantiles.py
- Grades: https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/grades.py
- Formula: https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/compute/ecoindex.py
- Methodology: https://www.ecoindex.fr/comment-ca-marche/

Official references:

- EcoIndex: https://www.ecoindex.fr/
- GreenIT-Analysis: https://github.com/cnumr/GreenIT-Analysis
- GreenIT DOM count method: https://raw.githubusercontent.com/cnumr/GreenIT-Analysis/master/script/analyseFrame.js

## Contributing

Pull requests are welcome. The repository follows [git flow](https://danielkummer.github.io/git-flow-cheatsheet/):

- branch from `develop` and open the pull request against `develop`;
- write commit messages and the PR title as [Conventional Commits](https://www.conventionalcommits.org/), in English: PRs are squash-merged, and [git-cliff](https://git-cliff.org/) builds `CHANGELOG.md` from those titles;
- keep one logical change per pull request;
- run `pnpm smoke` first: it serves a small local site from `ci/site/` and checks the reports of two journeys. CI runs it on Node 22, 24 and 26.

## License

[MIT](LICENSE) © Rezo Zero
