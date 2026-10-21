#!/usr/bin/env python3
"""
Scraper mensuel de prix — Projet PC Full White

Vérifie les prix des composants qui ont une URL de référence dans
data/prices.json, compare à l'ancienne valeur, et met à jour le fichier.

Usage :
    python3 update_prices.py                 # tourne sur tous les composants avec price_source_url
    python3 update_prices.py --dry-run        # affiche ce qui changerait, sans écrire
    python3 update_prices.py --only cpu,gpu   # limite à certains IDs

Le scraping web est fragile par nature (structure de page qui change,
blocage anti-bot). Ce script échoue composant par composant plutôt que
globalement : si un prix ne peut pas être vérifié, il garde sa valeur
précédente et le script log l'échec sans planter.
"""

import json
import re
import sys
import argparse
from pathlib import Path
from datetime import date

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Dépendances manquantes. Installer avec :")
    print("  pip install requests beautifulsoup4")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
PRICES_FILE = ROOT / "data" / "prices.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
}

# idealo.fr affiche le meilleur prix dans une balise avec cette classe
# (structure au moment de l'écriture — à réajuster si idealo change son HTML)
PRICE_PATTERNS = [
    re.compile(r'"price"\s*:\s*"?([\d.,]+)"?'),          # JSON-LD ou données structurées
    re.compile(r"(\d[\d\s]*[.,]\d{2})\s*€"),              # texte brut "1 090,00 €"
]


def fetch_price(url: str) -> float | None:
    """Récupère le prix affiché sur une page produit. Renvoie None si échec."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=12)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  ⚠️  Requête échouée ({e})")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # 1. Chercher un bloc JSON-LD structuré (le plus fiable, beaucoup de sites l'ont)
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "{}")
            candidates = data if isinstance(data, list) else [data]
            for c in candidates:
                offers = c.get("offers") if isinstance(c, dict) else None
                if offers:
                    price = offers.get("price") if isinstance(offers, dict) else None
                    if price:
                        return float(str(price).replace(",", "."))
        except (json.JSONDecodeError, ValueError, AttributeError):
            continue

    # 2. Repli : chercher un motif de prix dans le texte brut de la page
    text = soup.get_text(" ", strip=True)
    for pattern in PRICE_PATTERNS:
        m = pattern.search(text)
        if m:
            raw = m.group(1).replace(" ", "").replace(",", ".")
            try:
                return float(raw)
            except ValueError:
                continue

    return None


def load_data() -> dict:
    with open(PRICES_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_data(data: dict) -> None:
    with open(PRICES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def collect_trackable_items(data: dict) -> list[dict]:
    """Renvoie tous les objets du JSON qui ont un champ price_source_url."""
    items = []
    for key in ("pc_components", "screens", "peripherals", "mobilier"):
        for item in data.get(key, []):
            if item.get("price_source_url"):
                items.append(item)
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="n'écrit rien, affiche seulement")
    parser.add_argument("--only", help="liste d'IDs séparés par des virgules, ex: cpu,gpu")
    args = parser.parse_args()

    data = load_data()
    items = collect_trackable_items(data)

    if args.only:
        wanted = set(args.only.split(","))
        items = [i for i in items if i.get("id") in wanted]

    if not items:
        print("Aucun composant avec price_source_url trouvé dans prices.json.")
        print("Ajoute le champ \"price_source_url\": \"https://...\" aux composants à suivre.")
        return

    changes = []
    for item in items:
        name = item.get("name", item.get("id", "?"))
        url = item["price_source_url"]
        print(f"→ {name}")
        new_price = fetch_price(url)

        if new_price is None:
            print("  ⚠️  Prix introuvable, on garde l'ancienne valeur")
            continue

        old_price = item.get("price")
        if old_price is not None and abs(new_price - old_price) < 0.01:
            print(f"  ✅ Stable : {old_price} €")
            continue

        print(f"  🔁 {old_price} € → {new_price} €")
        changes.append({"name": name, "old": old_price, "new": new_price})
        if not args.dry_run:
            item["price"] = round(new_price, 2)

    if not changes:
        print("\nAucun changement de prix détecté.")
        return

    print(f"\n{len(changes)} prix mis à jour :")
    for c in changes:
        print(f"  · {c['name']}: {c['old']} € → {c['new']} €")

    if args.dry_run:
        print("\n(dry-run : rien n'a été écrit)")
        return

    data["meta"]["last_verified"] = date.today().isoformat()
    save_data(data)
    print(f"\n✅ {PRICES_FILE} mis à jour.")


if __name__ == "__main__":
    main()
