export default {
  name: "Smoke urls",
  startUrl: process.env.SITE_WEIGHT_SMOKE_URL,
  settle: {
    extraMs: 100,
  },
  urls: [
    "/",
    "/page-2/",
  ],
};
