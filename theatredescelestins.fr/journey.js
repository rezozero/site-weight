export default {
  name: "Theatre des Celestins - parcours type",
  startUrl: "https://www.theatredescelestins.com",
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
      name: "Aller a la programmation",
      actions: [
        {
          action: "click",
          selector: "button[aria-controls='menu-id-api-menus-25']",
        },
        {
          action: "click",
          selector: "a[href='/programme/saison-25-26']",
        }
      ]
    },
    {
      name: "Appliquer le filtre 'Spectacles'",
      action: "click",
      selector: "a[href='/programme/saison-25-26?type=live_performance']",
    },
    {
      name: "Aller à 'neandertal'",
      action: "click",
      selector: "a[href='/fr/programmation/2025-2026/grande-salle/neandertal']",
    },
    {
      name: "Aller à 'toutes les petites choses'",
      action: "click",
      selector: "a[href='/fr/programmation/2025-2026/celestine/toutes-les-petites-choses-que-jai-pu-voir']",
    },
    {
      name: "Aller à la page d'info pratique",
      actions: [
        {
          action: "click",
          selector: "button[aria-controls='menu-id-api-menus-6']",
        },
        {
          action: "click",
          selector: "a[href='/infos-pratiques/venir-aux-celestins']",
        }
      ],
    },
    {
      name: "Aller à la page de visite",
      actions: [
        {
          action: "click",
          selector: "button[aria-controls='menu-id-api-menus-14']",
        },
        {
          action: "click",
          selector: "a[href='/les-celestins/les-visites']",
        }
      ]
    },
    {
      name: "Aller à la visite guidée du 29/09/2025",
      action: "click",
      selector: "a[href='/fr/programmation/2025-2026/visite/visite-guidee-29']",
    },
    {
      name: "Aller à la page de spectacles passés",
      actions: [
        {
          action: "click",
          selector: "button[aria-controls='menu-id-api-menus-25']",
        },
        {
          action: "click",
          selector: "a[href='/programme/les-spectacles-et-saisons-passees']",
        }
      ]
    }
  ],
  // urls: [
  //   '/',
  //   '/programme/saison-25-26',
  //   '/programme/saison-25-26?type=live_performance',
  //   '/fr/programmation/2025-2026/grande-salle/neandertal',
  //   '/fr/programmation/2025-2026/celestine/toutes-les-petites-choses-que-jai-pu-voir',
  //   '/infos-pratiques/venir-aux-celestins',
  //   '/les-celestins/les-visites',
  //   '/fr/programmation/2025-2026/visite/visite-guidee-29',
  //   '/programme/les-spectacles-et-saisons-passees'
  // ],
};
