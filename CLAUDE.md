# PC Full White — règles du projet

## Règles communes (le même bloc dans les 8 dépôts d'Antoni : le modifier ici, c'est le modifier partout)

Décidées par Antoni le 16/11/2026. Les règles propres à ce dépôt suivent ce bloc ; en cas de conflit, ce bloc l'emporte.

- **Avec Antoni** : français, tutoiement, réponses courtes, franches, sans flatterie. Il est seul utilisateur (Galaxy S26 Ultra, PC Windows).
- **Proposer d'abord** : décrire le changement, attendre un « ok » explicite avant de toucher quoi que ce soit, ne jamais régénérer un fichier de son propre chef. « Pose des questions » veut dire `AskUserQuestion`, avec des choix concrets et un recommandé.
- **Fusion** : PR en brouillon, fusion par squash **seulement sur le « go » d'Antoni**, CI verte. Jamais de fusion de sa propre initiative, même verte.
- **Branche** : celle que la session impose. Aucun nom de branche n'est écrit dans ce dépôt : l'environnement le change à chaque session.
- **Identité de commit** : `AntoniMan31 <268696974+antoniman31@users.noreply.github.com>`. Jamais l'adresse personnelle d'Antoni : GitHub refuse le push qui l'expose.
- **Noms de modèle** : autorisés (ligne de co-auteur des commits comprise).
- **Secrets** : jamais de clé, de jeton ni de mot de passe dans le dépôt ou la conversation ; ils se saisissent dans l'application ou dans les secrets GitHub/Cloudflare. Jamais d'export de données personnelles ni de `.env` commité.
- **Tests** : le lint et les tests du dépôt passent avant chaque commit. Un test ne compte qu'après l'avoir **vu échouer** sur le code d'avant. Jamais affaiblir un contrôle pour obtenir du vert (test sauté, seuil baissé, exception sans raison écrite).
- **Interface** : de vrais boutons (jamais un `div` cliquable) ; dans une appli utilisée au doigt, **zones tactiles d'au moins 48 px** (48 dp sous Android) ; contraste et focus vérifiés par l'outil du dépôt.
- **Robustesse** : une écriture qui peut échouer (stockage, réseau) se voit à l'écran ; toute donnée venue d'un fichier, du stockage ou du réseau est une entrée non fiable. Exporter les données avant toute opération destructive.
- **Écrit** : commentaires en français qui disent **pourquoi** ; aucun chiffre écrit sans l'avoir mesuré ; ne jamais écrire « ça marche » pour ce qui n'a pas tourné sur l'appareil réel.
- **Suivi, trois fichiers à la racine** : `README.md` dit l'**état actuel** ; `JOURNAL.md` garde l'**histoire** (chaque lot s'y ajoute en fin de fichier, sous `### Titre — jj/mm/aaaa`) ; `RESTE-A-FAIRE.md` dit **ce qui reste**, mis à jour à chaque lot. Un fichier de suivi retiré part en entier dans `JOURNAL.md`, sous « Ancien X.md ».

## Règles propres à ce dépôt

Suivi du budget et du montage d'un PC pour un achat en **mai-juin 2027** : HTML, CSS et JavaScript sans framework (`site/`),
un relevé des prix en Python (`scraper/`), GitHub Actions et Pages. **Ne pas sur-construire** : c'est un outil personnel
à durée de vie limitée. État : `README.md` et `SPEC.md` ; ce qui reste : `RESTE-A-FAIRE.md` ; l'histoire : `JOURNAL.md`.

## Commandes (toutes celles marquées CI avant un commit)

```bash
python3 -m http.server 8000                        # puis http://localhost:8000/site/ (la racine du dépôt, pas site/)
python3 scripts/check_prices.py data/prices.json   # cohérence des données (CI)
node --check site/app.js                           # syntaxe (CI)
node --test tests/unit/logique.mjs                 # logique pure de app.js (CI)
python3 -m unittest discover -s scraper/tests      # scraper, sans réseau ; dépendances de scraper/requirements.txt (CI)
python3 scripts/stamp_assets.py                    # après toute modification de app.js, style.css ou du script du <head>
npx playwright test                                # ~390 tests navigateur (accessibilité, clavier, envoi, relevé), ~4 min (CI)
```

En cloud, le Chromium de Playwright peut manquer : passer `launchOptions.executablePath: "/opt/pw-browsers/chromium"` par une
configuration locale qui importe `playwright.config.mjs` (à ne pas commiter).

## Pièges connus

- **`data/prices.json` est la seule source de vérité** : rien n'est codé en dur dans la page. Les totaux se recalculent avec
  les mêmes formules que `check_prices.py`.
- **Rien ne part en ligne sans relecture** : le relevé des prix et les changements saisis sur le site passent par une PR
  (`prix/releve`, `site-changes/…`). Une PR ouverte avec le `GITHUB_TOKEN` du robot ne déclenche pas `checks.yml` : le relevé
  lance `check_prices.py` lui-même et dit son verdict dans la PR.
- **`stamp_assets.py`** écrit `?v=<empreinte>` sur `style.css` et `app.js` et l'empreinte du script du `<head>` dans la CSP :
  un oubli fait échouer la CI (et le test `csp.spec.mjs`).
- **Le relevé respecte `robots.txt`** et s'identifie franchement : un site qui bloque n'est jamais contourné.
- **Le stockage local écrit `false` pour chaque case affichée** du workflow : compter les coches avec `cleanChecklist`.

## Conventions

- La logique testée sans navigateur est entre `// >>> logique pure` et `// <<< fin logique pure` dans `app.js`.
- Couleurs par jetons CSS avec `light-dark()` ; seuils d'écran autorisés : 599, 600, 839, 840, 1199, 1200 px (un test le
  vérifie) ; texte courant 12 px au moins.
- Le token GitHub de la page (fine-grained, limité au dépôt, 90 jours) ne vit que dans le navigateur d'Antoni.
