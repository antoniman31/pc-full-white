# Ce qui reste à faire

> Anciennement `TODO.md` (renommé le 16/11/2026, règle commune des dépôts). L'histoire et les décisions sont dans `JOURNAL.md`.

Liste de travail courte, pas un journal. Dernière mise à jour : 16/11/2026.
Le projet est un suivi de budget et de montage pour un achat en mai-juin 2027 :
ne pas sur-construire.

## Points ouverts sur la config

- [ ] Carte mère ASUS ROG B850-A GAMING WIFI7 NEO : ~280 € vu sur Amazon (Azerty NL, vendeur tiers, 6 restants) le 21/10. À reconfirmer avant l'achat.
- [ ] RAM Corsair Vengeance RGB White CL30 : 669,84 € retenus ; le relevé du 15/11 l'a vue à 780,13 € chez Rue du Commerce (une seule source, non appliqué). En hausse nette (pénurie RAM/NAND) : décider s'il faut l'acheter avant mai plutôt qu'avec le reste.
- [ ] GPU Gigabyte Eagle OC ICE SFF : 1 319,99 € (Fnac/Darty, 21/10). Blanche confirmée (fiche PLE). Longueur en mm non trouvée : vérifier qu'elle passe dans le C8.
- [ ] Veille GPU mensuelle : prix et dispo Eagle ICE ; alternatives ASUS TUF White standard 1 673 € (pas la version BTF, incompatible avec la CM) et Zotac Solid Core OC White (~1 099-1 367 €, en rupture). Plafond 1 479 €.
- [ ] Enceintes Logitech Z207 : 54,98 € PCComponentes, stock non confirmé. Cordon secteur 1,75 m et jack fournis (test Clubic + avis LDLC, pas de fiche constructeur).
- [ ] Bras ONKRON G160-W : confirmer le montage grommet Ø10 mm et l'épaisseur de plateau sur la fiche ONKRON AVANT de percer le KARLBY (charge max 6,5 kg par écran).
- [ ] Stock KARLBY 186 cm : vérifier chez IKEA Toulouse Sud avant déplacement.
- [ ] Prix à reconfirmer : lampe Xiaomi 1S, outils Amazon, support otuiaim, type de licence Windows 11 Pro.
- [x] Relevé automatique le 1er et le 15 (dernier : 15/11, 21 prix vérifiés sur 26 articles couverts, 29 à suivre).

## Améliorations du site

Dernière mise à jour de cette section : 21/10/2026.

- [x] **Mode sombre** : fait (suit le système, bouton auto / clair / sombre). Les tokens
  couleur portent leurs deux valeurs via `light-dark()`.
- [x] **Accessibilité** (clavier, contrastes, cibles de 48 px) et **système Material 3** :
  faits, voir `SPEC.md`.
- [x] **Parité avec les PDF** : donut, avancement, récap des achats, historique détaillé.
- [x] **Polices auto-hébergées** (`site/fonts/`) : plus aucune requête vers un tiers.
- [x] **Couleurs en jetons** (24/11/2026) : plus aucune couleur en dur dans `style.css`, gardé par `tests/unit/couleurs.mjs`.
- [ ] **Swipe entre onglets** : `onglets.spec.mjs` (« aux deux bouts du groupe ») échoue en local sur Chromium du conteneur, aussi avant le lot du 24/11 ; à éclaircir si la CI le voit.
- [x] **Garde-fou du scraper** : `update-prices.yml` lance `check_prices.py` avant d'ouvrir
  la PR (qui passe en brouillon si le contrôle échoue). Une PR ouverte avec le
  `GITHUB_TOKEN` par défaut ne déclenche pas `checks.yml`.
- [x] **Relevé multi-sites, deux fois par mois** : le moins cher de toutes les offres valides (validées par
  le nom du produit), totaux / récap / historique recalculés, bilan affiché sur le site. Voir le
  README. `scraper/sources.json` couvre 26 articles ; restent sans source : OS, outils de
  montage, support MSI Pulse 17.
- [x] **Prix cible** (16/11/2026) : champ facultatif `target_price` d'un article de
  `data/prices.json` ; le rapport de chaque relevé dit l'écart, et « cible atteinte » quand un
  prix **vérifié** passe dessous. Seul le GPU en a un (le plafond de 1 479 € de la veille GPU) :
  ajoute les tiens à la main dans `prices.json`.
- [x] **Actions épinglées par SHA** + Dependabot mensuel (`.github/dependabot.yml`).
- [x] ~~**PWA installable et hors ligne**~~ : abandonnée (16/11/2026, choix d'Antoni). Le site
  se consulte en ligne ; l'installer n'apporterait rien avant l'achat.
- [x] **Export / import des cases du workflow** (16/11/2026) : les cases cochées voyagent dans
  le fichier « Exporter » de Réglages, avec les changements. À l'import elles s'ajoutent à
  celles de l'appareil sans jamais en décocher ; un fichier d'avant reste valable.
- [ ] **PDF générés depuis le site** (`npm run build:pdf`) : à faire. Les PDF actuels sont
  dessinés à la main et divergent des données.
- [ ] **Synchro entre appareils (Worker Cloudflare)** : en suspens. L'export / import
  couvre le besoin de sauvegarde ; ne l'engager que si deux appareils doivent vraiment
  rester synchronisés. Plan d'origine : Worker dédié `pc-full-white-sync`, code de synchro
  de 26 caractères dont seule l'empreinte SHA-256 sert de clé KV, refus d'écrasement
  horodaté, déploiement par GitHub Actions.

## Optionnel

- [ ] `LICENSE` : à décider. Un repo public sans licence est « tous droits réservés » par défaut. Reprendre la même que les autres repos publics (ex. gta6-backend, game-library) si on veut en mettre une.

## Décisions prises

Dans `JOURNAL.md`, avec leur date.
