# PC Full White — Suivi de projet

Site de suivi budget et workflow de montage pour le projet PC Full White d'AntoniMan31.

**🔗 Site en ligne :** https://antoniman31.github.io/pc-full-white/

## Ce que fait ce repo

Remplace les anciens PDFs (Sauvegarde, LITE, Workflow) par une page web unique, toujours à jour, consultable depuis un téléphone.

- **`data/prices.json`** — la seule source de vérité. Tous les prix, statuts, checklists de montage viennent de ce fichier. Rien n'est codé en dur dans le HTML.
- **`site/`** — la page web (HTML/CSS/JS vanilla, pas de framework). Lit `prices.json` et génère tout le contenu dynamiquement.
- **`scraper/`** — script Python qui revérifie les prix des composants principaux une fois par mois et met à jour `prices.json` automatiquement.
- **`.github/workflows/`** — automatisation GitHub Actions (cron mensuel du scraper).

## Ce qui change par rapport aux PDFs

| | PDFs (avant) | Site (maintenant) |
|---|---|---|
| Mise à jour d'un prix | Régénérer le script Python, 3 fichiers séparés | Éditer une ligne dans `prices.json` |
| Cases à cocher (workflow) | ☐ statiques, à cocher au stylo | Vraies checkboxes, sauvegardées sur l'appareil |
| Consultation mobile | Ouvrir/télécharger un PDF | Une URL, comme n'importe quel site |
| Cohérence des chiffres | À vérifier manuellement à chaque fois | Un seul total calculé depuis les mêmes données partout |
| Impression | Natif | `Ctrl+P` depuis le navigateur (CSS d'impression inclus) |

## Activer GitHub Pages

1. Sur GitHub, aller dans **Settings** → **Pages**
2. Source : **Deploy from a branch**
3. Branch : `main`, dossier `/ (root)` — `index.html` à la racine redirige vers `site/`
4. Sauvegarder — l'URL apparaît en haut de la page après 1-2 minutes

## Structure

```
pc-full-white/
├── data/
│   └── prices.json          # source de vérité : prix, statuts, checklists
├── site/
│   ├── index.html           # page unique, 7 onglets
│   ├── style.css             # design system Full White / AM31 Blue
│   └── app.js                 # génère tout le contenu depuis prices.json
├── docs/                    # PDFs (Sauvegarde, LITE, Workflow) + Markdown canonique
├── index.html               # redirection vers site/
├── scraper/
│   ├── update_prices.py      # relevé des prix : plusieurs sites par article, le moins cher du groupe, totaux recalculés
│   ├── sources.json          # par article : requête, mots obligatoires / interdits, fiches produit
│   ├── retailers.json        # pages de recherche des revendeurs (découverte)
│   ├── extract.py fetch.py aggregate.py discover.py recompute.py report.py
│   └── tests/                # 80 tests, sans réseau (fausse session HTTP)
├── scripts/
│   └── check_prices.py       # recalcule les totaux, refuse un JSON incohérent
├── tests/
│   └── a11y.spec.mjs         # axe-core (clair et sombre), clavier, cibles 48px, débordement, thème
├── SPEC.md                  # spécification de la refonte accessibilité / Material 3
└── .github/workflows/
    ├── checks.yml            # cohérence des données + tests du scraper + accessibilité
    └── update-prices.yml     # relevé le 1er et le 15, + modes manuels, ouvre une Pull Request
```

## Contrôles en local

```bash
# Cohérence des données et syntaxe (identique à la CI)
python3 scripts/check_prices.py data/prices.json
node --check site/app.js
python3 scripts/stamp_assets.py        # après toute modif de site/app.js ou site/style.css : met à jour les numéros de version (la CI le vérifie)

# Accessibilité — la première fois seulement
npm ci && npx playwright install chromium

npx playwright test
```

Le serveur de test sert **la racine du dépôt**, pas `site/` : `app.js` lit
`../data/prices.json`, qui est hors de `site/`. C'est aussi ainsi que GitHub Pages
sert le projet.

Pour simplement regarder le site :

```bash
python3 -m http.server 8000   # puis ouvrir http://localhost:8000/site/
```

## Relevé des prix

Deux passages par mois (le 1er et le 15, 7h UTC), plus un lancement manuel possible depuis
l'onglet **Actions → Relevé des prix → Run workflow**. Le script ne commit jamais sur `main` :
il ouvre une Pull Request, en brouillon si le contrôle de cohérence échoue.

**Méthode.** Pour chaque article encore à acheter, il lit plusieurs fiches produit
(`scraper/sources.json`), ne garde que celles dont le **nom** correspond à l'article (mots
obligatoires et interdits : un kit, une autre couleur ou un accessoire est écarté), retient le
**prix le moins cher de toutes les offres valides** (les autres vont dans « Où acheter » ; seul
un prix sous 70 % de la médiane est écarté comme absurde), puis recalcule les totaux, le récapitulatif et l'historique. Un prix n'est écrit
que si **deux sites** ont répondu et que le saut reste sous 30 % ; sinon il est seulement
*proposé* dans la description de la PR.

