"""Complément Google Shopping (via SerpApi) pour les articles que les fiches directes ne couvrent pas.

Pourquoi : Fnac, Darty et Cdiscount interdisent les robots, Materiel.net refuse GitHub, Amazon n'a
pas d'API ouverte. Une API Shopping, interrogée avec une clé personnelle, renvoie les offres de
ces marchands avec leur prix, sans qu'on touche à leurs sites.

Choix assumés :
- Les offres passent par les MÊMES règles que les fiches directes : nom validé par `match` /
  `exclude`, devise €, un seul prix par marchand, puis plafond d'écart et seuil de sources.
- Le lien d'une offre est celui que Google donne : souvent sa fiche produit (qui liste les
  marchands), pas toujours la page du marchand. Le rapport le dit « via Google Shopping ».
- La clé ne sort jamais d'ici : ni dans un log, ni dans le rapport, ni dans un message d'erreur.
"""

from dataclasses import dataclass
from urllib.parse import urlsplit

from aggregate import SourceResult, has_token, norm

ENDPOINT = "https://serpapi.com/search.json"
SUFFIX = " (via Google Shopping)"


@dataclass
class ShopOffer:
    title: str
    merchant: str
    price: float
    link: str


def search(session, key: str, query: str, timeout: float = 30.0) -> tuple[list[ShopOffer], str]:
    """(offres, erreur). Une erreur de réseau ou de clé donne ([], message) sans jamais citer la clé."""
    params = {"engine": "google_shopping", "q": query, "google_domain": "google.fr",
              "gl": "fr", "hl": "fr", "api_key": key}
    try:
        resp = session.get(ENDPOINT, params=params, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - le message d'une exception réseau peut contenir l'URL, donc la clé
        return [], f"réseau ({type(exc).__name__})"
    if resp.status_code in (401, 403):
        return [], "clé SerpApi refusée"
    if resp.status_code == 429:
        return [], "quota SerpApi atteint"
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return [], f"réponse illisible (HTTP {resp.status_code})"
    if resp.status_code != 200 or data.get("error"):
        msg = str(data.get("error") or f"HTTP {resp.status_code}")
        return [], "" if "hasn't returned any results" in msg else msg.replace(key, "***")[:120]
    offers = []
    for item in data.get("shopping_results", []) or []:
        price, text = item.get("extracted_price"), str(item.get("price") or "")
        if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0 or "€" not in text:
            continue
        link = _best_link(item)
        merchant = str(item.get("source") or "").strip()
        if link and merchant and item.get("title"):
            offers.append(ShopOffer(str(item["title"]), merchant, float(price), link))
    return offers, ""


def _best_link(item: dict) -> str:
    """Le lien du marchand s'il est donné, sinon la fiche Google ; toujours en https."""
    candidates = [item.get("link"), item.get("product_link")]
    for url in candidates:
        if isinstance(url, str) and url.startswith("https://") and urlsplit(url).netloc:
            return url
    return ""


def to_results(offers: list[ShopOffer], cfg: dict, skip_merchants: set[str]) -> list[SourceResult]:
    """Offres valides sous forme de relevés, un par marchand (le moins cher), hors marchands déjà lus."""
    match, exclude, qty = cfg.get("match", []), cfg.get("exclude", []), cfg.get("qty", 1)
    best: dict[str, ShopOffer] = {}
    for o in offers:
        if any(not has_token(o.title, m) for m in match) or any(has_token(o.title, x) for x in exclude):
            continue
        key = norm(o.merchant)
        if key in skip_merchants or any(key.startswith(s) or s.startswith(key) for s in skip_merchants if s):
            continue
        if key not in best or o.price < best[key].price:
            best[key] = o
    return [SourceResult(o.merchant + SUFFIX, o.link, "ok", value=round(o.price * qty, 2))
            for o in best.values()]
