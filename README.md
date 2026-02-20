# Site Weight Journey Runner

This project measures the network weight of a real user journey on modern SPA + SSR websites (like Nuxt). It was built to address a limitation of GreenIT-Analysis: in SPA/SSR setups, forcing full SSR reloads on every page re-downloads JS/CSS and skews results. Instead, this tool captures the true cost of client-side navigation.

Goals:
- Reproduce a realistic user journey with configurable actions (clicks, waits, multi-action steps).
- Measure request count and transfer sizes per step within a controlled time window.
- Provide two CSV outputs: a human-friendly summary and a technical report, plus a JSON + schema for analysis.
- Stay compatible with SPA navigation (URL changes, late async calls, prefetch behavior).

This repo contains a small Playwright-based script that measures network weight for a user journey. It executes a journey described in a `journey.js` file inside a folder you provide.

## Install

```bash
npm install
```

## Usage (folder only)

You must pass a folder name. The script will load `journey.js` from inside that folder.

```bash
node src/index.js theatredurondpoint.fr
```

If the folder does not contain `journey.js`, the script exits with an error.

## Journey Config (journey.js)

Export a default object. Use `steps` for detailed journeys. If `steps` is empty or missing, the script uses `urls` instead.

### Full steps example

```js
export default {
  name: "Theatre des Celestins - parcours type",
  startUrl: "https://www.theatredescelestins.com/",
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
      name: "Accueil SSR",
      action: "noop",
    },
    {
      name: "Aller a la programmation",
      action: "click",
      selector: "a[href*='programmation'], a[href*='spectacles']",
    },
    {
      name: "Ouvrir une fiche spectacle",
      action: "click",
      selector: "main a[href*='spectacle'], main a[href*='spectacles']",
    },
  ],
};
```

### Simple urls example

`urls` can contain absolute or relative URLs. When `urls` is used, the script tries to click a link whose `href` matches the target URL (absolute match first, then relative, with a trailing slash tolerance). If no link is found, it falls back to `window.location.href` and logs a warning. In this mode, `startUrl` is ignored and each URL becomes a step named after the URL. Relative URLs require `startUrl` to be set.

```js
export default {
  name: "Simple journey",
  urls: [
    "https://www.theatredescelestins.com/",
    "https://www.theatredescelestins.com/programmation/",
  ],
};
```

### Multi-actions step example

Use `actions` to run multiple actions in a single step. Actions run in order, with no settle between them; settle happens once at the end of the step. The report `action` field concatenates the action names (e.g. `click>click`) and `page_url` captures the final URL after the step finishes.

```js
export default {
  name: "Theatre des Celestins - parcours type",
  startUrl: "https://www.theatredescelestins.com/",
  steps: [
    {
      name: "Aller a la programmation",
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

Reports are written to a timestamped folder inside the journey directory: `/<folder>/reports-<timestamp>/`. Filenames include a run id derived from the journey name and timestamp. `request_count` is computed within a step window (start to end), and `window_duration_ms` reports that window length. Each row also includes `page_url`, the current page URL after the step finishes. Two CSV files are produced: `<runId>.csv` (human-friendly) and `technical_<runId>.csv` (full technical report).

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
