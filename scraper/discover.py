"""Découverte : trouver les fiches produit d'un article chez plusieurs revendeurs.

Principe (en deux temps, comme le fait PRICE-FINDER — idée reprise, code écrit ici car ce
dépôt n'a pas de licence) :
  1. interroger la page de RECHERCHE du revendeur avec le nom de l'article ;
  2. ouvrir chaque fiche candidate et ne garder que celle dont le NOM (lu dans les
     données structurées) correspond à l'article attendu (`match` / `exclude`).
Une fiche n'entre dans sources.json que si elle a été lue ET validée : une mauvaise
adresse, un kit ou une autre variante est écarté, pas deviné.

La découverte est coûteuse (une recherche + quelques fiches par revendeur et par article) :
elle ne tourne pas à chaque relevé, seulement à la demande ou quand une adresse est morte.
"""

from collections import Counter
from dataclasses import dataclass, field
from urllib.parse import quote, quote_plus, urljoin, urlsplit

import extruct
from bs4 import BeautifulSoup

from aggregate import has_token, norm
from fetch import Fetcher, looks_blocked

MAX_CANDIDATES = 4        # fiches ouvertes par revendeur et par article


@dataclass
class Found:
    retailer: str
    url: str
    name: str | None
    price: float


@dataclass
class DiscoveryResult:
    found: dict[str, list[Found]] = field(default_factory=dict)
    tried: dict[str, Counter] = field(default_factory=dict)       # revendeur → statuts
    searched: int = 0


def search_url(template: str, query: str) -> str:
    return template.replace("{q+}", quote_plus(query)).replace("{q}", quote(query, safe=""))


def candidate_links(html: str, base_url: str, match: list[str]) -> list[str]:
    """Adresses de fiches probables dans une page de résultats : même site, texte ou adresse
    qui contiennent les mots attendus. Les données structurées d'abord (plus fiables)."""
    host = urlsplit(base_url).netloc
    urls: list[str] = []

    def add(url):
        if not url:
            return
        absolute = urljoin(base_url, url)
        parts = urlsplit(absolute)
        if parts.netloc == host and parts.path not in ("", "/") and absolute not in urls:
            urls.append(absolute.split("#")[0])

    try:
        data = extruct.extract(html, syntaxes=["json-ld"], errors="ignore", uniform=False)
    except Exception:  # noqa: BLE001
        data = {}
    stack = list(data.get("json-ld", []))
    while stack:
        node = stack.pop(0)
        if isinstance(node, list):
            stack = node + stack
        elif isinstance(node, dict):
            kinds = node.get("@type")
            kinds = " ".join(kinds) if isinstance(kinds, list) else str(kinds or "")
            label = f"{node.get('name', '')} {node.get('url', '')}"
            if "Product" in kinds and all(has_token(label, m) for m in match):
                add(node.get("url"))
            stack = [v for v in node.values() if isinstance(v, (dict, list))] + stack

    for a in BeautifulSoup(html, "html.parser").find_all("a", href=True):
        label = f"{a.get_text(' ', strip=True)} {a['href']} {a.get('title', '')}"
        if match and all(has_token(label, m) for m in match):
            add(a["href"])
    return urls[:MAX_CANDIDATES * 3]


def discover(data_items: dict[str, dict], sources: dict, retailers: dict, fetcher: Fetcher,
             read_source, only: set[str] | None = None, only_retailers: set[str] | None = None,
             log=print) -> DiscoveryResult:
    """`read_source(fetcher, src, cfg)` : lit et valide une fiche (voir update_prices)."""
    result = DiscoveryResult()
    for item_id, cfg in sources.get("items", {}).items():
        if only and item_id not in only:
            continue
        if cfg.get("discover") is False or not cfg.get("query"):
            continue
        have = {s["retailer"] for s in cfg.get("sources", [])}
        log(f"→ {data_items.get(item_id, {}).get('name', item_id)} : « {cfg['query']} »")
        for rid, r in retailers.items():
            if (only_retailers and rid not in only_retailers) or rid in have:
                continue
            counter = result.tried.setdefault(rid, Counter())
            page = fetcher.get(search_url(r["search"], cfg["query"]))
            result.searched += 1
            if page.status != "ok":
                counter[page.status] += 1
                continue
            if looks_blocked(page.text):
                counter["bloque"] += 1
                continue
            links = candidate_links(page.text, page.url, cfg.get("match", []))
            if not links:
                counter["sans_candidat"] += 1
                continue
            for url in links[:MAX_CANDIDATES]:
                sr = read_source(fetcher, {"retailer": rid, "url": url}, cfg)
                if sr.value is not None:
                    result.found.setdefault(item_id, []).append(
                        Found(rid, url, sr.quote.name if sr.quote else None, sr.value))
                    counter["trouve"] += 1
                    log(f"   ✓ {r['name']} : {sr.value:.2f} € — {url}")
                    break
            else:
                counter["aucune_fiche_valide"] += 1
    return result


def merge_sources(sources: dict, result: DiscoveryResult, today: str) -> int:
    """Ajoute les fiches validées à sources.json (jamais de suppression). Renvoie le nombre ajouté."""
    added = 0
    for item_id, founds in result.found.items():
        cfg = sources["items"][item_id]
        known = {s["url"] for s in cfg.setdefault("sources", [])}
        for f in founds:
            if f.url in known:
                continue
            cfg["sources"].append({"retailer": f.retailer, "url": f.url, "name": f.name,
                                   "seen": today, "price": f.price})
            added += 1
    return added


def render_discovery_report(result: DiscoveryResult, names: dict[str, str], retailers: dict, today) -> str:
    L = [f"Découverte du {today.strftime('%d/%m/%Y')} : {result.searched} recherches, "
         f"{sum(len(v) for v in result.found.values())} fiches validées.", ""]
    if result.found:
        L += ["### Fiches ajoutées", "", "| Article | Revendeur | Prix vu | Nom lu sur la fiche |", "|---|---|---:|---|"]
        for item_id, founds in result.found.items():
            for f in founds:
                L.append(f"| {names.get(item_id, item_id)} | [{retailers[f.retailer]['name']}]({f.url}) | "
                         f"{f.price:.2f} € | {(f.name or '—')[:70]} |")
        L.append("")
    order = ["trouve", "aucune_fiche_valide", "sans_candidat", "bloque", "robots", "introuvable", "erreur_http", "reseau"]
    label = {"trouve": "fiche trouvée", "aucune_fiche_valide": "fiches non valides", "sans_candidat": "sans résultat",
             "bloque": "bloqué", "robots": "interdit (robots.txt)", "introuvable": "introuvable",
             "erreur_http": "erreur HTTP", "reseau": "réseau"}
    L += ["### Revendeurs", "", "| Revendeur | " + " | ".join(label[o] for o in order) + " |",
          "|---|" + "---:|" * len(order)]
    for rid, c in result.tried.items():
        L.append(f"| {retailers[rid]['name']} | " + " | ".join(str(c.get(o, 0) or "") for o in order) + " |")
    L += ["", "Un revendeur « bloqué » ou « interdit » n'est pas contourné : le script s'identifie "
          "franchement et respecte les robots.txt.", ""]
    return "\n".join(L)
