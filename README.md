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
│   └── update_prices.py      # vérifie les prix idealo une fois par mois
├── scripts/
│   └── check_prices.py       # recalcule les totaux, refuse un JSON incohérent
├── tests/
│   └── a11y.spec.mjs         # axe-core (clair et sombre), clavier, cibles 48px, débordement, thème
├── SPEC.md                  # spécification de la refonte accessibilité / Material 3
└── .github/workflows/
    ├── checks.yml            # cohérence des données + syntaxe + accessibilité
    └── update-prices.yml     # cron mensuel + ouvre une Pull Request
```

## Contrôles en local

```bash
# Cohérence des données et syntaxe (identique à la CI)
python3 scripts/check_prices.py data/prices.json
node --check site/app.js

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
