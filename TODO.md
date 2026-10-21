# À faire

Liste de travail courte, pas un journal. Dernière mise à jour : 21/10/2026.
Le projet est un suivi de budget et de montage pour un achat en mai-juin 2027 :
ne pas sur-construire.

## Points ouverts sur la config

- [ ] Carte mère ASUS ROG B850-A GAMING WIFI7 NEO : ~280 € vu sur Amazon (Azerty NL, vendeur tiers, 6 restants) le 21/10. À reconfirmer avant l'achat.
- [ ] RAM Corsair Vengeance RGB White CL30 : ~620 € (1FODISCOUNT, 14/10). Fourchette 605-669 € selon revendeur, en hausse (pénurie RAM/NAND).
- [ ] GPU Gigabyte Eagle OC ICE SFF : 1 319,99 € (Fnac/Darty, 21/10). Blanche confirmée (fiche PLE). Longueur en mm non trouvée : vérifier qu'elle passe dans le C8.
- [ ] Veille GPU mensuelle : prix et dispo Eagle ICE ; alternatives ASUS TUF White standard 1 673 € (pas la version BTF, incompatible avec la CM) et Zotac Solid Core OC White (~1 099-1 367 €, en rupture). Plafond 1 479 €.
- [ ] Enceintes Logitech Z207 : 54,98 € PCComponentes, stock non confirmé. Cordon secteur 1,75 m et jack fournis (test Clubic + avis LDLC, pas de fiche constructeur).
- [ ] Bras ONKRON G160-W : confirmer le montage grommet Ø10 mm et l'épaisseur de plateau sur la fiche ONKRON AVANT de percer le KARLBY (charge max 6,5 kg par écran).
- [ ] Stock KARLBY 186 cm : vérifier chez IKEA Toulouse Sud avant déplacement.
- [ ] Prix à reconfirmer : lampe Xiaomi 1S, outils Amazon, support otuiaim, type de licence Windows 11 Pro.
- [ ] Prochaine vérification des prix : novembre 2026.

## Améliorations du site (planifiées, pas commencées)

Ordre voulu : 1, puis 2, puis 3. Un « ok » avant chaque phase, un push et une
vérification en ligne après chacune. Phase 0 (ce fichier, `scripts/check_prices.py`,
`.github/workflows/checks.yml`) : faite le 21/10/2026.

### Phase 1 : mode sombre
Fichiers : `site/style.css`, `site/index.html` (balise `theme-color`), `site/app.js`.
- [ ] Définir les couleurs sombres via les variables CSS (`--am31-blue`, etc.), activées par `prefers-color-scheme: dark`, avec AM31 Blue sombre `#58b9ff`.
- [ ] Remplacer les couleurs écrites en dur dans le CSS (fonds blancs, bordures) par des variables : c'est le vrai travail (~500 lignes de CSS à auditer).
- [ ] Le graphique d'historique (SVG généré en JS) doit lire les mêmes variables.
- [ ] Optionnel : bouton clair / sombre / auto mémorisé dans `localStorage`.
- Risque : un fond ou un texte oublié, illisible en sombre. Tester en Chromium (mobile + bureau) avec captures.

### Phase 2 : PWA installable
Fichiers : `site/manifest.json`, `site/sw.js`, `site/icon-192.png`, `site/icon-512.png`, versions maskable, `apple-touch-icon`, `site/index.html`.
- [ ] Manifest : nom, `start_url` et `scope` adaptés au sous-dossier GitHub Pages `/pc-full-white/site/`, `display: standalone`, thème AM31.
- [ ] Icônes en AM31 Blue (192, 512, maskable).
- [ ] Service worker en réseau d'abord : dernière version quand il y a du réseau, copie en cache sinon. Jamais de donnée périmée présentée comme à jour : `prices.json` en cache seulement en secours hors ligne, avec la date de dernière vérification toujours visible.
- [ ] Incrémenter le nom du cache à chaque modification du site (sinon l'ancien service worker reste actif sur les téléphones).
- Risque : le `scope` avec le sous-dossier Pages (erreur classique qui rend l'installation impossible). Tester l'installabilité dans Chromium.

### Phase 3 : synchro des cases du workflow entre appareils (Worker Cloudflare)
Fichiers : `worker/index.js`, `worker/wrangler.toml`, `worker/test.mjs`, `.github/workflows/worker.yml`, `site/app.js`, `site/index.html`, `README.md`.
- Constat : aujourd'hui les cases du workflow sont dans le `localStorage`, propres à chaque appareil.
- Le Worker de la bibliothèque de jeux ne convient pas tel quel : sa route `/sync` exige un champ `games`. Choix : un Worker dédié `pc-full-white-sync` dans ce repo, avec son propre espace KV (recommandé), plutôt qu'une route ajoutée à l'autre projet.
- [ ] Code de synchro aléatoire de 26 caractères généré sur le site ; seule son empreinte SHA-256 sert de clé KV.
- [ ] L'état (cases cochées) part avec un horodatage ; le serveur refuse un écrasement si un autre appareil est passé entre-temps et l'interface propose le choix.
- [ ] Panneau « Synchroniser » : générer un code, saisir un code, envoyer, récupérer.
- [ ] Déploiement automatique du Worker via GitHub Actions, tests avant.
- À fournir : jeton d'API Cloudflare dans les secrets du repo (`CLOUDFLARE_API_TOKEN`), identifiant de compte (non secret, dans le `wrangler.toml` de la bibliothèque de jeux), création de l'espace KV (faisable via les outils Cloudflare au moment voulu).
- Coût : phase la plus lourde (~250 lignes de Worker, tests, déploiement, interface). Pour un workflow fait une seule fois en 2027 : décision assumée.
- Risque : le code de synchro devient le seul secret (code perdu ou partagé = accès aux cases cochées, pas au budget qui est déjà public).

## Décisions prises

- Le scraper mensuel (`scraper/`, idealo) est gardé même si idealo bloque souvent les requêtes. Il n'ouvre que des Pull Request, jamais de commit direct ; les contrôles de `checks.yml` tournent dessus.
- Pas de notifications push, pas de graphique d'historique plus riche, pas de tests navigateur automatisés : sur-ingénierie pour un site à usage personnel.
