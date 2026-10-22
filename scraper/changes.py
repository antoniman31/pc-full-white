"""Changements saisis sur le site (data/changes.json), appliqués à data/prices.json.

Le site garde dans le navigateur ce que Antoni coche, modifie, ajoute ou supprime, puis l'exporte
dans ce format. Ici, le même fichier est appliqué aux données du dépôt : les totaux, le récapitulatif
et l'historique restent cohérents, et le relevé de prix en tient compte.

Les entrées décrivent un ÉTAT, jamais une variation : les appliquer deux fois donne le même résultat.

    {
      "version": 1,
      "items": {
        "<id>": {
          "status": "bought" | "to_buy",          # acheté (avec paid, date, vendor) ou achat annulé
          "paid": 479.99, "date": "2026-10-21", "vendor": "TopAchat",
          "price": 460 | null,                    # prix saisi à la main (null : revenir au prix automatique)
          "name": "…", "model": "…",              # produit changé : l'ancien suivi de prix est abandonné
          "deleted": true                         # article supprimé
        }
      },
      "added": [ {"id": "user-…", "section": "peripherals", "name": "…", "model": "…",
                  "price": 12.5, "icon": "📦", "url": "https://…"} ]
    }
"""

import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from recompute import ITEM_SECTIONS, _num, find_item, recap_price, record_history

ADDABLE = ("pc_components", "screens", "peripherals", "mobilier", "outils_bureau")
ID_RE = re.compile(r"^[a-z0-9_-]{1,40}$", re.I)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_PRICE = 100_000


def _text(v, limit: int) -> str:
    return str(v or "").strip()[:limit]


def _price(v):
    return round(float(v), 2) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v < MAX_PRICE else None


def clean_changes(raw) -> dict:
    """Valide et normalise le fichier ; tout ce qui est douteux est écarté, la structure fausse est refusée."""
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise ValueError("changes.json : version 1 attendue")
    items: dict[str, dict] = {}
    for item_id, o in (raw.get("items") or {}).items():
        if not ID_RE.match(item_id) or item_id == "__proto__" or not isinstance(o, dict):
            continue
        e: dict = {}
        if o.get("deleted") is True:
            e["deleted"] = True
        if o.get("status") == "to_buy":
            e["status"] = "to_buy"
        elif o.get("status") == "bought" and _price(o.get("paid")):
            e.update(status="bought", paid=_price(o["paid"]),
                     date=o["date"] if DATE_RE.match(str(o.get("date") or "")) else "",
                     vendor=_text(o.get("vendor"), 60))
        if "price" in o:
            e["price"] = _price(o["price"]) if o["price"] is not None else None
            if o["price"] is not None and e["price"] is None:
                del e["price"]
        for k, n in (("name", 80), ("model", 160)):
            if _text(o.get(k), n):
                e[k] = _text(o[k], n)
        if e:
            items[item_id] = e
    added = []
    seen = set()
    for a in raw.get("added") or []:
        if not isinstance(a, dict) or not ID_RE.match(str(a.get("id") or "")) or a["id"] in seen:
            continue
        if a.get("section") not in ADDABLE or not _text(a.get("name"), 80):
            continue
        entry = {"id": a["id"], "section": a["section"], "name": _text(a["name"], 80),
                 "model": _text(a.get("model"), 160), "icon": _text(a.get("icon"), 4) or "📦",
                 "price": _price(a.get("price")) or 0}
        url = _text(a.get("url"), 300)
        if url.startswith("https://"):
            entry["url"] = url
        seen.add(a["id"])
        added.append(entry)
    return {"version": 1, "items": items, "added": added}


def load_changes(path: Path) -> dict:
    if not path.exists():
        return {"version": 1, "items": {}, "added": []}
    return clean_changes(json.loads(path.read_text(encoding="utf-8")))


def _left(items) -> float:
    return round(sum((i.get("price") or 0) for i in items if i.get("status") not in ("bought", "owned_external")), 2)


def _bought(items) -> float:
    return round(sum((i.get("price") or 0) for i in items if i.get("status") == "bought"), 2)


def _section_of(data: dict, item_id: str) -> str | None:
    for sec in ITEM_SECTIONS:
        if any(i.get("id") == item_id for i in data.get(sec, [])):
            return sec
    return None


def rebuild_budget(data: dict, pc_offset: float) -> None:
    """Mêmes règles que check_prices.py : le reste à acheter ne compte que les articles non achetés."""
    b, meta = data["budget_summary"], data["meta"]
    periph_left = round(_left(data["screens"]) + _left(data["peripherals"]), 2)
    b["pc_total"] = round(_left(data["pc_components"]) + pc_offset, 2)
    b["already_bought"] = round(sum(_bought(data[s]) for s in ITEM_SECTIONS), 2)
    b["mobilier_2026_total"] = round(_left(data["mobilier"]) + _left(data["outils_bureau"]), 2)
    b["periph_2027_remaining"] = round(b["pc_total"] + periph_left, 2)
    b["remaining_to_buy"] = round(b["pc_total"] + periph_left + b["mobilier_2026_total"], 2)
    b["total_complete"] = round(b["remaining_to_buy"] + b["already_bought"], 2)
    b["margin_vs_prime"] = round(meta["prime_limit"] - b["remaining_to_buy"], 2)
    b["pc_margin"] = round(meta["pc_limit"] - b["pc_total"], 2)


