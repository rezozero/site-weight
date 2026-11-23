const QUANTILES_DOM = [
  0,
  47,
  75,
  159,
  233,
  298,
  358,
  417,
  476,
  537,
  603,
  674,
  753,
  843,
  949,
  1076,
  1237,
  1459,
  1801,
  2479,
  594601,
];

const QUANTILES_REQ = [
  0,
  2,
  15,
  25,
  34,
  42,
  49,
  56,
  63,
  70,
  78,
  86,
  95,
  105,
  117,
  130,
  147,
  170,
  205,
  281,
  3920,
];

const QUANTILES_SIZE = [
  0,
  1.37,
  144.7,
  319.53,
  479.46,
  631.97,
  783.38,
  937.91,
  1098.62,
  1265.47,
  1448.32,
  1648.27,
  1876.08,
  2142.06,
  2465.37,
  2866.31,
  3401.59,
  4155.73,
  5400.08,
  8037.54,
  223212.26,
];

const GRADE_THRESHOLDS = [
  { grade: "A", minScore: 80 },
  { grade: "B", minScore: 70 },
  { grade: "C", minScore: 55 },
  { grade: "D", minScore: 40 },
  { grade: "E", minScore: 25 },
  { grade: "F", minScore: 10 },
];

function getQuantile(quantiles, value) {
  for (let i = 1; i < quantiles.length; i += 1) {
    if (value < quantiles[i]) {
      return i - 1 + (value - quantiles[i - 1]) / (quantiles[i] - quantiles[i - 1]);
    }
  }

  return quantiles.length - 1;
}

// Python's round(): a half goes to the even integer. EcoIndex_python rounds
// the score with it, then grades the rounded score.
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Same quantiles, weights, rounding and grade thresholds as EcoIndex_python
// (components/ecoindex/compute/ecoindex.py). `sizeKb` is in kB of 1000 bytes.
export function computeEcoindex({ domNodes, sizeKb, requests }) {
  const qDom = getQuantile(QUANTILES_DOM, domNodes);
  const qReq = getQuantile(QUANTILES_REQ, requests);
  const qSize = getQuantile(QUANTILES_SIZE, sizeKb);

  const score = roundHalfEven(100 - (5 * (3 * qDom + 2 * qReq + qSize)) / 6);

  let grade = "G";
  for (const threshold of GRADE_THRESHOLDS) {
    if (score > threshold.minScore) {
      grade = threshold.grade;
      break;
    }
  }

  return { score, grade, ...computeFootprint(score) };
}

// Greenhouse gas emissions (gCO2e) and water consumption (cl) of a page view,
// derived from its score with the formulas and rounding of EcoIndex_python
// (components/ecoindex/compute/ecoindex.py). They are not measured.
export function computeFootprint(score) {
  return {
    ges: roundHalfEven(100 * (2 + (2 * (50 - score)) / 100)) / 100,
    water: roundHalfEven(100 * (3 + (3 * (50 - score)) / 100)) / 100,
  };
}

function withoutHash(url) {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

// Groups the measured steps into page views. A page view starts on the first
// step and on every step that ends on another URL (hash aside). A step that
// stays on the same URL (menu, tab, in-page filter) adds its requests and its
// transferred size to the current page view, which keeps the largest DOM it
// reached. Uses the values of each step on its own, whatever the mode.
// A failed step (or one that timed out) is left out.
export function groupPageViews(results) {
  const pageViews = [];
  for (const r of results) {
    if (r.timedOut || r.error) continue;
    const url = withoutHash(r.page_url || "");
    const current = pageViews.at(-1);
    if (current && current.url === url) {
      current.compressedKb += r.step_compressed_kb;
      current.requests += r.step_request_count;
      current.domNodes = Math.max(current.domNodes, r.dom_nodes);
    } else {
      pageViews.push({
        url,
        compressedKb: r.step_compressed_kb,
        requests: r.step_request_count,
        domNodes: r.dom_nodes,
      });
    }
  }
  return pageViews;
}

// EcoIndex of the journey's average page view: the transferred size, request
// count and DOM size of each page view, averaged over the page views. The
// first page view is a first visit, from an empty cache; the following ones
// reuse what the browser already has, as in a real visit.
export function computeJourneyEcoindex(results) {
  const pageViews = groupPageViews(results);
  if (pageViews.length === 0) {
    return null;
  }

  const mean = (key) => pageViews.reduce((sum, view) => sum + view[key], 0) / pageViews.length;
  const averages = {
    pageCount: pageViews.length,
    leftOutCount: results.filter((r) => r.timedOut || r.error).length,
    compressedKb: mean("compressedKb"),
    requests: mean("requests"),
    domNodes: mean("domNodes"),
  };
  return {
    ...averages,
    ...computeEcoindex({ domNodes: averages.domNodes, sizeKb: averages.compressedKb, requests: averages.requests }),
  };
}
