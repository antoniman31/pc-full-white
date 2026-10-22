# Spec : refonte accessibilité et Material 3 du site PC Full White

> Statut : **en attente de validation**. Aucune ligne de `site/` n'est modifiée avant approbation de cette spec.
> Rédigée selon `.claude/skills/spec-driven-development/SKILL.md`.

## Objectif

Rendre le site de suivi utilisable au clavier et au doigt, corriger les contrastes
sous les seuils d'accessibilité, et aligner le système visuel sur Material 3 sans
perdre l'identité AM31 (blanc dominant, bleu signature, Space Grotesk / Inter /
JetBrains Mono).

Deux parcours d'usage doivent tenir simultanément, ce qui est le cas le plus
exigeant :

- **mobile, pendant le montage** — téléphone en main, debout, une main parfois
  occupée. Cocher la bonne ligne du premier coup est fonctionnel, pas cosmétique ;
- **desktop, en préparation** — souris et clavier, enchaînement rapide des cases
  au clavier.

Lecteur unique du site : son auteur. Le périmètre couvre néanmoins la sémantique
complète (landmarks, ARIA, thème sombre) sur décision explicite de l'auteur, après
que l'inutilité de cette partie pour un lecteur unique a été soulevée et écartée.

## Hypothèses

À corriger avant approbation si l'une est fausse :

1. Le site reste une page statique sans build, sans framework, sans gestionnaire
   de paquets. Aucune dépendance npm n'est introduite.
