// Contrôle d'accessibilité du site statique.
// Le serveur est un simple http.server Python : pas de build à attendre.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  reporter: process.env.CI ? "list" : "html",
  // Un échec d'accessibilité n'est pas un flake : pas de retry, pour ne pas
  // masquer une régression intermittente.
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8000",
    // Sans ça, axe mesure le contraste pendant la transition de couleur d'un
    // onglet et lit une teinte intermédiaire (#3f79e2 au lieu de #2a62c9).
    // Le site réduit ses durées à 0,01ms sous cette préférence, donc la mesure
    // porte sur l'état final — et ça vérifie au passage la règle
    // prefers-reduced-motion.
    reducedMotion: "reduce",
  },
  // Servi depuis la racine du dépôt, pas depuis site/ : app.js lit
  // ../data/prices.json, qui est hors de site/. C'est aussi ainsi que
  // GitHub Pages sert le projet.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "python3 -m http.server 8000",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
