# Methodologie de mesure (version simplifiee)

Ce document explique de facon simple comment est estime le poids d'un site avec cet outil.

## Idee generale

Mesurer le "poids" d'un site est complexe. Un site moderne charge des ressources en plusieurs temps, peut precharger des pages, et change souvent de comportement selon le parcours. Le resultat produit par l'outil est donc **une estimation**, basee sur **les pages et les actions que vous avez choisies de tester**.

Cela est encore plus vrai pour les sites en SPA (Single Page Application) : une navigation interne ne recharge pas tout, et le poids depend fortement des actions effectuees.

## Ce que l'outil mesure

Pour chaque etape du parcours, l'outil observe :

- les requetes declenchees par l'action (clic, navigation, attente),
- la quantite de donnees telechargees,
- l'URL finale de la page apres l'action,
- un score EcoIndex estime a partir de ces elements (qui n'est pas forcement identique au resultat officiel).

L'outil suit un **parcours utilisateur** defini dans un fichier `journey.js` et mesure ce qui se passe pendant chaque etape.

## Apercu technique (succinct)

- Fenetre de mesure par etape : debut de l'action jusqu'a la stabilisation + delai + scroll.
- `request_count` : nombre de requetes observees dans la fenetre.
- `compressed_kb` : volume transfere (taille compressee).
- `decompressed_kb` : estimation via ResourceTiming quand possible, sinon fallback.
- `dom_nodes` : methode GreenIT (exclusion des descendants `svg`).
- EcoIndex : calcule a partir des valeurs observees (estimation).

## Comment interpreter le resultat

- Le chiffre obtenu **n'est pas le poids total absolu du site**.
- Il correspond au **poids du parcours teste**.
- Changer les pages ou les actions change la mesure.

Autrement dit, l'outil donne une **photo representative** d'un parcours, pas une valeur unique pour tout le site.

## Limites importantes

- Les pages non testees ne sont pas prises en compte.
- Les SPA peuvent masquer une partie des telechargements (prefetch, cache, navigation interne).
- Les conditions reseau, la machine et la version du site peuvent influencer la mesure.

## Sources

L'outil s'appuie sur la methode EcoIndex pour le score environnemental :

- https://www.ecoindex.fr/comment-ca-marche/
- https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/quantiles.py
- https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/data/grades.py
- https://raw.githubusercontent.com/cnumr/EcoIndex_python/main/components/ecoindex/compute/ecoindex.py
- https://github.com/cnumr/GreenIT-Analysis
