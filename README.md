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

## Journey Config (journey.js)

Export a default object. Use `steps` for detailed journeys. If `steps` is empty or missing, the script uses `urls` instead.

`journey.js` is always loaded as an ES module, whatever the `type` field of your `package.json` says. A CommonJS `module.exports = { ... }` also works.

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
- `"cumulative"`: every request since the start of the journey, up to the end of the step. The EcoIndex then uses these totals with the DOM of the current page.

Any other value is rejected. The decompressed size is reported both ways in every mode: per step and as a running total.

### Simple urls example

`urls` can contain absolute or relative URLs. When `urls` is used, the script tries to click a link whose `href` matches the target URL (absolute match first, then relative, with a trailing slash tolerance). If no link is found, it falls back to `window.location.href` and logs a warning. In this mode, `startUrl` is ignored and each URL becomes a step named after the URL. Relative URLs require `startUrl` to be set.

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

Reports are written to a timestamped folder inside the `journey.js` directory: `/<journey-folder>/reports-<timestamp>/`. Filenames include a run id derived from the journey name and timestamp. `request_count` is computed within a step window (start to end), and `window_duration_ms` reports that window length. Each row also includes `page_url`, the current page URL after the step finishes. Three files are produced: `<runId>.csv` (human-friendly), `technical_<runId>.csv` (full technical report) and `requests_<runId>.json` (every request observed, per step).

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
- keep one logical change per pull request.

## License

[MIT](LICENSE) © Rezo Zero
