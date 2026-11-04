# PC Full White — suivi budget et montage

Site de suivi du budget et du montage du PC Full White d'AntoniMan31, consultable depuis un téléphone.
**En ligne :** https://antoniman31.github.io/pc-full-white/

HTML, CSS et JS sans framework · Python (relevé des prix) · GitHub Actions et Pages.

## Principe

- **`data/prices.json` est la seule source de vérité** : prix, statuts, checklists, historique. Rien n'est codé en dur dans la page.
- **Rien ne part en ligne sans relecture** : le relevé des prix et tes modifications passent par une Pull Request, jamais par un commit direct sur `main`.
- **Tes achats et modifications restent dans ton navigateur** jusqu'à ce que tu les envoies.

```
revendeurs ──► relevé (Actions, 1er et 15) ──► PR « prix » ──┐
                                                             ├─► fusion ──► data/prices.json ──► GitHub Pages ──► site
navigateur ──► « Envoyer » ──► PR site-changes/… ────────────┘
 (achats, prix saisis)          (data/changes.json)
```

## Fonctionnalités

- **9 écrans** : Budget, Matériel (PC, Périphériques, Mobilier), Achats, Suivi (Historique, Workflow, Risques), Réglages.
- **Budget recalculé** à chaque achat, prix saisi, article ajouté ou supprimé, avec les mêmes formules que le contrôle de la CI.
- **Prix affiché = offre valide la moins chère**, avec sa fraîcheur (« relevé le 21/10 ») et les autres offres sous « Où acheter ».
- **Historique** : courbes par composant, carte thermique, budget total dans le temps.
- **Workflow de montage** : 141 étapes à cocher, enregistrées sur l'appareil.
- **Envoi des changements** vers le dépôt par Pull Request, et **lancement d'un relevé** depuis Réglages.
- **Trois thèmes** (Auto, Clair, Sombre noir pur pour OLED), impression en clair, export CSV.

## Utiliser le site

**Navigation.** Barre du bas sous 600 px ; dès 600 px, barre latérale avec icônes, sous-onglets avec icônes et texte 10 % plus grand. Les sous-onglets se parcourent aussi au swipe.

**Thèmes.** Réglages ou icône en haut de page. En Auto, le thème suit le système. L'impression repasse toujours en clair.

**Fraîcheur d'un prix.** Une alerte ambre « à vérifier » apparaît si le prix a plus de 7 jours ou repose sur une seule boutique (IKEA, seul vendeur de ses produits, est exclu de cette règle).

**Envoyer ses changements.** Achats, prix saisis, produits modifiés, articles ajoutés ou supprimés :
1. Dans Réglages, colle un **token GitHub fine-grained** limité à ce dépôt : *Contents*, *Pull requests* et *Actions* en écriture, 90 jours maximum. Il reste dans ce navigateur ; « Oublier le token » l'efface.
2. « Envoyer » crée la branche `site-changes/…`, y écrit `data/changes.json` et ouvre la PR. Un envoi suivant met à jour la même PR tant qu'elle est ouverte.
3. `.github/workflows/site-changes.yml` applique `changes.json` à `prices.json` (`scripts/apply_changes.py`), contrôle la cohérence et commit le résultat. Il remet aussi à jour les PR `site-changes/…` ouvertes quand `main` change.
4. Fusionne la PR, puis « Vider ma liste locale » dans Réglages une fois le site republié.