def rebuild_recap(data: dict) -> None:
    """Récapitulatif des achats : chaque ligne se recalcule depuis ses références, les lignes vides disparaissent,
    et les articles ajoutés hors PC (déjà comptés dans pc_total) ont leur propre ligne."""
    rows = [r for r in data.get("purchase_recap", []) if r.get("refs") != ["recap_added"]]
    for row in rows:
        if row.get("refs"):
            row["price"] = _num(recap_price(data, row))
    extra = [i for sec in ITEM_SECTIONS if sec != "pc_components" for i in data.get(sec, []) if i.get("user")]
    left_extra = [i for i in extra if i.get("status") not in ("bought", "owned_external")]
    rows = [r for r in rows if r.get("price", 0) > 0]
    if left_extra:
        rows.append({"label": f"Articles ajoutés ({len(left_extra)})", "when": "Ajoutés par toi",
                     "price": _num(_left(left_extra)), "refs": ["recap_added"]})
    data["purchase_recap"] = rows


def drop_missing_refs(data: dict) -> None:
    """Une ligne d'historique dont tous les articles ont disparu n'a plus de sens."""
    comps = []
    for comp in data.get("price_history_components", []):
        refs = [r for r in comp.get("refs", []) if find_item(data, r) is not None]
        if comp.get("refs") and not refs:
            continue
        if comp.get("refs"):
            comp["refs"] = refs
        comps.append(comp)
    if "price_history_components" in data:
        data["price_history_components"] = comps


def apply_changes(data: dict, changes: dict) -> list[str]:
    """Applique les changements à `data` (en place) et renvoie ce qui a été fait, ligne par ligne."""
    log: list[str] = []
    b = data["budget_summary"]
    pc_offset = round(b["pc_total"] - _left(data["pc_components"]), 2)

    for a in changes["added"]:
        if _section_of(data, a["id"]):
            continue                                   # déjà présent : appliqué lors d'un passage précédent
        item = {"id": a["id"], "icon": a["icon"], "name": a["name"], "price": _num(a["price"]),
                "status": "to_buy", "user": True}
        item["ref" if a["section"] == "outils_bureau" else "note" if a["section"] == "peripherals" else "model"] = a["model"]
        if a.get("url"):
            item["source_url"] = a["url"]
        data[a["section"]].append(item)
        log.append(f"ajouté : {a['name']} ({a['section']})")

    removed = set(data.get("meta", {}).get("removed_items", []))
    for item_id, e in changes["items"].items():
        sec = _section_of(data, item_id)
        if e.get("deleted"):
            if sec:
                data[sec] = [i for i in data[sec] if i.get("id") != item_id]
                log.append(f"supprimé : {item_id}")
            removed.add(item_id)
            continue
        if not sec:
            continue
        item = find_item(data, item_id)
        if e.get("status") == "bought":
            if item.get("status") != "bought":
                item["price_released"] = item.get("price")
            item.update(status="bought", price=_num(e["paid"]))
            item["bought_date"], item["vendor"] = e["date"], e["vendor"]
            log.append(f"acheté : {item.get('name')} à {e['paid']} €")
        elif e.get("status") == "to_buy" and item.get("status") == "bought":
            item["status"] = "to_buy"
            for k in ("bought_date", "vendor"):
                item.pop(k, None)
            if item.get("price_released") is not None:
                item["price"] = item.pop("price_released")
            log.append(f"achat annulé : {item.get('name')}")
        if "price" in e and item.get("status") != "bought":
            if e["price"] is None:
                item.pop("price_manual", None)
            else:
                item["price"], item["price_manual"] = _num(e["price"]), True
                log.append(f"prix saisi : {item.get('name')} à {e['price']} €")
        if e.get("name") or e.get("model"):
            if e.get("name"):
                item["name"] = e["name"]
            if e.get("model"):
                # Les périphériques décrivent leur produit dans `note` (pas de champ `model`), les outils dans `ref`.
                item["ref" if sec == "outils_bureau" else "note" if sec == "peripherals" else "model"] = e["model"]
            if not item.get("product_changed"):
                item["offers"] = []                    # les offres de l'ancien produit ne valent plus rien
                item.pop("specs", None)
            item["product_changed"] = True
            log.append(f"produit changé : {item.get('name')}")

    if removed:
        data["meta"]["removed_items"] = sorted(removed)
    rebuild_budget(data, pc_offset)
    rebuild_recap(data)
    drop_missing_refs(data)
    if log and data.get("price_history"):
        # Pas de nouvelle ligne datée d'aujourd'hui (aucun prix n'a été relevé) : on met à jour la dernière,
        # comme le fait le relevé quand il tourne deux fois le même jour.
        record_history(data, date.fromisoformat(data["price_history"][-1]["date"]))
    return log


_STOP = {"de", "du", "des", "la", "le", "les", "et", "avec", "pour", "the", "and"}


def derive_cfg(item: dict) -> dict:
    """Configuration de suivi d'un article sans entrée dans sources.json (ajouté ou au produit changé).

    Le prix trouvé n'est jamais écrit tout seul (`auto: false`) : il est proposé dans la PR du relevé."""
    text = " ".join(x for x in (item.get("name"), item.get("model") or item.get("ref") or item.get("note")) if x)
    words = [w for w in re.split(r"[^0-9a-zà-ÿ]+", text.lower()) if w and w not in _STOP]
    tokens = [w for w in words if any(c.isdigit() for c in w) or len(w) >= 4][:4]
    cfg: dict = {"query": text.strip(), "match": tokens, "exclude": ["occasion|reconditionne"],
                 "qty": 1, "auto": False, "min_sources": 1, "sources": []}
    url = item.get("source_url")
    if url:
        host = urlsplit(url).netloc.lower().removeprefix("www.").split(".")[0] or "boutique"
        cfg["sources"].append({"retailer": host, "url": url})
    return cfg
