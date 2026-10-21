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

## Améliorations du site

Dernière mise à jour de cette section : 21/10/2026.

- [x] **Mode sombre** : fait (suit le système, bouton auto / clair / sombre). Les tokens
  couleur portent leurs deux valeurs via `light-dark()`.
- [x] **Accessibilité** (clavier, contrastes, cibles de 48 px) et **système Material 3** :
  faits, voir `SPEC.md`.
- [x] **Parité avec les PDF** : donut, avancement, récap des achats, historique détaillé.
- [x] **Polices auto-hébergées** (`site/fonts/`) : plus aucune requête vers un tiers.
- [x] **Garde-fou du scraper** : `update-prices.yml` lance `check_prices.py` avant d'ouvrir
  la PR (qui passe en brouillon si le contrôle échoue). Une PR ouverte avec le
  `GITHUB_TOKEN` par défaut ne déclenche pas `checks.yml`.
- [x] **Relevé multi-sites, deux fois par mois** : le moins cher d'un groupe de revendeurs concordants validés par
  le nom du produit, totaux / récap / historique recalculés, bilan affiché sur le site. Voir le
  README. Reste à faire : lancer la **découverte** depuis l'onglet Actions pour remplir
  `scraper/sources.json` (il n'y a de sources que pour CPU, carte mère et IKEA au départ).
- [x] **Actions épinglées par SHA** + Dependabot mensuel (`.github/dependabot.yml`).
- [ ] **PWA installable et hors ligne** (manifest, service worker en réseau d'abord,
  icônes) : en cours. Piège connu : le `scope` du sous-dossier GitHub Pages.
- [ ] **Export / import des cases du workflow** : en cours. Couvre la perte du stockage
  local sans passer par un serveur.
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
