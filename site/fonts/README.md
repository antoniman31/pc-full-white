# Polices auto-hébergées

Trois polices variables, sous-ensemble « latin » (accents français, €, ponctuation),
au format WOFF2. Elles remplacent l'appel à `fonts.googleapis.com` : plus de requête
vers un tiers, préchargement possible, et disponibles hors ligne une fois en cache.

| Fichier | Police | Graisses | Source |
|---|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter | 100–900 | `@fontsource-variable/inter` 5.3.0 |
| `space-grotesk-latin-wght-normal.woff2` | Space Grotesk | 300–700 | `@fontsource-variable/space-grotesk` 5.3.0 |
| `jetbrains-mono-latin-wght-normal.woff2` | JetBrains Mono | 100–800 | `@fontsource-variable/jetbrains-mono` 5.3.0 |

Licence : SIL Open Font License 1.1 pour les trois (textes dans `LICENSE-*.txt`).

Pour mettre à jour : installer le paquet `@fontsource-variable/<police>` dans un dossier
temporaire et copier `files/<police>-latin-wght-normal.woff2`. Les caractères hors
sous-ensemble (par exemple `→`) retombent sur la police du système, comme avec Google.