2. La durée de vie du projet est courte (jusqu'au montage du PC). Aucune
   architecture n'est mise en place pour durer au-delà.
3. `data/prices.json` reste écrit à la main par l'auteur et par le scraper, jamais
   par une source tierce arbitraire.
4. Les cibles de navigateurs sont les versions courantes de Chrome, Firefox et
   Safari, desktop et mobile. Aucun support IE ou navigateur legacy.
5. Les PDF de `docs/` ne sont pas régénérés et restent la référence imprimable.

## Stack

Aucun changement : HTML statique, CSS avec variables natives, JavaScript sans
dépendance (`site/index.html`, `site/style.css`, `site/app.js`). Données en JSON
statique. Polices via Google Fonts. Contrôles en Python 3.12 (`scripts/`,
`scraper/`).

## Commandes

```
# Servir le site en local
python3 -m http.server 8000 --directory site

# Contrôles (identiques à la CI .github/workflows/checks.yml)
python3 scripts/check_prices.py data/prices.json
node --check site/app.js

# Scraper, sans écriture
python3 scraper/update_prices.py --dry-run
```

## Structure du projet

Inchangée. Les fichiers touchés par cette spec :

```
site/index.html    → structure, landmarks, rôles ARIA, skip-link
site/style.css     → tokens, échelle typographique, state layers, thème sombre
site/app.js        → sémantique des composants générés, gestion clavier, échappement
SPEC.md            → ce document
```

Aucun fichier ajouté, aucun fichier déplacé.

## Style de code

Le code existant est cohérent et sert de référence. Les conventions observées sont
conservées : commentaires de section en bandeau, variables CSS sous `:root`,
fonctions de rendu `renderX()` par panneau, gabarits littéraux pour le HTML généré.

Exemple du style attendu pour un composant rendu, ici une case à cocher accessible
en remplacement du `<div class="check-row">` actuel :

```js
function checkRowHTML(itemKey, label, checked) {
  return `
    <button type="button" role="checkbox" class="check-row" data-key="${itemKey}"
            aria-checked="${checked}">
      <span class="check-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4"
          stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </span>
      <span class="check-text">${escapeHTML(label)}</span>
    </button>`;
}
```

Points de style imposés :

- un élément interactif est un `<button>` ou un `<a>`, jamais un `<div>` muni d'un
  gestionnaire de clic ;
- toute donnée issue de `prices.json` injectée en HTML passe par `escapeHTML()` ;
- aucune taille en pixels fractionnaires ni valeur hors échelle ;
- les icônes décoratives, emojis compris, portent `aria-hidden="true"`.

## Lot 1 — Accessibilité (complet)

### 1.1 Navigation au clavier

| Composant | État actuel | Cible |
|---|---|---|
| Cases checklist | `<div>` + listener `click` | `<button role="checkbox">` + `aria-checked`, Espace et Entrée |
| Phases dépliables | `<div class="phase-card">` + listener | `<button aria-expanded>` sur l'en-tête, contenu en région associée |
| Onglets | `<button>` sans rôle | `role="tablist"` / `tab` / `tabpanel`, `aria-selected`, `aria-controls`, flèches gauche/droite, Home/End |
| Barre de progression | `<div class="bar-track">` | `role="progressbar"` + `aria-valuenow` / `aria-valuemin` / `aria-valuemax` / `aria-valuetext` |

Au changement d'onglet, le focus se déplace sur le panneau activé. Le `:focus-visible`
global existant (2,5px, `--am31-blue`) devient effectif puisque les éléments
deviennent focusables ; son contraste contre les deux thèmes est vérifié.

### 1.2 Contrastes

Seuils : 4,5:1 pour le texte courant, 3:1 pour les éléments non textuels (réf. doc
accessibilité Android).

> **Correction apportée pendant l'implémentation.** La première version de ce
> tableau calculait les ratios contre du **blanc pur**, alors que `body` a pour
> fond `--paper-off` (#f7f9fc). Les valeurs annoncées étaient donc optimistes, et
> deux des propositions échouaient de peu une fois mesurées par axe-core : `#6b7488`
> tombait à 4,44:1 et `#2f6fe0` à 4,45:1. Les couleurs ci-dessous sont les valeurs
> retenues, mesurées contre `--paper-off`, qui est le pire cas de la page.

| Usage | Couleur d'origine | Ratio | Retenu | Ratio obtenu |
|---|---|---|---|---|
| Texte secondaire | `--ink-faint` `#8b93a7` | **3,08:1** | `#636b7f` | 5,05:1 |
| Onglet actif, texte blanc | `--am31-blue` `#5493FF` | **3,01:1** | fond `--am31-blue-dark` `#2a62c9` | 5,69:1 |
| Pastille « acheté » | `#1fa971` sur `#e7f8f0` | **2,74:1** | `#0f6b47` (déjà présent dans `.phase-result`) | 5,93:1 |
| Pastille « à acheter » | `#2f6fe0` sur `#eaf1ff` | **4,14:1** | `#2a62c9` | 5,02:1 |
| Tag risque moyen | `--warn-amber` `#d98a1f` sur `#fdf3e3` | **2,51:1** | `#8a5209` | 5,79:1 |
| Tag risque élevé | `--risk-red` `#d64545` sur `#fce9e9` | **3,74:1** | `#b02525` | 5,72:1 |

La pastille « à acheter » ne figurait pas dans l'audit initial : c'est axe-core qui
l'a signalée, sur les quinze lignes de l'onglet PC.

`--am31-blue` reste inchangé pour les usages non textuels : remplissage de la barre
de progression, `brand-dot`, puces `::before`, bordures. Seuls les usages portant du
texte basculent sur la variante foncée. Le bleu signature reste donc visible là où
il compte.

### 1.3 Cibles tactiles

Minimum 48×48 px pour tout élément interactif, y compris quand la zone cliquable
dépasse le visuel.

| Élément | Hauteur actuelle | Moyen |
|---|---|---|
| `.tab` | ~33 px | padding vertical porté à 14px, `min-height: 48px` |
| `.check-row` | ~40 px | `min-height: 48px`, zone cliquable pleine largeur |
| `.check-box` | 19 px | visuel conservé, zone étendue par le bouton parent |
| `#print-btn` | ~15 px | `min-height: 48px`, padding horizontal |

Le visuel compact de la checklist est préservé : c'est la zone tactile qui grandit,
pas le dessin de la case.

### 1.4 Structure et sémantique

- `<main>` autour de `.shell`, `<nav>` déjà correct, `<footer>` déjà correct ;
- skip-link en première position, visible au focus uniquement ;
- `aria-hidden="true"` sur les emojis décoratifs des titres (`💰`, `⚠️`, `🖥️`…),
  qui sont aujourd'hui vocalisés (« sac d'argent Règles de suivi budget ») ;
- tableaux `.data-table` enveloppés dans un conteneur `overflow-x: auto` avec
  `role="region"`, `aria-label` et `tabindex="0"` pour le défilement au clavier ;
- `escapeHTML()` appliqué à toutes les injections depuis `prices.json`.

### 1.5 Historique de navigation

`history.replaceState` devient `pushState` dans `wireTabs()`, avec un écouteur
`popstate`, pour que le bouton Retour revienne à l'onglet précédent.

## Lot 2 — Material 3

### 2.1 Échelle typographique

Les onze tailles actuelles (42, 22, 17, 15, 14.5, 14, 13.5, 13, 12.5, 11.5, 10.5 px)
sont remplacées par les rôles Material 3, exposés en tokens. Le 10,5px actuel viole
par ailleurs le minimum Android de 12sp pour le texte courant.

| Rôle | Taille | Usage dans le site |
|---|---|---|
| Display Medium | clamp(32px, 5vw, 45px) | `.progress-amount` (le montant restant, chiffre clé de la page) |
| Display Small | clamp(28px, 4.4vw, 36px) | `.hero-title` |
| Headline Small | 24px | `.progress-amount .goal` et `.sep` (la limite, à côté du montant) |
| Title Large | 22px | `.section-title`, `.progress-stat .v` (16px en largeur compacte) |
| Title Medium | 16px | `.phase-title`, `.brand`, `.split-item .amount` |
| Title Small | 14px | `.crit-banner-title` |
| Body Large | 16px | `.hero-sub` |
| Body Medium | 14px | corps, `.item-name`, `.check-text` |
| Body Small | 12px | `.section-note`, `.item-model` |
| Label Large | 14px | `.tab` |
| Label Medium | 12px | `.progress-stat .l`, en-têtes de tableau |
| Label Small | 11px | `.status-pill`, `.phase-meta` |

> **Écarts constatés à l'implémentation.** Le tableau ci-dessus est la version
> livrée. Il diffère de la première rédaction sur un point : `.progress-amount`
> était rangé en Headline Small (24px), ce qui aurait réduit de moitié le chiffre
> clé de la page. Il passe en Display Medium, et c'est la limite qui prend le
> Headline Small. Les ratios sont aussi exposés sous forme de tokens
> (`--type-*`) ; un test lit `style.css` et échoue si une `font-size` n'en
> utilise pas.

### 2.2 State layers

Les survols ad hoc (`background: var(--paper-off)` sur `.tab:hover`, `.item-row:hover`,
`.check-row:hover`) sont remplacés par des couches d'état cohérentes : opacité 8%
au survol, 10% au focus, 12% à l'appui.

Deux écarts à la première rédaction. La teinte de la couche est le bleu
`--am31-blue-dark` et non la couleur de contenu : une couche noire à 8 % fait tomber
le texte grisé d'une case cochée à 4,47:1, sous le seuil. Et les lignes de liste
qui ne se cliquent pas (`.item-row`) **perdent** leur survol : il laissait croire
qu'elles étaient interactives, et M3 réserve les couches d'état aux éléments
interactifs.

### 2.3 Breakpoints

Les ruptures actuelles (640px, 760px) migrent vers les window size classes : **600px**
(compact → medium) et **840px** (medium → expanded). `.grid-2` et `.grid-3` passent en
une colonne sous 600px, deux colonnes entre 600 et 840, grille pleine au-delà.

### 2.4 Formes et élévation

`--radius-sm/md/lg` (8/14/22px) sont réassignés par rôle plutôt qu'au cas par cas :
`extra-small` 4px pour les pastilles, `small` 8px pour les groupes, `medium` 12px
pour les cartes, `large` 16px pour la carte de progression. Les deux ombres
actuelles sont ramenées à deux niveaux d'élévation nommés.

## Lot 3 — Thème sombre et préférences

Un sélecteur manuel à trois états (auto / clair / sombre), persisté en
`localStorage`, par-dessus la préférence système. Les contrastes du tableau 1.2 sont
recalculés et vérifiés sur le thème sombre, où les couleurs de texte s'éclaircissent
au lieu de s'assombrir.

**Écart à la première rédaction : `light-dark()` au lieu de deux blocs de tokens.**
La spec prévoyait de dupliquer tous les tokens sous `@media (prefers-color-scheme:
dark)` et sous `[data-theme="dark"]`, soit deux copies de la palette à garder
synchronisées. Chaque token s'écrit maintenant `light-dark(clair, sombre)` et le
choix vient de `color-scheme` (`light dark` par défaut, forcé par `data-theme`).
Une seule palette, et `color-scheme` dessine aussi les barres de défilement et les
contrôles natifs dans le bon thème. Coût : `light-dark()` exige un navigateur de
2024 ou plus récent, ce que l'hypothèse 4 de cette spec admettait déjà.

**Le bouton est un bouton unique qui tourne** (auto → clair → sombre) plutôt que trois
boutons : trois cibles de 48px auraient pris 144px dans une barre déjà dense en
largeur compacte. Son état est annoncé par `aria-label` et par une région
`role="status"`. Les icônes sont en SVG : les glyphes Unicode ◐ ☀ ☾ dépendent de la
police de repli et s'affichaient en demi-cercle minuscule.

Un petit script en tête de `<head>` pose `data-theme` avant le premier rendu : sans
lui, un thème choisi clignoterait en clair le temps que `app.js` se charge.
L'impression repasse toujours en clair.

**Teintes sombres retenues** (ratios mesurés contre `--paper-off` sombre `#0f1420` et
contre les cartes `#171d2b`, puis confirmés par axe-core sur les sept onglets) :

| Token | Clair | Sombre |
|---|---|---|
| `--ink-faint` | `#636b7f` | `#98a1b5` (6,5:1) |
| `--am31-blue-dark` | `#2a62c9` | `#8db8ff` (7,2:1) |
| `--ok-green` | `#0f6b47` | `#5fd6a2` |
| `--warn-amber` | `#8a5209` | `#f0b45a` |
| `--risk-red` | `#b02525` | `#ff8a8a` |

`--am31-blue-dark` sert à la fois de couleur de texte et de fond des éléments actifs :
en sombre le fond est un bleu pâle, donc le texte posé dessus passe par un nouveau
token `--on-accent` (blanc en clair, `#0f1420` en sombre).

### 3.1 Défaut de mise en page trouvé en route

Le bouton de thème a fait passer sous le seuil un défaut préexistant : la pastille
« Prix relevés… » (~370px, `flex-shrink: 0`) comprimait la liste d'onglets à moins de
150px entre 600 et 840px, et à 1024px elle les rognait déjà. Les onglets ont
maintenant une base égale à leur contenu ; la pastille seule se rétrécit (points de
suspension) et disparaît sous 1200px, où elle ne tient pas à côté de sept onglets.
**1200px est donc un troisième point de rupture** (classe Large de Material 3), ajouté
à 600 et 840. À 1280px la pastille reste tronquée (« …21 oc… ») : la date complète
figure aussi dans le pied de page et la note de l'historique.

Le radial-gradient de `.progress-card::before` et le `backdrop-filter` de `.topnav`
sont ajustés pour le fond sombre.

## Stratégie de vérification

Pas de framework de test dans le projet, et la spec n'en introduit pas. La
vérification est donc explicite.

**Automatisé (CI existante, inchangée)**

- `node --check site/app.js` — syntaxe ;
- `python3 scripts/check_prices.py data/prices.json` — cohérence des données.

**Manuel, à faire avant de déclarer le travail terminé**

1. Parcours clavier complet : Tab depuis le haut de la page jusqu'au footer, sans
   piège de focus, chaque élément interactif atteignable et actionnable ;
2. cocher et décocher trois cases de la checklist au clavier seul, recharger la
   page, vérifier la persistance ;
3. déplier et replier deux phases au clavier seul ;
4. parcourir les sept onglets aux flèches, vérifier `aria-selected` et le
   déplacement du focus ;
5. rendu à 320, 360, 600, 768, 840, 1024 et 1440 px de large, sans débordement
   horizontal ;
6. contrastes des cinq paires du tableau 1.2 mesurés sur le rendu réel, thème clair
   et thème sombre ;
7. `prefers-reduced-motion` toujours respecté après ajout des state layers ;
8. aperçu avant impression intact (la règle `@media print` existante ne doit pas
   régresser).

Le point 6 est mesuré, pas estimé : les ratios de cette spec sont calculés sur les
valeurs de tokens, ils doivent être confirmés sur le rendu.

## Limites

**Toujours**

- exécuter les deux contrôles CI avant chaque commit ;
- conserver l'identité visuelle : blanc dominant, bleu AM31 en accent, trio de polices ;
- préserver le comportement de `localStorage` pour la checklist, clés incluses, pour
  ne pas perdre un cochage en cours.

**Demander d'abord**

- toute dépendance npm ou outil de build ;
- toute modification de `data/prices.json`, `scraper/` ou `scripts/` ;
- tout changement du contenu rédactionnel ou de la structure des onglets ;
- tout ajout d'une étape à la CI.

**Jamais**

- changer le trio de polices ou passer sur Roboto ;
- introduire Material Web Components (en maintenance réduite chez Google) ;
- supprimer ou neutraliser un contrôle existant pour obtenir une CI verte ;
- régénérer les PDF de `docs/`.

## Critères de succès

1. Les huit vérifications manuelles ci-dessus passent.
2. Les cinq paires de couleurs du tableau 1.2 atteignent au moins 4,5:1 en thème
   clair et en thème sombre.
3. Tout élément interactif mesure au moins 48×48 px.
4. Aucun `<div>` ni `<span>` ne porte de gestionnaire de clic dans `site/app.js`.
5. Aucune taille de police fractionnaire ni inférieure à 11px dans `site/style.css`,
   et aucune sous 12px pour du texte courant.
6. La checklist se coche intégralement au clavier seul, et intégralement au doigt
   sur un écran de 360px de large.
7. Le bouton Retour du navigateur revient à l'onglet précédent.
8. La CI reste verte.
9. Aucune régression de l'impression ni de la persistance `localStorage`.

## Décisions

Les trois questions laissées ouvertes dans la première version de ce document ont
été tranchées par l'auteur :

1. **Contrôle d'accessibilité en CI : oui**, contre la recommandation initiale.
   Un job `accessibilite` exécute axe-core via Playwright sur les sept onglets,
   plus les contrôles qu'axe ne couvre pas : cibles de 48px mesurées sur le rendu,
   parcours clavier de la checklist et des onglets, retour arrière du navigateur.
   Cela introduit `package.json`, un lockfile et `node_modules` dans un dépôt qui
   n'avait aucune dépendance — coût accepté en connaissance de cause. Les tests
   sont en `.mjs` pour ne pas ajouter `"type": "module"` au `package.json`, ce qui
   changerait la façon dont `node --check site/app.js` interprète le fichier du site.
2. **Sélecteur de thème : bouton à trois états** (auto / clair / sombre), persisté
   en `localStorage`, dans la barre supérieure. Il devra lui aussi respecter la
   cible de 48px, sur une barre déjà dense en largeur compacte.
3. **Découpage : trois livraisons.** La présente spec et le lot 1 arrivent ensemble,
   puis le lot 2, puis le lot 3, chacun dans sa propre pull request.

## Commandes ajoutées par la décision 1

```
npm ci                              # installation des dépendances de test
npx playwright install chromium     # navigateur (une seule fois)
npx playwright test                 # contrôles d'accessibilité
```

Le serveur de test sert **la racine du dépôt**, pas `site/` : `app.js` lit
`../data/prices.json`, qui est hors de `site/`. C'est aussi ainsi que GitHub Pages
sert le projet, via la redirection de `index.html` à la racine.

## Lot 4 — Parité de contenu avec les PDF

Demandé après livraison des trois premiers lots : « les PDF affichent plus d'infos
que le site (le donut et d'autres informations) ». Les trois PDF (`LITE`,
`WORKFLOW`, `Sauvegarde`) ont été lus en entier et comparés aux données et au rendu
du site. `WORKFLOW` était déjà couvert (les 102 cases des six phases) ; le manque
venait de `Sauvegarde` et de `LITE`.

**Ajouté, sur choix explicite de l'auteur :** le donut de répartition avec la part
hachurée « dont 421 € déjà payés » ; la barre d'avancement (déjà dépensé sur le
total, à ne pas confondre avec la barre du haut qui mesure le reste à acheter par
rapport à la limite) ; les cartes 2026 / 2027 et la marge PC seul ; l'ordre d'achat
en 5 étapes ; le récapitulatif des achats avec les leviers du 21/10 ; l'historique
détaillé par date et par composant ; les notes de vérification ; les caractéristiques
du casque, des enceintes, du Hagibis et du bras ; les avertissements stockage et
airflow ; les pièges courants, le dépannage (BSOD, Sonar), l'achat groupé et la fin
de montage.

