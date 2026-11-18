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

- Measurement window per step: from action start to settling + delay + scroll.
- `request_count`: number of requests observed within the window.
- `compressed_kb`: transferred size (compressed bytes).
- `decompressed_kb`: estimated via ResourceTiming when possible, with fallback.
- `dom_nodes`: GreenIT method (excluding `svg` descendants).
- EcoIndex: computed from observed values (estimate).

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
