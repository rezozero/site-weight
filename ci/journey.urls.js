export default {
  name: "Smoke urls",
  startUrl: process.env.SITE_WEIGHT_SMOKE_URL,
  viewport: {
    width: 1024,
    height: 768,
  },
  settle: {
    extraMs: 100,
    pauseMs: 0,
  },
  urls: [
    "/",
    "/page-2/",
  ],
};
