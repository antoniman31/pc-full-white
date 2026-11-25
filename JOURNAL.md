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

### Messages d'erreur GitHub : dire quoi faire — 24/11/2026

Revue de la règle commune « Design » (un message d'erreur dit ce qui s'est passé et comment corriger). Les quatre messages
de `ghError` (token refusé, droits manquants, pas de réseau, autre réponse) disent maintenant l'action utile (« crée-en un
nouveau sur GitHub et colle-le ici »). `ghError` passe dans un bloc de logique pure, testé par `logique.mjs` : chaque cas a
la forme « constat : action » (vu échouer sur l'ancien texte). Qualité : 13 tests unitaires, `envoi` et `releve` (28 tests
navigateur) verts en local.

### Règles communes mises à jour — 25/11/2026

Bloc commun de `CLAUDE.md` aligné sur `regles-communes` (BLOC.md, commit 864f26d), par la propagation automatique.

### Mention « Fait par AntoniMan31/Claude Code » et version — 25/11/2026

Règle commune « Interface » écrite le même jour (choix d'Antoni). Réglages se termine par une carte « À propos » : « Fait par
AntoniMan31/Claude Code », puis, au bouton « Voir la version », « … · version a1b2c3d du 25/11/2026 ». Le site est publié
depuis `main` sans étape de build : la version est le dernier commit qui touche `site/`, demandé à l'API publique de GitHub
sans token. D'abord lue à l'ouverture de Réglages, elle faisait tomber sept tests qui gardent la règle du site « aucune
requête vers GitHub avant un clic » ; choix d'Antoni : un bouton, la règle reste intacte. Réponse filtrée (identifiant
hexadécimal, date) ; en erreur : « version inconnue ». `ligneVersion` est dans la logique pure (date en heure de Paris : hiver,
été, nuit du changement d'heure, testés dans `tests/unit/logique.mjs`) ; deux tests navigateur dans `reglages.spec.mjs` (mention
sans requête, clic qui lit la version sans token, erreur), vus échouer avant le code (4 échecs). Qualité : 14 tests unitaires,
`check_prices.py` et scraper OK, Playwright 389 passés et 1 échec (« swipe entre onglets, aux deux bouts », téléphone), qui
échoue aussi sur le code d'avant dans le conteneur : sans rapport avec ce lot, la CI tranche.

### Signature : logo AM.31 aux couleurs du site — 25/11/2026

Suite de la mention du même jour (choix d'Antoni : variante C d'une maquette, centrée). La carte « À propos » de Réglages porte le logo AM.31
(34 px de haut), « Fait par AntoniMan31/Claude Code » (le nom en `--primary`) et, après le bouton « Voir la version », « version a1b2c3d ·
jj/mm/aaaa » (lue sur GitHub au clic seulement, sans token : la règle « aucune requête avant un clic » reste intacte). Le logo vient de trois
calques PNG (`site/logo/`, 16 Ko) que le CSS colore avec `--am31-blue` mêlé de noir ou de blanc. Un double clic (vrai bouton de 48 px) alterne
cette couleur et le bleu d'origine (`--logo-contour`, `--logo-remplissage`) ; rien n'est mémorisé, pas de lien GitHub (choix d'Antoni). Le double
appui se compte à la main (`estDoubleClic`, 350 ms) : `dblclick` n'existe pas au clavier. `ligneVersion` devient `versionTexte`. Contrôles vus
échouer sur le code d'avant : `tests/unit/logique.mjs` et `reglages.spec.mjs` (version, signature et logo). Qualité : 15 tests unitaires,
Playwright local 390 passés et 2 échecs au passage complet : « swipe entre onglets » (téléphone), qui échoue aussi sans ce lot, et « toute cible
interactive mesure au moins 48px » (bureau), vert à la relance seule (4 passés).
