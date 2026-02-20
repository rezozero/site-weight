# Méthodologie de mesure

Ce document décrit le fonctionnement du script de mesure, les données collectées, les calculs appliqués et les sources officielles utilisées.

## 1) Objectif

Mesurer le poids réseau d’un **parcours utilisateur réel** sur un site SPA + SSR, sans recharger artificiellement toutes les ressources JS/CSS à chaque étape. Le script reproduit des actions réelles (clics, navigation) et mesure l’impact réseau **par étape**.

## 2) Scénario exécuté

Le parcours est défini dans `journey.js` et peut contenir :

- `steps` : étapes détaillées (actions simples ou séquences `actions`).
- `urls` : navigation par liens (clic si `href` match, sinon fallback `window.location.href`).

Pour chaque étape, le script :

1) exécute l’action (ou la séquence d’actions),
2) attend un changement d’URL si applicable (`waitForURL`, 5s),
3) attend la stabilisation réseau (`networkidle` avec timeout 5s),
4) ajoute un délai pour capter les requêtes tardives (1000 ms),
5) scrolle en bas de page si activé, puis stabilise à nouveau.

## 3) Fenêtre de mesure par étape

Les requêtes sont comptées dans une fenêtre bornée :

- **début** : moment de la première action,
- **pré-fenêtre** de 300 ms **uniquement si l’URL change**,
- **fin** : après `settle` + délai + scroll.

Cette fenêtre capte les requêtes liées à l’action (y compris les préfetch immédiats) tout en évitant de mélanger les requêtes de la page précédente.

## 4) Données collectées

À la fin de chaque étape, le script collecte :

- **URL finale** (`page_url`) : `page.url()` après la fin de l’étape.
- **Requêtes** (`request_count`) : nombre de requêtes CDP dans la fenêtre.
- **Poids** :
  - `compressed_kb` (CDP `encodedDataLength`),
  - `decompressed_kb` (ResourceTiming si possible, sinon fallback Playwright).
- **DOM nodes** (`dom_nodes`) : `document.getElementsByTagName("*").length` moins les descendants `svg`.
- **Durée de fenêtre** (`window_duration_ms`).

## 5) Calculs

### 5.1 Poids et requêtes

- `request_count` : nombre de requêtes CDP entre `window_start` et `window_end`.
- `compressed_kb` : somme des `encodedDataLength` (CDP), convertie en kB.
- `decompressed_kb` : estimation via ResourceTiming (`decodedBodySize`) si la couverture est suffisante, sinon fallback Playwright.

### 5.2 DOM nodes

Le nombre de noeuds DOM est calculé selon la méthode GreenIT‑Analysis :

- https://raw.githubusercontent.com/cnumr/GreenIT-Analysis/master/script/analyseFrame.js

Cette méthode compte tous les noeuds HTML puis soustrait les descendants des `svg`, en gérant les cas de `svg` imbriqués.

### 5.3 EcoIndex

Le score EcoIndex est calculé **avec les quantiles et la formule officielles** :

- quantiles DOM / requêtes / taille,
- pondération 3/2/1,
- score 0–100,
- note A–G.

Le score est calculé **par étape** avec :

- `dom_nodes`
- `request_count`
- `compressed_kb`

## 6) Sorties

Le script génère :

- Un **JSON** (`<runId>.json`) avec les métriques détaillées.
- Un **CSV humain** (`<runId>.csv`).
- Un **CSV technique** (`technical_<runId>.csv`).
- Un **schema** (`report-schema.json`) décrivant les colonnes.

Les fichiers sont écrits dans `/<folder>/reports-<timestamp>/`.

## 7) Sources officielles

EcoIndex (quantiles + formule) :

- Quantiles : https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/quantiles.py
- Grades : https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/grades.py
- Formule : https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/compute/ecoindex.py
- Méthodologie : https://www.ecoindex.fr/comment-ca-marche/

Référence de compatibilité :

- GreenIT-Analysis : https://github.com/cnumr/GreenIT-Analysis
