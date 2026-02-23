export default {
  name: "GreenIT report",
  startUrl: "https://greenit.eco/",
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
      name: "Go to contact page",
      actions: [
        {
          action: "click",
          selector: "a[href*='/contact/']",
        }
      ]
    },
	{
      name: "Go to actuality",
      action: "click",
	  selector: "a[href*='/actualites/']",
    },
  ],
};
