"""Extraction d'un prix depuis le HTML d'une fiche produit.

La lecture des données structurées (JSON-LD, microdata, Open Graph) est confiée à
`extruct` (Zyte/Scrapinghub), qui tolère le JSON-LD invalide que beaucoup de sites
émettent (virgule finale, par exemple) : notre premier extracteur l'ignorait en silence.

Il n'y a volontairement PAS de repli sur « le premier montant en € trouvé dans le
texte » : sur une fiche, ce montant est souvent un accessoire, les frais de port ou
un produit suggéré. Mieux vaut ne rien lire qu'un mauvais prix : une page sans
données structurées reste « sans prix » dans le rapport.
"""

import re
from dataclasses import dataclass

import extruct


@dataclass
class Quote:
    price: float
    currency: str | None      # "EUR", "USD"… ou None si la page ne le dit pas
    available: bool | None    # True / False / None (inconnu)
    name: str | None          # nom du produit auquel appartient l'offre
    method: str               # "json-ld" ou "meta"
    product_index: int = 0    # rang du produit dans la page (0 = le premier)


def parse_price(value) -> float | None:
    """« 1 319,99 € », « 1.319,99 », « 1,319.99 », 1319.99 → 1319.99. None si illisible ou ≤ 0."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        s = str(value).replace(" ", "").replace("\xa0", "").replace(" ", "")
        s = re.sub(r"[^\d,.]", "", s)
        if not re.search(r"\d", s):
            return None
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):          # 1.319,99
                s = s.replace(".", "").replace(",", ".")
            else:                                     # 1,319.99
                s = s.replace(",", "")
        elif "," in s:
            head, _, tail = s.rpartition(",")
            s = head.replace(",", "") + "." + tail if len(tail) <= 2 else s.replace(",", "")
        elif "." in s:
            head, _, tail = s.rpartition(".")
            # « 1.319 » : trois décimales ne sont pas un prix, c'est un séparateur de milliers
            if len(tail) == 3 and head and len(head.replace(".", "")) <= 3:
                s = s.replace(".", "")
            else:
                s = head.replace(".", "") + "." + tail
        try:
            number = float(s)
        except ValueError:
            return None
    return round(number, 2) if number > 0 else None


_UNAVAILABLE = ("outofstock", "soldout", "discontinued")
_AVAILABLE = ("instock", "limitedavailability", "onlineonly")


def _availability(value) -> bool | None:
    if isinstance(value, dict):
        value = value.get("@id") or value.get("name")
    if not isinstance(value, str):
        return None
    v = value.lower().replace("_", "").replace(" ", "")
    if any(k in v for k in _UNAVAILABLE):
        return False
    if any(k in v for k in _AVAILABLE):
        return True
    return None


def _as_list(x):
    return x if isinstance(x, list) else ([] if x is None else [x])


def _types(node: dict) -> list[str]:
    return [str(t) for t in _as_list(node.get("@type"))]


def _spec_price(spec) -> tuple[float | None, str | None]:
    """Prix d'un priceSpecification, en ignorant les prix barrés / catalogue."""
    for s in _as_list(spec):
        if not isinstance(s, dict):
            continue
        kind = str(s.get("priceType", "")).lower()
        if any(k in kind for k in ("list", "strike", "msrp", "srp")):
            continue
        p = parse_price(s.get("price"))
        if p:
            return p, s.get("priceCurrency")
    return None, None


def _offer_quotes(offers, name, index) -> list[Quote]:
    out = []
    for off in _as_list(offers):
        if not isinstance(off, dict):
            continue
        types = _types(off)
        nested = off.get("offers")
        if "AggregateOffer" in types and nested:
            out += _offer_quotes(nested, name, index)
            continue
        price = parse_price(off.get("price"))
        currency = off.get("priceCurrency")
        if price is None and "AggregateOffer" in types:
            price = parse_price(off.get("lowPrice"))
        if price is None and off.get("priceSpecification"):
            price, spec_cur = _spec_price(off["priceSpecification"])
            currency = currency or spec_cur
        if price is None:
            continue
        out.append(Quote(price, str(currency).upper() if currency else None,
                         _availability(off.get("availability")), name, "json-ld", index))
    return out


def _walk(node):
    if isinstance(node, list):
        for x in node:
            yield from _walk(x)
    elif isinstance(node, dict):
        yield node
        for v in node.values():
            if isinstance(v, (dict, list)):
                yield from _walk(v)


def _text(value) -> str | None:
    for v in _as_list(value):
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _json_ld_quotes(blocks) -> list[Quote]:
    quotes: list[Quote] = []
    index = 0
    seen: set[int] = set()
    for node in _walk(blocks):
        if id(node) in seen or "Product" not in " ".join(_types(node)):
            continue
        seen.add(id(node))
        found = _offer_quotes(node.get("offers"), _text(node.get("name")), index)
        if found:
            quotes += found
            index += 1
    return quotes


def _microdata_quotes(blocks) -> list[Quote]:
    quotes: list[Quote] = []
    index = 0

    def props(node):
        return node.get("properties", {}) if isinstance(node, dict) else {}

    for node in _walk(blocks):
        kinds = " ".join(str(t) for t in _as_list(node.get("type")))
        if "Product" not in kinds:
            continue
        p = props(node)
        name = _text(p.get("name"))
        found: list[Quote] = []
        offers = _as_list(p.get("offers"))
        for off in offers:                       # offre imbriquée : itemprop="offers" itemscope
            op = props(off) if isinstance(off, dict) and "properties" in off else off
            if not isinstance(op, dict):
                continue
            price = parse_price(_text(op.get("price"))) or parse_price(_text(op.get("lowPrice")))
            if price:
                cur = _text(op.get("priceCurrency"))
                found.append(Quote(price, cur.upper() if cur else None,
                                   _availability(_text(op.get("availability"))), name, "microdata", index))
        if not found:                            # prix posé directement sur le produit
            price = parse_price(_text(p.get("price")))
            if price:
                cur = _text(p.get("priceCurrency"))
                found.append(Quote(price, cur.upper() if cur else None,
                                   _availability(_text(p.get("availability"))), name, "microdata", index))
        if found:
            quotes += found
            index += 1
    return quotes


def _opengraph_quotes(blocks) -> list[Quote]:
    for block in blocks:
        kv: dict[str, str] = {}
        for key, value in block.get("properties", []):
            kv.setdefault(key, value)
        price = parse_price(kv.get("product:price:amount") or kv.get("og:price:amount"))
        if price is None:
            continue
        cur = kv.get("product:price:currency") or kv.get("og:price:currency")
        avail = kv.get("product:availability") or kv.get("og:availability")
        norm = (avail or "").lower().replace(" ", "")
        available = False if norm in ("oos", "outofstock") else (True if norm == "instock" else _availability(avail))
        return [Quote(price, cur.upper() if cur else None, available, kv.get("og:title"), "opengraph", 0)]
    return []


def extract_quotes(html: str) -> list[Quote]:
    """Toutes les offres lisibles d'une page, dans l'ordre du document."""
    try:
        data = extruct.extract(html, syntaxes=["json-ld", "microdata", "opengraph"],
                               errors="ignore", uniform=False)
    except Exception:  # noqa: BLE001 - HTML illisible : aucune offre, pas une erreur
        return []
    return (_json_ld_quotes(data.get("json-ld", []))
            or _microdata_quotes(data.get("microdata", []))
            or _opengraph_quotes(data.get("opengraph", [])))
