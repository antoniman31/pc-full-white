#!/usr/bin/env python3
"""Contrôle de cohérence de data/prices.json.

Pourquoi : les totaux du site sont écrits dans budget_summary, pas recalculés.
Une erreur de chiffre dans une ligne, ou un total oublié après un changement de
composant, ne se voit qu'à l'œil. Ce script recalcule et compare.

Sort avec le code 1 s'il trouve une erreur (c'est ce qui fait rougir le check
sur une Pull Request, y compris celles du scraper mensuel), 0 sinon.

    python scripts/check_prices.py [chemin/vers/prices.json]
"""

import json
import sys
from datetime import date
from pathlib import Path

# Écart toléré entre pc_total et la somme des lignes PC : les lignes sont
# arrondies à l'euro (ex. 279,56 -> 280) alors que le total vient des prix relevés.
TOL_ARRONDI_PC = 5.0
TOL = 0.011  # centime près
SECTIONS = ["pc_components", "screens", "peripherals", "mobilier", "outils_bureau"]
# Lignes à 0 € volontaires (matériel déjà possédé, pièces fournies).
ZERO_OK = {"hdd", "cornieres"}

erreurs: list[str] = []


def err(msg: str) -> None:
    erreurs.append(msg)


def refuse_constante(nom: str):
    raise ValueError(f"valeur JSON interdite : {nom}")


def somme(items, statut=None) -> float:
    return sum(i.get("price", 0) or 0 for i in items
               if statut is None or i.get("status") == statut)


def proche(a: float, b: float, tol: float = TOL) -> bool:
    return abs(a - b) <= tol


def main() -> int:
    chemin = Path(sys.argv[1] if len(sys.argv) > 1 else "data/prices.json")
    try:
        d = json.loads(chemin.read_text(encoding="utf-8"), parse_constant=refuse_constante)
    except Exception as e:  # JSON invalide, NaN, fichier absent
        print(f"ERREUR : {chemin} illisible : {e}")
        return 1

    meta, b = d["meta"], d["budget_summary"]

    # 1. Chaque ligne : prix numérique, positif, id unique par section.
    for sec in SECTIONS:
        vus = set()
        for i, it in enumerate(d.get(sec, [])):
            ident = it.get("id") or it.get("name") or f"#{i}"
            p = it.get("price")
            if not isinstance(p, (int, float)) or isinstance(p, bool):
                err(f"{sec}/{ident} : prix absent ou non numérique ({p!r})")
                continue
            if p < 0:
                err(f"{sec}/{ident} : prix négatif ({p})")
            if p == 0 and ident not in ZERO_OK and it.get("status") != "owned_external":
                err(f"{sec}/{ident} : prix à 0 (si voulu, l'ajouter à ZERO_OK)")
            if "id" in it:
                if it["id"] in vus:
                    err(f"{sec} : id en double « {it['id']} »")
                vus.add(it["id"])

    # 2. Recalcul des totaux.
    pc = somme(d["pc_components"], "to_buy")
    if abs(b["pc_total"] - pc) > TOL_ARRONDI_PC:
        err(f"pc_total {b['pc_total']} s'écarte de la somme des lignes PC {pc:.2f} "
            f"(tolérance {TOL_ARRONDI_PC} €)")

    bought = somme(d["peripherals"], "bought")
    if not proche(b["already_bought"], bought):
        err(f"already_bought {b['already_bought']} ≠ somme des périphériques achetés {bought:.2f}")

    periph_restant = somme(d["screens"], "to_buy") + somme(d["peripherals"], "to_buy")
    if not proche(b["periph_2027_remaining"], b["pc_total"] + periph_restant):
        err(f"periph_2027_remaining {b['periph_2027_remaining']} ≠ pc_total + périphériques restants "
            f"({b['pc_total'] + periph_restant:.2f})")

    mobilier = somme(d["mobilier"]) + somme(d["outils_bureau"])
    if not proche(b["mobilier_2026_total"], mobilier):
        err(f"mobilier_2026_total {b['mobilier_2026_total']} ≠ mobilier + outils {mobilier:.2f}")

    reste = b["pc_total"] + periph_restant + b["mobilier_2026_total"]
    if not proche(b["remaining_to_buy"], reste):
        err(f"remaining_to_buy {b['remaining_to_buy']} ≠ PC + périphériques + mobilier ({reste:.2f})")

    if not proche(b["total_complete"], b["remaining_to_buy"] + b["already_bought"]):
        err(f"total_complete {b['total_complete']} ≠ reste à acheter + déjà acheté")

    if not proche(b["margin_vs_prime"], meta["prime_limit"] - b["remaining_to_buy"]):
        err(f"margin_vs_prime {b['margin_vs_prime']} ≠ limite {meta['prime_limit']} − reste à acheter")

    if not proche(b["pc_margin"], meta["pc_limit"] - b["pc_total"]):
        err(f"pc_margin {b['pc_margin']} ≠ limite PC {meta['pc_limit']} − pc_total")

    # 3. Historique : ordre des dates, dernière ligne alignée sur le résumé.
    hist = d["price_history"]
    dates = [h["date"] for h in hist]
    if dates != sorted(dates):
        err("price_history n'est pas trié par date croissante")
    if hist:
        dernier = hist[-1]
        if abs(dernier["pc_total"] - b["pc_total"]) > 1:
            err(f"price_history[-1].pc_total {dernier['pc_total']} ≠ pc_total {b['pc_total']}")
        if abs(dernier["budget_total"] - b["total_complete"]) > 1:
            err(f"price_history[-1].budget_total {dernier['budget_total']} ≠ total_complete {b['total_complete']}")
        try:
            if date.fromisoformat(meta["last_verified"]) < date.fromisoformat(dates[-1]):
                err("meta.last_verified est antérieure à la dernière ligne d'historique")
        except ValueError:
            err(f"meta.last_verified invalide : {meta.get('last_verified')!r}")

    if erreurs:
        print(f"{len(erreurs)} erreur(s) dans {chemin} :")
        for e in erreurs:
            print(f"  - {e}")
        return 1
    print(f"OK : {chemin} cohérent (PC {pc:.2f} €, reste à acheter {b['remaining_to_buy']} €, "
          f"total {b['total_complete']} €).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
