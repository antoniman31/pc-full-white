"""Répercute des changements de prix sur tout ce qui en dépend dans prices.json.

Le scraper ne doit jamais produire un fichier incohérent : un prix modifié change les
totaux, le récapitulatif des achats, l'historique et les séries par composant. Tout est
recalculé ici, avec les mêmes formules que scripts/check_prices.py (qui sert de juge).
"""

from datetime import date, timedelta

ITEM_SECTIONS = ("pc_components", "screens", "peripherals", "mobilier", "outils_bureau")
HISTORY_COLUMNS = 8          # « Réf. » + les 7 relevés les plus récents


def find_item(data: dict, item_id: str) -> dict | None:
    for section in ITEM_SECTIONS:
        for item in data.get(section, []):
            if item.get("id") == item_id:
                return item
    return None


def _num(x: float):
    """Entier quand c'est un entier (le fichier garde 444, pas 444.0)."""
    x = round(float(x), 2)
    return int(x) if x == int(x) else x


def _total(items, status=None) -> float:
    return sum((i.get("price") or 0) for i in items if status is None or i.get("status") == status)


def apply_updates(data: dict, updates: dict[str, float]) -> dict[str, tuple[float, float]]:
    """Écrit les nouveaux prix, recalcule les totaux. Renvoie {id: (ancien, nouveau)}."""
    applied: dict[str, tuple[float, float]] = {}
    pc_delta = 0.0
    for item_id, new in updates.items():
        item = find_item(data, item_id)
        if item is None:
            raise KeyError(f"article inconnu : {item_id}")
        old = item.get("price") or 0
        item["price"] = _num(new)
        applied[item_id] = (old, item["price"])
        if any(item is c for c in data["pc_components"]) and item.get("status") == "to_buy":
            pc_delta += item["price"] - old

    b, meta = data["budget_summary"], data["meta"]
    # pc_total est un total relevé, légèrement différent de la somme des lignes (arrondies
    # à l'euro) : on lui ajoute l'écart plutôt que de le remplacer, pour ne pas faire
    # bouger d'un coup tous les montants affichés.
    b["pc_total"] = round(b["pc_total"] + pc_delta, 2)
    periph_restant = _total(data["screens"], "to_buy") + _total(data["peripherals"], "to_buy")
    b["periph_2027_remaining"] = round(b["pc_total"] + periph_restant, 2)
    b["mobilier_2026_total"] = round(_total(data["mobilier"]) + _total(data["outils_bureau"]), 2)
    b["remaining_to_buy"] = round(b["pc_total"] + periph_restant + b["mobilier_2026_total"], 2)
    b["total_complete"] = round(b["remaining_to_buy"] + b["already_bought"], 2)
    b["margin_vs_prime"] = round(meta["prime_limit"] - b["remaining_to_buy"], 2)
    b["pc_margin"] = round(meta["pc_limit"] - b["pc_total"], 2)

    for row in data.get("purchase_recap", []):
        refs = row.get("refs")
        if not refs:
            continue
        total = 0.0
        for ref in refs:
            if ref == "pc_total":
                total += b["pc_total"]
            elif ref == "outils_bureau":
                total += _total(data["outils_bureau"])
            else:
                total += (find_item(data, ref) or {}).get("price") or 0
        row["price"] = _num(total)
    return applied


def record_history(data: dict, today: date) -> None:
    """Ajoute (ou remplace, si relancé le même jour) le relevé du jour dans l'historique."""
    b = data["budget_summary"]
    label = f"{today.day:02d}/{today.month:02d}"
    entry = {"date": today.isoformat(), "label": label,
             "pc_total": round(b["pc_total"]), "budget_total": round(b["total_complete"])}
    hist = data["price_history"]
    if hist and hist[-1]["date"] == today.isoformat():
        hist[-1] = entry
    else:
        hist.append(entry)

    dates = data.get("price_history_dates")
    if dates is None:
        return
    same_day = dates[-1] == label
    if not same_day:
        dates.append(label)
    for comp in data.get("price_history_components", []):
        refs = comp.get("refs")
        if not refs or "series" not in comp:
            continue
        current = _num(sum((find_item(data, r) or {}).get("price") or 0 for r in refs))
        if same_day:
            comp["series"][-1] = current
        else:
            comp["series"].append(current)
        comp["current"] = current
        comp["evolution"] = _num(current - comp["ref"])
        comp["trend"] = "up" if comp["evolution"] > 0.5 else ("down" if comp["evolution"] < -0.5 else "stable")
    totals = data.get("price_history_total_series")
    if totals is not None:
        if same_day:
            totals[-1] = round(b["pc_total"])
        else:
            totals.append(round(b["pc_total"]))
    while len(dates) > HISTORY_COLUMNS:       # on garde « Réf. » et on retire le plus ancien relevé
        dates.pop(1)
        for comp in data.get("price_history_components", []):
            if "series" in comp and len(comp["series"]) > HISTORY_COLUMNS:
                comp["series"].pop(1)
        if totals is not None and len(totals) > HISTORY_COLUMNS:
            totals.pop(1)


def next_run_date(today: date) -> date:
    """Prochain passage prévu : le 1er ou le 15 du mois (cron `0 7 1,15 * *`)."""
    if today.day < 15:
        return date(today.year, today.month, 15)
    return date(today.year + (today.month == 12), today.month % 12 + 1, 1)


def stamp(data: dict, today: date, tracked: int, verified: int, updated: int,
          mark_verified: bool) -> None:
    meta = data["meta"]
    meta["last_run"] = {"date": today.isoformat(), "tracked": tracked,
                        "verified": verified, "updated": updated}
    meta["next_verification"] = next_run_date(today).isoformat()
    if mark_verified:
        meta["last_verified"] = today.isoformat()


OFFER_KEEP_DAYS = 60         # un lien vu il y a plus longtemps, et qu'on ne relit plus, disparaît
RETRY_LATER = ("bloque", "reseau", "erreur_http", "robots")   # panne possible : on garde le lien un temps


def record_offers(item: dict, used: list, results: list, today: date, labels: dict[str, str]) -> None:
    """Liens d'achat de l'article : une entrée par fiche qui a servi au prix retenu.

    Une fiche qui répond « introuvable », ou dont le produit ne correspond plus, est retirée ;
    une fiche momentanément injoignable garde son ancien lien pendant OFFER_KEEP_DAYS."""
    fresh = {r.url: {"retailer": labels.get(r.retailer, r.retailer), "url": r.url,
                     "price": _num(r.value), "seen": today.isoformat()} for r in used}
    status = {r.url: r.status for r in results}
    limit = (today - timedelta(days=OFFER_KEEP_DAYS)).isoformat()
    for old in item.get("offers", []):
        if old["url"] not in fresh and status.get(old["url"]) in RETRY_LATER and old["seen"] >= limit:
            fresh[old["url"]] = old
    offers = sorted(fresh.values(), key=lambda o: o["price"])
    if offers:
        item["offers"] = offers
    else:
        item.pop("offers", None)
