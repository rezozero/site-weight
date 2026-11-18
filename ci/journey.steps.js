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
    maxMs: 10000,
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
      // Stays on the same URL: part of the "Page 2" page view.
      name: "Read page 2",
      action: "waitForSelector",
      selector: "main p",
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