**Trois champs étaient déjà dans `prices.json` sans jamais s'afficher** :
`pc_margin`, `periph_2027_remaining` et `gpu_watch`.

**Contradictions entre le site et les PDF, corrigées :**

- Le 990 PRO s'affichait à **4 To** sur le site alors que le modèle retenu est le
  2 To. Le titre « ~11 To » était faux partout (2 + 5 + 2 = 9 To) ; il est
  maintenant calculé depuis les capacités du tableau.
- Les totaux PC de l'historique d'avant le 21/10 dépassaient ceux du PDF de 85 €
  exactement, soit le stand GPU retiré ce jour-là. Le site comparait un ancien
  total avec stand à un nouveau sans, d'où « +217 € » au lieu de **+302 €**. L'auteur
  a désigné le PDF comme référence ; les totaux du site sont alignés dessus.
  **Les `budget_total` d'avant le 21/10 n'ont pas été touchés** : le PDF n'en donne
  pas, et ils incluent probablement le même stand de 85 €. À vérifier.
- La règle « déjà acheté » omettait le casque et la rallonge ; le point critique SSD
  disait « PCIe 5.0 » pour un SSD PCIe 4.0 dans un slot 5.0.

**Contrôle ajouté à `check_prices.py`** : le récap des achats doit totaliser
`remaining_to_buy`, et chaque série de l'historique détaillé doit avoir une valeur
par date et se terminer sur le prix actuel.

