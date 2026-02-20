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

export function computeEcoindex({ domNodes, sizeKb, requests }) {
  const qDom = getQuantile(QUANTILES_DOM, domNodes);
  const qReq = getQuantile(QUANTILES_REQ, requests);
  const qSize = getQuantile(QUANTILES_SIZE, sizeKb);

  const scoreRaw = 100 - (5 * (3 * qDom + 2 * qReq + qSize)) / 6;
  const score = Math.round(scoreRaw * 10) / 10;

  let grade = "G";
  for (const threshold of GRADE_THRESHOLDS) {
    if (score > threshold.minScore) {
      grade = threshold.grade;
      break;
    }
  }

  return { score, grade };
}
