#!/usr/bin/env python3
"""Applique data/changes.json (achats, prix, produits, ajouts, suppressions saisis sur le site) à data/prices.json.

    python3 scripts/apply_changes.py [--data data/prices.json] [--changes data/changes.json]

Les entrées décrivent un état : relancer le script ne change rien de plus. Le fichier produit passe
scripts/check_prices.py (totaux, récapitulatif et dernière ligne d'historique recalculés).
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scraper"))

from changes import apply_changes, load_changes  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default=str(ROOT / "data" / "prices.json"))
    ap.add_argument("--changes", default=str(ROOT / "data" / "changes.json"))
    args = ap.parse_args(argv)

    data_path = Path(args.data)
    raw = data_path.read_text(encoding="utf-8")
    lead = "\n" if raw.startswith("\n") else ""
    data = json.loads(raw)
    try:
        log = apply_changes(data, load_changes(Path(args.changes)))
    except ValueError as e:
        print(f"ERREUR : {e}")
        return 1
    new = lead + json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if new == raw:
        print("Rien à changer : prices.json contient déjà ces changements.")
        return 0
    data_path.write_text(new, encoding="utf-8")
    for line in log:
        print(f"- {line}")
    print(f"{data_path} mis à jour.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
