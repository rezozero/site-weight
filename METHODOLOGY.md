# Measurement methodology (simplified)

This document explains, in plain terms, how the tool measures the weight of a website and scores it.

## Big picture

Measuring the "weight" of a website is complex. Modern sites load resources over time, may prefetch pages, and behave differently depending on the user journey. The result produced by this tool is therefore **a measurement of the pages and actions you chose to test**, not of the whole site.

EcoIndex scores one page loaded on its own, as a first visit. This tool scores a journey: several pages visited one after the other in the same browser, the way a visitor goes through a site. The first page of the journey is measured the way EcoIndex measures any page; the following pages are measured as they are actually loaded during the visit.

## What the tool measures

For each step in the journey, the tool observes:

- the requests made during the step (action, page load, scroll),
- the amount of data transferred,
- the size of the page (number of DOM elements) at the end of the step,
- the page URL at the end of the step,
- an EcoIndex score computed from these three values with the EcoIndex formula.

The tool follows a **user journey** defined in a `journey.js` file and measures what happens during each step.

## Measuring like EcoIndex

The reference is [EcoIndex_python](https://github.com/cnumr/EcoIndex_python), the implementation behind [ecoindex.fr](https://www.ecoindex.fr/). With the default settings, the tool measures each page with the same parameters:

| | EcoIndex | This tool |
| --- | --- | --- |
| Browser window | 1920×1080 | 1920×1080 |
| First page | Fresh browser, empty cache | Fresh browser, empty cache |
| Lazy-loaded content | Page scrolled to the bottom before measuring | Page scrolled to the bottom before measuring |
| Transferred size | Bytes received per request, headers included | Bytes received per request, headers included |
| Size unit | kB of 1000 bytes | kB of 1000 bytes |
| Requests | Every request of the page | Every request of the step |
| DOM size | Every element, open shadow roots included, minus the descendants of `<svg>` elements; iframe contents not counted | Same count |
| Score | Quantiles and weights of EcoIndex, rounded to a whole number | Same quantiles, weights and rounding |
| Grade | A to G from the rounded score | Same thresholds |

Differences with an EcoIndex result:

- **Pages after the first one.** They are loaded in the same browser as the previous ones, from a click on a link or a button. The browser reuses the files it already has in its cache, and a site that navigates client-side (Nuxt, Next…) only downloads the content of the new page. This applies the same way to every site, whatever its technology: a site that reloads the whole page on each click gets its scripts, styles and fonts back from the cache as well.
- **Browser engine.** The tool uses Chromium; EcoIndex currently uses Firefox. Image formats, prefetching or third-party scripts can differ from one browser to the other.
- **Timing.** EcoIndex waits a fixed time before and after scrolling. The tool waits for the network to go idle, then pauses, before and after scrolling (see `settle` in the README). A request that starts late can fall on either side of the measurement in both tools.
- **Settings.** A journey can change the window size, turn the scroll off or limit its duration. With other settings than the defaults, the score of the first page is no longer comparable with an EcoIndex result.

## Technical overview (brief)

- Measurement window per step: from the start of the action to the end of the settling (settle, pause, scroll, settle again). A request belongs to the step during which it started; a request that starts between two steps belongs to the next one.
- `request_count`: number of requests of the step. Inline data (`data:`, `blob:`, `about:` URLs) and WebSocket connections (`ws:`, `wss:`) are not counted.
- `compressed_kb`: transferred size, as received over the network: compressed body plus response headers, in kB of 1000 bytes. On a small file the headers can weigh more than the body. A file served from the browser cache transfers nothing.
- Decompressed size: size of the resources once decoded, for the resources that started loading during the step. It is read from ResourceTiming (`decodedBodySize`) when the browser exposes it for enough resources, otherwise from the response bodies. It includes resources reused from the browser cache, while `compressed_kb` only counts bytes actually transferred: after a full page load, the decompressed size can be much larger than the compressed one. It is not used by the score.
- In the reports, the decompressed size of a step is `decompressed_kb_delta` (technical CSV) and "taille (decompressé kB)" (summary CSV); `decompressed_kb` and "taille cumulative (decompressé kB)" are the running total since the start of the journey.
- `dom_nodes`: EcoIndex count, measured at the end of the step, after the scroll.
- With `mode: "cumulative"`, `request_count`, `compressed_kb` and the EcoIndex of a step cover the journey from its start instead of the step alone.

## Journey score

The last row of the reports, "Moyenne", gives one EcoIndex for the whole journey: the score of the journey's average page view.

- A page view starts on the first step and on each step that ends on another URL. A step that stays on the same URL (opening a menu, switching a tab, filtering a list) belongs to the current page view: its requests and transferred data add to it, and the page view keeps the largest DOM it reached.
- The transferred data, the number of requests and the DOM size are averaged over the page views, and EcoIndex is computed from these three averages. The row shows these averages next to the score.
- Like every row, it also gives the greenhouse gas emissions (gCO2e) and the water consumption (cl) of a page view. EcoIndex derives both from the score with fixed formulas; the tool applies the same ones. They are estimates computed from the score, not measurements.
- Steps whose action failed are left out.

What it means:

- The first page view carries the cost of the first visit (scripts, styles, fonts, page content); the following ones carry what the visit then downloads. The journey score reflects the average cost per page of the visit, not the cost of a page opened on its own.
- The score of a single step after the first one is not comparable with an EcoIndex result: EcoIndex measures one page loaded from scratch, while the step only counts what it downloaded on top of the previous ones.
- The journey score depends on the pages the journey goes through: compare journeys made of the same steps, and keep the score of the first step in sight, which is the one comparable with an EcoIndex result.

## How to interpret the results

- The output is **not the absolute total weight of the whole site**.
- It represents the **weight of the tested journey**.
- Changing pages or actions will change the measurement.

In other words, the tool provides a **snapshot** of a journey, not a single definitive number for the entire site.

## Important limitations

- Untested pages are not included.
- Requests that start after the last step, such as a prefetch triggered late, are not counted.
- When the scroll reaches its time limit (`scroll.maxMs`) before the bottom of a page, the content further down is not counted; the CLI warns when it happens.
- Network conditions, hardware, and site versions can influence the measurement.

## Sources

- EcoIndex methodology: https://www.ecoindex.fr/comment-ca-marche/
- EcoIndex quantiles: https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/quantiles.py
- EcoIndex grades: https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/grades.py
- EcoIndex formula and rounding: https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/compute/ecoindex.py
- EcoIndex measurement (window size, scroll, transferred size, DOM count): https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/scraper/scrap.py
- GreenIT-Analysis: https://github.com/cnumr/GreenIT-Analysis