**Lancer un relevé.** La carte « Relevé des prix » de Réglages propose « Relevé complet » (ouvre une PR de prix) et « Essai » (n'écrit rien, rapport dans le résumé du job). Chaque lancement demande une confirmation : un relevé consomme des recherches SerpApi. La page suit l'avancement toutes les 15 secondes et affiche le lien de la PR. La fusion reste manuelle.

**Checklist de montage.** Chaque case est enregistrée dans le `localStorage` de l'appareil : pas de compte, pas de synchronisation entre téléphone et PC.

## Relevé des prix

Le 1er et le 15 de chaque mois à 7 h UTC, ou à la main (*Actions → Relevé des prix → Run workflow*). Le script ouvre une PR, en brouillon si le contrôle de cohérence échoue.

| Règle | Valeur |
|---|---|
| Prix retenu | l'offre valide la moins chère |
| Offre valide | le nom de la fiche contient les mots attendus et aucun mot interdit (`scraper/sources.json`) |
| Écarté comme absurde | prix sous 70 % de la médiane, ou hors de 0,5 à 2 fois le prix actuel |
| Écrit seulement si | au moins 2 sites concordent (1 pour IKEA) **et** la variation reste sous 30 % |
| Sinon | le prix est *proposé* dans la description de la PR |
| Articles achetés | figés ; sans source : listés « sans source » dans le rapport |

**Respect des sites.** Données structurées uniquement (JSON-LD, microdata, Open Graph, via [extruct](https://github.com/scrapinghub/extruct)), jamais « le premier montant de la page ». Identifiant `pc-full-white-price-check`, `robots.txt` respecté, une requête toutes les 3 s par site. Un site qui bloque est signalé, pas contourné.

**Liens d'achat.** Chaque article garde dans `prices.json` (`offers`) les fiches qui ont servi : revendeur, adresse, prix, date. Une fiche momentanément injoignable garde son lien 60 jours.

**Google Shopping et Amazon (SerpApi).** Pour les articles que les fiches directes ne confirment pas (Cdiscount, Darty et Fnac interdisent les robots, Materiel.net refuse GitHub, Amazon n'a pas d'API ouverte). Forfait gratuit de 250 recherches par mois ; au plus 40 par passage (25 Shopping, 15 Amazon, Amazon en dernier recours). Une offre vue il y a moins de 14 jours reste valable si le vendeur ne ressort pas aujourd'hui (« mémorisée » dans le rapport). Les produits de référence génériques (`auto: false`) ne sont jamais écrits sans ton accord. Activation : secret de dépôt `SERPAPI_KEY` (*Settings → Secrets and variables → Actions*). Sans lui, le complément est désactivé sans rien casser.

**Modes manuels** (champ *mode*) :

| Mode | Effet |
|---|---|
| `releve` | relevé complet, écrit les prix, ouvre une PR (mode des passages automatiques) |
| `essai` | idem sans rien écrire ; rapport dans le résumé du job |
| `decouverte` | cherche des fiches par nom chez chaque revendeur, ouvre une PR sur `sources.json` |
| `essai-decouverte` | idem sans PR |
| `sonde` | teste des adresses collées dans le champ *adresses* |

**Ajouter une source.** Dans `scraper/sources.json`, ajoute `{"retailer": "ldlc", "url": "https://…"}` à `sources` de l'article. Pour vérifier qu'une adresse est lisible, utilise d'abord `sonde`. En local : `pip install -r scraper/requirements.txt`, puis `python3 scraper/update_prices.py --dry-run` (ou `--probe URL`).

## Structure

```
pc-full-white/
├── data/
│   ├── prices.json          # source de vérité
│   └── changes.json         # changements envoyés depuis le site
├── site/
│   ├── index.html           # page unique, sprite d'icônes, politique de sécurité
│   ├── style.css            # design system Full White (Material 3)
│   ├── app.js               # génère tout depuis prices.json
│   └── fonts/               # polices auto-hébergées
├── scraper/                 # relevé : update_prices.py, sources.json, retailers.json,
│   └── tests/               #   extract / fetch / aggregate / recompute / shopping / discover / changes
├── scripts/
│   ├── check_prices.py      # recalcule les totaux, refuse un JSON incohérent
│   ├── apply_changes.py     # applique changes.json à prices.json
│   └── stamp_assets.py      # numéros de version des fichiers + empreinte de la politique de sécurité
├── tests/                   # Playwright (13 fichiers) ; unit/ : logique pure, sans navigateur
├── docs/                    # archive : anciens PDFs (Sauvegarde, LITE, Workflow)
├── .github/workflows/
│   ├── checks.yml           # données, tests du scraper, tests de logique, accessibilité
│   ├── update-prices.yml    # relevé le 1er et le 15 + modes manuels
│   └── site-changes.yml     # applique et rafraîchit les PR site-changes/…
├── SPEC.md                  # spécification accessibilité / Material 3
├── TODO.md                  # points ouverts
└── index.html               # redirection vers site/
```

## Développer

```bash
python3 -m http.server 8000      # puis http://localhost:8000/site/
```

Le serveur sert **la racine du dépôt**, pas `site/` : `app.js` lit `../data/prices.json`. C'est aussi ainsi que GitHub Pages sert le projet.

```bash
python3 scripts/check_prices.py data/prices.json   # cohérence des données (CI)
node --check site/app.js                           # syntaxe (CI)
node --test tests/unit/logique.mjs                 # logique du budget, < 1 s (CI)
python3 -m unittest discover -s scraper/tests      # scraper, sans réseau (CI)
python3 scripts/stamp_assets.py                    # après toute modif de app.js, style.css ou du script du <head>
npm ci && npx playwright install chromium          # la première fois
npx playwright test                                # ~390 tests, environ 4 minutes
```

| Tests | Nombre | Rôle |
|---|---|---|
| `scraper/tests` (Python) | 142 | extraction, concordance, recalcul des totaux, changements, Shopping |
| `tests/unit` (Node) | 9 | nettoyage des changements locaux, calcul du budget |
| `tests/*.spec.mjs` (Playwright, bureau et mobile) | ~390 | accessibilité (axe, clair et sombre), clavier, cohérence visuelle, envoi, relevé, fraîcheur, politique de sécurité |

**Conventions.**
- `stamp_assets.py` écrit `?v=<empreinte>` sur `style.css` et `app.js`, et l'empreinte du script du `<head>` dans la politique de sécurité. La CI échoue si tu l'oublies.
- Seuils d'écran autorisés : 599, 600, 839, 840, 1199, 1200 px (un test le vérifie). Texte courant 12 px minimum.
- Les couleurs sont des tokens CSS avec `light-dark()` ; les données gardent des emojis (`prices.json`), traduits en pictogrammes par `EMOJI_ICON` dans `app.js`.
- La logique testée sans navigateur est repérée par `// >>> logique pure` et `// <<< fin logique pure` dans `app.js`.

## Sécurité

- **Token** : stocké dans le navigateur seulement, limité à ce dépôt, 90 jours maximum. Droits nécessaires : *Contents*, *Pull requests*, *Actions* (écriture).
- **Politique de sécurité du contenu** (balise `<meta>`) : scripts du site uniquement, connexions limitées au site et à `api.github.com`. Aucune requête vers un tiers : polices auto-hébergées. `frame-ancestors` n'est pas prise en charge dans une balise meta, donc l'affichage dans une iframe n'est pas bloqué.
- **Branche `main`** : protège-la (PR obligatoire) pour que le token ne puisse rien y pousser directement.
- **Actions épinglées par SHA**, mises à jour par Dependabot (mensuel).

## Déployer

1. **Settings → Pages**, source **Deploy from a branch**.
2. Branche `main`, dossier `/ (root)` : `index.html` à la racine redirige vers `site/`.
3. Sauvegarder ; l'adresse apparaît après 1 à 2 minutes.

## Crédits

Pictogrammes : [Material Symbols](https://fonts.google.com/icons) (Google, style « outlined », licence Apache 2.0), extraits de `@material-symbols/svg-400` et intégrés au sprite de `site/index.html`.

*AntoniMan31, dev Android et web amateur, Toulouse.*