**Ce que le script ne fait pas.** Il lit uniquement des données structurées (JSON-LD, microdata,
Open Graph, via [extruct](https://github.com/scrapinghub/extruct)) : jamais « le premier montant
en € de la page ». Il s'identifie franchement (`pc-full-white-price-check`, pas un faux Chrome),
respecte `robots.txt` et espace ses requêtes. Un site qui le bloque reste « bloqué » dans le
rapport, il n'est pas contourné. Les articles déjà achetés restent figés, comme le veut la règle
du budget ; ceux sans source (estimations génériques, Amazon) sont listés « sans source ».

**Liens d'achat.** Pour chaque article relevé, le script écrit dans `prices.json` (`offers`) la
liste des fiches qui ont servi au prix retenu : revendeur, adresse, prix, date. Le site les affiche
sous **Où acheter**, du moins cher au plus cher, chaque lien s'ouvrant dans un nouvel onglet. Une
fiche introuvable ou qui ne correspond plus au produit est retirée ; une fiche momentanément
injoignable garde son lien 60 jours.

**Complément Google Shopping.** Cdiscount, Darty et Fnac interdisent les robots, Materiel.net refuse
GitHub, Amazon n'a pas d'API ouverte. Pour les articles que les fiches directes ne confirment pas, le
script interroge [SerpApi](https://serpapi.com) (Google Shopping, forfait gratuit : 250 recherches par mois ;
au plus 25 recherches Shopping par passage, soit 80 par mois avec Amazon, essais manuels compris à surveiller). Les offres passent par les mêmes règles de nom, de concordance et d'écart ;
leur lien est souvent la fiche Google du produit, d'où la mention « via Google Shopping ». Les produits de
référence génériques (`auto: false` dans `sources.json`) ne sont jamais écrits sans ton accord.
**Amazon.fr** (même clé, moteur `amazon` de SerpApi) n'est interrogé qu'en dernier recours : pour un article
que ni les fiches directes ni Shopping ne confirment. Son lien pointe vers la fiche Amazon. Au plus 15
recherches Amazon par passage ; `"amazon": false` dans `sources.json` l'exclut pour un article.
**Offres mémorisées.** Une offre Shopping ou Amazon vue il y a moins de 14 jours reste valable si le
vendeur ne ressort pas dans la recherche du jour : sans ça, un prix rebondit d'un relevé à l'autre
(le GPU passait de 1 419,99 € à 1 499,95 € et inversement). Une offre revue aujourd'hui chez le même
marchand la remplace ; une fiche directe est toujours relue, jamais mémorisée. Le rapport l'indique
(« mémorisée, vue le jj/mm »).
Activation : créer un compte SerpApi, puis **Settings → Secrets and variables → Actions → New repository
secret**, nom `SERPAPI_KEY`. Sans ce secret, le complément est désactivé sans rien casser. Au plus 40
recherches par passage.

**Modes manuels** (champ *mode* du formulaire) :

| Mode | Effet |
|---|---|
| `releve` | relevé complet, écrit les prix, ouvre une PR (le mode des passages automatiques) |
| `essai` | même chose sans rien écrire ; le rapport s'affiche dans le résumé du job |
| `decouverte` | cherche des fiches **par nom** sur la page de recherche de chaque revendeur, ne garde que celles dont le nom est validé, ouvre une PR sur `sources.json` |
| `sonde` | teste des adresses collées dans le champ *adresses* et affiche ce que le script y lit |

**Ajouter une source à la main** : dans `scraper/sources.json`, ajouter `{"retailer": "ldlc",
"url": "https://…"}` à `sources` de l'article. Pour vérifier d'abord qu'une adresse est lisible,
la coller dans le mode `sonde`. En local : `pip install -r scraper/requirements.txt`, puis
`python3 scraper/update_prices.py --dry-run` (ou `--probe URL`).

## Mettre à jour un prix manuellement

Ouvrir `data/prices.json`, trouver la ligne du composant, changer `"price"`. Exemple :

```json
{ "id": "cpu", "name": "CPU", "price": 396, ... }
```

Devient :

```json
{ "id": "cpu", "name": "CPU", "price": 380, ... }
```

Commit + push → le site se met à jour automatiquement (GitHub Pages sert toujours la dernière version de `main`).

## Scraper automatique

Le script `scraper/update_prices.py` tourne une fois par mois via GitHub Actions (voir `.github/workflows/update-prices.yml`). Il vérifie les prix des composants qui ont une URL de référence dans `prices.json` (champ `"price_source_url"`, déjà renseigné pour CPU/CM/GPU), compare à l'ancien prix, et **ouvre une Pull Request** avec les changements — jamais de commit direct sur `main`, pour qu'un prix mal extrait (page bloquée, structure de site changée) ne parte jamais en ligne sans relecture. Il suffit d'ouvrir la PR, vérifier que les nouveaux prix sont plausibles, et fusionner.

Si le scraping échoue pour un composant (page bloquée, structure changée), ce composant garde sa dernière valeur connue et le script continue avec les suivants — un échec ne bloque jamais les autres vérifications.

## Historique de prix

L'onglet **Historique** affiche l'évolution du budget total dans le temps (`price_history` dans le JSON) et le détail par composant (`price_history_components`). Chaque vérification mensuelle ajoute une ligne — c'est l'équivalent du tableau qu'on maintenait à la main dans le PDF, mais avec un graphique en plus.

## Checklist de montage — comment ça marche

Chaque case cochée dans l'onglet Workflow est sauvegardée dans le `localStorage` du navigateur (propre à chaque appareil — pas de compte, pas de synchronisation entre téléphone et PC). Pour repartir de zéro, vider les données du site dans les réglages du navigateur.

---

*Repo public — AntoniMan31, dev Android & web amateur, Toulouse. PDFs et Markdown de sauvegarde dans `docs/`.*
