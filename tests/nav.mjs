// Aide commune : atteindre un onglet par la navigation réelle (destination, puis sous-onglet).
export const GROUPE = {
  budget: "budget", pc: "materiel", periph: "materiel", mobilier: "materiel",
  achats: "achats", historique: "suivi", workflow: "suivi", risques: "suivi", reglages: "reglages",
};

export async function ouvrirOnglet(page, cible) {
  const tab = page.locator(`.tab[data-target="${cible}"]`);
  if (await tab.isVisible() && (await tab.getAttribute("aria-selected")) === "true") return;
  if (!(await tab.isVisible())) await page.locator(`.dest[data-dest="${GROUPE[cible]}"]`).click();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
}
