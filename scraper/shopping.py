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
from urllib.parse import quote, urlsplit

from aggregate import SourceResult, has_token, norm

ENDPOINT = "https://serpapi.com/search.json"
FATAL = ("clé SerpApi refusée", "quota SerpApi")      # inutile d'insister : chaque recherche suivante échouerait aussi
SUFFIX = " (via Google Shopping)"
AMAZON = "Amazon.fr"


@dataclass
class ShopOffer:
    title: str
    merchant: str
    price: float
    link: str


def _fetch(session, key: str, params: dict, timeout: float = 30.0) -> tuple[dict | None, str]:
    """(réponse JSON, erreur). Une erreur de réseau ou de clé ne cite jamais la clé."""
    try:
        resp = session.get(ENDPOINT, params={**params, "api_key": key}, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 - le message d'une exception réseau peut contenir l'URL, donc la clé
        return None, f"réseau ({type(exc).__name__})"
    if resp.status_code in (401, 403):
        why = ""
        try:
            why = str(resp.json().get("error") or "")
        except Exception:  # noqa: BLE001
            pass
        why = why.replace(key, "***")[:100]
        # La longueur et la nature de la clé (jamais sa valeur) disent si le secret est mal collé :
        # une clé SerpApi fait 64 caractères hexadécimaux.
        shape = "64 caractères hexadécimaux" if _looks_valid(key) else f"{len(key)} caractères, pas 64 hexadécimaux"
        return None, (f"clé SerpApi refusée (HTTP {resp.status_code}" + (f" : {why}" if why else "")
                      + f" ; la clé fournie a {shape})")
    if resp.status_code == 429:
        return None, "quota SerpApi atteint"
    try:
        data = resp.json()
    except Exception:  # noqa: BLE001
        return None, f"réponse illisible (HTTP {resp.status_code})"
    if resp.status_code != 200 or data.get("error"):
        msg = str(data.get("error") or f"HTTP {resp.status_code}")
        return None, "" if "hasn't returned any results" in msg else msg.replace(key, "***")[:120]
    return data, ""


def search(session, key: str, query: str, timeout: float = 30.0) -> tuple[list[ShopOffer], str]:
    """Google Shopping : (offres, erreur)."""
    data, error = _fetch(session, key, {"engine": "google_shopping", "q": query, "google_domain": "google.fr",
                                        "gl": "fr", "hl": "fr"}, timeout)
    if data is None:
        return [], error
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


def search_amazon(session, key: str, query: str, timeout: float = 30.0) -> tuple[list[ShopOffer], str]:
    """Amazon.fr : (offres, erreur). Le lien est celui de la fiche Amazon, pas une page Google.

    Les résultats ne disent pas toujours qui vend : un vendeur tiers peut s'y glisser, les règles de
    nom et d'écart sont là pour l'écarter s'il est hors norme."""
    data, error = _fetch(session, key, {"engine": "amazon", "k": query, "amazon_domain": "amazon.fr"}, timeout)
    if data is None:
        return [], error
    offers = []
    for item in data.get("organic_results", []) or []:
        price, text = item.get("extracted_price"), str(item.get("price") or "")
        if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
            continue
        if "$" in text or "£" in text:                  # amazon.fr affiche des euros ; autre chose = pas notre offre
            continue
        link = _best_link({"link": item.get("link_clean") or item.get("link")})
        if link and item.get("title"):
            offers.append(ShopOffer(str(item["title"]), AMAZON, float(price), link))
    return offers, ""


def _looks_valid(key: str) -> bool:
    return len(key) == 64 and all(c in "0123456789abcdefABCDEF" for c in key)


def clean_key(raw: str) -> str:
    """Espaces, retours à la ligne et guillemets autour de la clé : fréquents quand on colle un secret."""
    return (raw or "").strip().strip("\"'").strip()


def _best_link(item: dict) -> str:
    """Le lien du marchand s'il est donné, sinon la fiche Google ; toujours en https."""
    candidates = [item.get("link"), item.get("product_link")]
    for url in candidates:
        if isinstance(url, str) and url.startswith("https://") and urlsplit(url).netloc:
            # Google renvoie ses liens avec espaces et accents bruts : on les encode, sans toucher à la structure.
            return quote(url, safe=":/?&=%#,;+@!$'()*~")
    return ""


def to_results(offers: list[ShopOffer], cfg: dict, skip_merchants: set[str],
               suffix: str = SUFFIX) -> list[SourceResult]:
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
    return [SourceResult(o.merchant + (suffix if o.merchant != AMAZON else ""), o.link, "ok", value=round(o.price * qty, 2))
            for o in best.values()]
