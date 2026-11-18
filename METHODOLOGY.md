# Measurement methodology (simplified)

This document explains, in plain terms, how the tool estimates the weight of a website.

## Big picture

Measuring the "weight" of a website is complex. Modern sites load resources over time, may prefetch pages, and behave differently depending on the user journey. The result produced by this tool is therefore **an estimate**, based on **the pages and actions you chose to test**.

This is especially true for SPA (Single Page Application) sites: internal navigation does not reload everything, so the measured weight strongly depends on the actions performed.

## What the tool measures

For each step in the journey, the tool observes:

- requests triggered by the action (click, navigation, wait),
- the amount of data downloaded,
- the final page URL after the action,
- an EcoIndex score estimated from these elements (not necessarily identical to the official EcoIndex result).

The tool follows a **user journey** defined in a `journey.js` file and measures what happens during each step.

## Technical overview (brief)

- Measurement window per step: from the start of the action to the end of the settling (settle, pause, scroll, settle again). When the action changes the page URL, the window opens 300 ms before the action.
- `request_count`: number of requests started within the window. Inline data (`data:`, `blob:`, `about:` URLs) and WebSocket connections (`ws:`, `wss:`) are not counted.
- `compressed_kb`: transferred size, as received over the network: compressed body plus response headers. On a small file the headers can weigh more than the body.
- Decompressed size: size of the resources once decoded, for the resources that started loading within the step window. It is read from ResourceTiming (`decodedBodySize`) when the browser exposes it for enough resources, otherwise from the response bodies. It includes resources reused from the browser cache, while `compressed_kb` only counts bytes actually transferred: after a full page load, the decompressed size can be much larger than the compressed one.
- In the reports, the decompressed size of a step is `decompressed_kb_delta` (technical CSV) and "taille (decompressé kB)" (summary CSV); `decompressed_kb` and "taille cumulative (decompressé kB)" are the running total since the start of the journey.
- `dom_nodes`: GreenIT method (excluding `svg` descendants).
- EcoIndex: computed from observed values (estimate).
- With `mode: "cumulative"`, `request_count`, `compressed_kb` and the EcoIndex of a step cover the journey from its start (the sum of the step windows so far) instead of the step alone.
- Journey EcoIndex (the "Moyenne" row): EcoIndex computed from the per-page averages of the step values (`compressed_kb`, `request_count`, `dom_nodes` of each step on its own, whatever the mode), over the steps that did not fail.

## Journey score

The last row of the reports, "Moyenne", gives one EcoIndex for the whole journey. It is the score of an average page view of the journey: the downloaded data, the number of requests and the page size (DOM) of each step are averaged over the steps, and EcoIndex is computed from these averages.

On a site that navigates without reloading, the first page carries most of the cost (scripts, styles, fonts); the following pages reuse them and only download their own content. The journey score therefore improves as the journey goes deeper into the site, which is what a real visit costs on average per page.

- The score of a single step after the first one is not comparable with an official EcoIndex result: EcoIndex measures one page loaded from scratch, while the step only counts what it downloaded on top of the previous ones.
- The journey score depends on the length of the journey: compare journeys with the same steps.
- Steps whose action failed are left out of the journey score.

## How to interpret the results

- The output is **not the absolute total weight of the whole site**.
- It represents the **weight of the tested journey**.
- Changing pages or actions will change the measurement.

In other words, the tool provides a **representative snapshot** of a journey, not a single definitive number for the entire site.

## Important limitations

- Untested pages are not included.
- SPAs can hide part of the downloads (prefetch, cache, internal navigation).
- Network conditions, hardware, and site versions can influence the measurement.

## Sources

The tool relies on EcoIndex methodology for the environmental score:

- https://www.ecoindex.fr/comment-ca-marche/
- https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/quantiles.py
- https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/grades.py
- https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/compute/ecoindex.py
- https://github.com/cnumr/GreenIT-Analysis