Un défaut préexistant du graphique est aussi corrigé au passage : les étiquettes de
date des deux extrémités étaient rognées.

## Lot 7 — Material 3 : navigation, typographie, sombre noir pur

**Navigation.** Neuf onglets ne respectaient pas les consignes M3 (4 onglets au plus, barre de
navigation de 5 destinations au plus). Cinq destinations (barre du bas sous 600 px, rail
latéral dès 600 px) ; Matériel et Suivi portent chacun trois sous-onglets. Les identifiants
`#pc`, `#risques`… et le tablist restent ; une destination rouvre le dernier sous-onglet vu et
pousse une entrée d'historique (le bouton Retour la défait).

**Typographie** en rem (elle suit la taille de texte d'Android), minimum 12 px ; plus aucune
taille en ligne. Test à 200 % : pas de défilement horizontal.

**Rôles de surface** M3 (`--surface`, `--surface-dim`, `--on-surface`, `--on-surface-variant`,
`--on-surface-faint`, `--outline-variant`, `--primary`, `--primary-container`) utilisés par
toutes les règles ; les anciens noms n'existent plus que dans leur définition.

**Message d'annulation** persistant (inaccessible s'il disparaît seul), masqué à la prochaine
action pour ne pas restaurer un état périmé.

**Thème sombre = noir pur** (écran OLED) : l'ancien sombre bleuté est supprimé. `--paper` et `--paper-off`
valent `#000`, `--paper-line` est relevé pour que les cartes restent lisibles sans ombre, les teintes
pâles de statut sont assombries, ombres et halo de la carte de progression sont retirés. En Auto, un
système sombre donne ce noir. Un ancien choix « oled » enregistré est lu comme « sombre ».
Cycle du bouton : auto → clair → sombre. Axe-core sur les neuf écrans en sombre.

**Pictogrammes.** Plus aucun emoji ni symbole de texte (▲ ▼ ▸ ● ✓ ✅ ↗) dans l'interface : un seul jeu,
Material Symbols (Apache 2.0), dans le sprite de `index.html`. Les données gardent leurs emojis ;
`EMOJI_ICON` (app.js) les traduit à l'affichage, une boîte générique remplace un emoji inconnu, et un
test échoue si un emoji de `prices.json` n'a pas de pictogramme. Chevrons et coches de pseudo-éléments
CSS utilisent des masques (`--m-chev`, `--m-check`).

