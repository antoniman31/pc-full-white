# PC Full White — Journal

L'histoire du projet et ses décisions. L'état actuel est dans `README.md` (et `SPEC.md` pour l'accessibilité et
Material 3), ce qui reste dans `RESTE-A-FAIRE.md`. Le détail de chaque changement est dans l'historique git et les PR ;
chaque lot s'ajoute ici en fin de fichier, sous `### Titre — jj/mm/aaaa`.

## Décisions prises (reprises de l'ancien TODO.md, octobre 2026)

- Le relevé (`scraper/`) tourne le 1er et le 15, lit plusieurs revendeurs par article et ne
  suit que ce qui a des sources : le rapport de chaque PR dit combien de prix ont réellement
  été vérifiés. Il s'identifie franchement et respecte `robots.txt` : un site qui bloque les
  robots n'est pas contourné. Les conditions d'usage de chaque revendeur n'ont pas été
  vérifiées une à une. Pas de [PriceBuddy](https://github.com/jez500/pricebuddy), de
  changedetection.io & co : ce sont des serveurs à héberger, qui ne nourrissent pas
  `prices.json`. PRICE-FINDER (revendeurs français) n'a pas de licence : son principe (chercher
  par nom puis valider la fiche) est repris, pas son code.
- Tests navigateur : **ajoutés le 21/10/2026** (axe-core, parcours clavier, cibles de 48 px,
  job CI `accessibilite`), à la demande d'Antoni et malgré la recommandation initiale. Ils
  coûtent `package.json`, un lockfile et Node dans un dépôt qui n'en avait pas.
- Pas de notifications push, pas de graphique d'historique plus riche : sur-ingénierie pour
  un site à usage personnel.

## Lots

### Prix cible — 16/11/2026

`target_price` (facultatif) sur un article de `data/prices.json` ; le rapport de chaque relevé dit l'écart, et « cible
atteinte » quand un prix vérifié passe dessous. Seul le GPU en a un (1 479 €, le plafond de la veille GPU). PR #80.

### Cases du workflow dans l'export ; PWA abandonnée — 16/11/2026

Les cases cochées du workflow de montage voyagent dans le fichier « Exporter » de Réglages et s'ajoutent à celles de
l'appareil à l'import, sans jamais en décocher. Une ligne affichée écrivait `false` pour chaque case : seules les vraies
coches comptent. La PWA installable est abandonnée (choix d'Antoni). PR #81.

### Règles communes et suivi unifié — 16/11/2026

`CLAUDE.md` créé, avec le bloc commun des 8 dépôts (décisions d'Antoni : fusion sur « go » seulement, noms de modèle
autorisés, zones tactiles de 48 px). `TODO.md` devient `RESTE-A-FAIRE.md` ; ses décisions passent ici.

### CI, trois niveaux — 16/11/2026

Bloc commun : règle « CI, trois niveaux » (rapide à chaque PR, lourd seulement si autre chose que des `.md` change, appareil réel). Ici, le job `accessibilite` (~390 tests navigateur) dépend d'un job `changements` et se saute sur une PR qui ne
touche que des `.md` ; `controles` tourne toujours. Sur `main`, tout tourne.

### Règles communes : trois changements — 21/11/2026

Bloc commun de `CLAUDE.md` mis à jour (décision d'Antoni) : deux règles en plus et une règle précisée, « Versions et API » (vérifier les
versions dans la doc officielle, signaler tout code déprécié) et « Contradiction » (signaler une demande qui contredit une
règle avant de l'appliquer) ; « Proposer d'abord » demande désormais un plan détaillé et des suggestions avant tout code, et un visuel (maquette HTML ou schéma ASCII) pour une fonctionnalité ou un design ; « les 8 dépôts » devient « tous les dépôts d'Antoni, existants et futurs », avec l'arrivée de game_timer.

### Règles communes : « Proposer d'abord » reformulée — 21/11/2026

Formulation d'Antoni : un plan détaillé (étapes, fichiers touchés, approche) et des suggestions d'amélioration avant tout changement, puis l'« ok » ; pour une fonctionnalité ou un design, proposer sans coder, avec questions et visuel (maquette HTML sans canvas ou schéma ASCII). Le bloc est identique dans tous les dépôts et dans le skill `regles-communes-depots`.

### Règles communes mises à jour — 21/11/2026

Bloc commun de `CLAUDE.md` aligné sur `regles-communes` (BLOC.md, commit 98885d3), par la propagation automatique.

### Règles communes mises à jour — 21/11/2026

Bloc commun de `CLAUDE.md` aligné sur `regles-communes` (BLOC.md, commit 400626b), par la propagation automatique.

### Règles communes mises à jour — 21/11/2026

Bloc commun de `CLAUDE.md` aligné sur `regles-communes` (BLOC.md, commit 2005adb), par la propagation automatique.

### Couleurs en jetons — 24/11/2026

Audit de la règle commune « Design » : 6 couleurs étaient écrites dans les règles de `site/style.css` au lieu d'un jeton
(fin du dégradé de marque, ombre de la barre d'envoi, ombres de défilement du tableau, fond du schéma de flux d'air, voile
de la boîte de dialogue). Elles deviennent `--am31-blue-light`, `--elev-barre`, `--ombre-defilement`, `--fond-schema` et
`--voile`, avec les mêmes valeurs : rien ne change à l'écran. `tests/unit/couleurs.mjs` (dans `checks.yml`) refuse
désormais toute couleur hors d'une définition de jeton ; vu rouge sur l'ancien code (6 relevés), vert après.
Qualité : `logique.mjs` + `couleurs.mjs` 12/12, scraper OK, `check_prices.py` OK ; Playwright local 385 réussis,
1 échec (`onglets.spec.mjs`, swipe aux deux bouts, téléphone) qui échoue aussi sur le code d'avant, hors de ce lot.
