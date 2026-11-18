export default {
  name: "Smoke steps",
  startUrl: process.env.SITE_WEIGHT_SMOKE_URL,
  settle: {
    waitUntil: "networkidle",
    extraMs: 100,
  },
  scroll: {
    enabled: true,
    stepPx: 800,
    pauseMs: 50,
    maxMs: 3000,
  },
  steps: [
    {
      name: "Home",
      action: "noop",
    },
    {
      name: "Page 2",
      action: "click",
      selector: "nav a[href='/page-2/']",
    },
    {
      name: "Back home",
      actions: [
        {
          action: "click",
          selector: "nav a[href='/']",
        },
        {
          action: "waitForSelector",
          selector: "main h1",
        },
      ],
    },
  ],
};
