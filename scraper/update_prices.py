#!/usr/bin/env python3
"""
Relevé des prix — Projet PC Full White

Pour chaque article encore à acheter, lit plusieurs fiches produit (scraper/sources.json),
retient la médiane des sites qui s'accordent, puis répercute les changements sur les
totaux, le récapitulatif et l'historique de data/prices.json.

    python3 scraper/update_prices.py                      # relevé complet, écrit prices.json
    python3 scraper/update_prices.py --dry-run            # n'écrit rien, affiche le rapport
    python3 scraper/update_prices.py --only cpu,gpu       # limite à certains articles
    python3 scraper/update_prices.py --report rapport.md  # écrit aussi le rapport Markdown
    python3 scraper/update_prices.py --probe URL [URL…]   # teste des adresses, sans rien écrire
    python3 scraper/update_prices.py --discover           # cherche des fiches chez les revendeurs
    python3 scraper/update_prices.py --discover --only cpu --retailers ldlc,grosbill

Le web est fragile par nature : un site qui change, bloque ou n'a pas de données
structurées donne « sans réponse » dans le rapport, jamais un prix inventé. Un prix n'est
écrit que si assez de sites concordent ; sinon il est seulement proposé.
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from aggregate import DEFAULTS, Decision, SourceResult, decide, norm, pick_quote
from discover import discover, merge_sources, render_discovery_report
from extract import extract_quotes
from fetch import Fetcher, looks_blocked
from recompute import ITEM_SECTIONS, apply_updates, find_item, record_history, record_offers, stamp
from report import render_report
import shopping

ROOT = Path(__file__).resolve().parent.parent
PRICES_FILE = ROOT / "data" / "prices.json"
SOURCES_FILE = ROOT / "scraper" / "sources.json"
RETAILERS_FILE = ROOT / "scraper" / "retailers.json"
MIN_COVERAGE = 0.5      # part des articles couverts à vérifier pour dater le relevé


@dataclass
class RunResult:
    today: date
    dry_run: bool
    tracked: list[str]
    names: dict[str, str]
    decisions: dict[str, Decision]
    hosts: dict[str, Counter] = field(default_factory=dict)
    applied: dict[str, tuple] = field(default_factory=dict)
    marked_verified: bool = False


def tracked_items(data: dict) -> list[tuple[str, dict]]:
    """Articles à suivre : encore à acheter, au prix non nul (l'acheté est figé, le gratuit n'a rien à suivre)."""
    out = []
    for section in ITEM_SECTIONS:
        for item in data.get(section, []):
            if item.get("status") in ("bought", "owned_external") or not (item.get("price") or 0):
                continue
            if item.get("id"):
                out.append((item["id"], item))
    return out


def load_sources(path: Path, data: dict) -> dict:
    cfg = json.loads(path.read_text(encoding="utf-8"))
    items = cfg.get("items", {})
    unknown = [i for i in items if find_item(data, i) is None]
    if unknown:
        raise SystemExit(f"sources.json : articles inconnus dans prices.json : {', '.join(unknown)}")
    for item_id, c in items.items():
        for s in c.get("sources", []):
            if not s.get("retailer") or not str(s.get("url", "")).startswith(("http://", "https://")):
                raise SystemExit(f"sources.json : source invalide pour « {item_id} » : {s}")
    return cfg


def read_source(fetcher: Fetcher, src: dict, cfg: dict) -> SourceResult:
    retailer, url = src["retailer"], src["url"]
    fr = fetcher.get(url)
    if fr.status != "ok":
        return SourceResult(retailer, url, fr.status, fr.detail)
    quotes = extract_quotes(fr.text)
    if not quotes:
        return SourceResult(retailer, url, "bloque" if looks_blocked(fr.text) else "sans_prix",
                            "page sans données de prix structurées")
    quote, note = pick_quote(quotes, cfg.get("match", []), cfg.get("exclude", []))
    if quote is None:
        return SourceResult(retailer, url, "ok", note=note)
    return SourceResult(retailer, url, "ok", quote=quote,
                        value=round(quote.price * cfg.get("qty", 1), 2))


def retailer_labels(path: Path = RETAILERS_FILE) -> dict[str, str]:
    """Nom affiché de chaque revendeur (retailers.json), plus ceux qu'on ne découvre pas par recherche."""
    names = {"ikea": "IKEA", "onkron": "ONKRON", "leroymerlin": "Leroy Merlin", "topachat": "TopAchat"}
    if path.exists():
        names.update({k: v["name"] for k, v in json.loads(path.read_text(encoding="utf-8"))["retailers"].items()})
    return names


AMAZON_BUDGET = 25       # recherches Amazon.fr au plus par passage : dernier recours, pour tenir dans le forfait
SHOPPING_BUDGET = 40     # recherches Google Shopping au plus par passage (le forfait gratuit en donne 250 par mois)


def run(data: dict, sources: dict, fetcher: Fetcher, today: date, only: set[str] | None = None,
        dry_run: bool = False, log=print, labels: dict[str, str] | None = None,
        shop=None, amazon=None) -> RunResult:
    """`shop` / `amazon` : fonctions `requête → (offres, erreur)` ; None = complément désactivé.
    Amazon n'est interrogé qu'en dernier recours, quand ni les fiches directes ni Shopping ne confirment."""
    items = sources.get("items", {})
    defaults = {**DEFAULTS, **sources.get("defaults", {})}
    tracked = [(i, it) for i, it in tracked_items(data) if not only or i in only]
    names = {i: it.get("name") or i for i, it in tracked}
    decisions: dict[str, Decision] = {}
    hosts: dict[str, Counter] = defaultdict(Counter)
    budget = [SHOPPING_BUDGET, AMAZON_BUDGET]

    for item_id, item in tracked:
        cfg = items.get(item_id, {})
        srcs = [x for x in cfg.get("sources", []) if not x.get("link_only")]
        if not srcs and not ((shop or amazon) and cfg.get("query")):
            decisions[item_id] = Decision("uncovered", item.get("price"))
            continue
        log(f"→ {names[item_id]} ({len(srcs)} source(s))")
        results = []
        for s in srcs:
            r = read_source(fetcher, s, cfg)
            hosts[urlsplit(s["url"]).netloc][r.status] += 1
            results.append(r)
        params = {**defaults, **{k: cfg[k] for k in ("min_sources", "agree", "max_jump") if k in cfg}}
        decisions[item_id] = decide(item.get("price"), results, params)
        d = decisions[item_id]
        if (shop or amazon) and d.status not in ("updated", "stable") and cfg.get("query"):
            d = decisions[item_id] = _with_shopping(item, cfg, results, params, shop, amazon, budget, labels, log)
        log(f"   {d.status}" + (f" : {d.old} → {d.new}" if d.new is not None else "")
            + (f" ({d.reason})" if d.reason else ""))

    covered = [i for i, _ in tracked if decisions[i].status != "uncovered"]
    verified = [i for i in covered if decisions[i].status in ("updated", "stable")]
    updates = {i: d.new for i, d in decisions.items() if d.status == "updated"}
    result = RunResult(today, dry_run, [i for i, _ in tracked], names, decisions, dict(hosts))
    # Un prix écrit aujourd'hui est une vérification d'aujourd'hui : l'historique reçoit alors
    # une ligne datée du jour, et check_prices.py exige last_verified ≥ cette date.
    result.marked_verified = bool(updates) or (bool(covered) and len(verified) / len(covered) >= MIN_COVERAGE)

    if not dry_run and not only:
        for item_id, item in tracked:
            d = decisions[item_id]
            links = [x for x in items.get(item_id, {}).get("sources", []) if x.get("link_only")]
            if d.status in ("updated", "stable", "proposed") or links:
                keep = d.status in ("updated", "stable", "proposed")
                record_offers(item, d.used if keep else [], d.results, today, labels or retailer_labels(), links)
        if updates:
            result.applied = apply_updates(data, updates)
            record_history(data, today)
        stamp(data, today, len(tracked), len(verified), len(updates), result.marked_verified)
    return result


def _with_shopping(item, cfg, results, params, shop, amazon, budget, labels, log):
    """Relance la décision avec les offres Google Shopping puis, en dernier recours, Amazon.fr.

    `budget` = [recherches Shopping restantes, recherches Amazon restantes]."""
    labels = labels or retailer_labels()
    results = list(results)
    d = decide(item.get("price"), results, params)
    error = ""
    steps = []
    if shop and budget[0] > 0:
        steps.append((0, shop, shopping.SUFFIX, "Google Shopping"))
    if amazon and budget[1] > 0 and cfg.get("amazon", True):
        steps.append((1, amazon, "", "Amazon.fr"))
    for slot, fn, suffix, name in steps:
        if d.status in ("updated", "stable"):
            break                                   # déjà confirmé : inutile de dépenser une recherche
        if budget[slot] <= 0:
            continue
        budget[slot] -= 1
        offers, error = fn(cfg["query"])
        seen = {norm(labels.get(r.retailer, r.retailer)) for r in results if r.value is not None}
        extra = shopping.to_results(offers, cfg, seen, suffix)
        log(f"   + {name} : {len(extra)} offre(s) retenue(s) sur {len(offers)}" + (f" ({error})" if error else ""))
        results += extra
        if error.startswith(shopping.FATAL):
            budget[0] = budget[1] = 0
            log("   (recherches externes arrêtées pour ce passage : " + error + ")")
        d = decide(item.get("price"), results, params)
    if not [r for r in results if r.value is not None] and d.status == "unknown":
        d.reason = error or d.reason or "aucune offre exploitable"
    if cfg.get("auto") is False and d.status == "updated":      # référence à valider : jamais écrit seul
        d.status, d.reason = "proposed", "produit de référence à valider"
    return d


def probe(urls: list[str], fetcher: Fetcher) -> None:
    for url in urls:
        fr = fetcher.get(url)
        print(f"\n{url}\n  état : {fr.status}" + (f" ({fr.detail})" if fr.detail else ""))
        if fr.status != "ok":
            continue
        quotes = extract_quotes(fr.text)
        if not quotes:
            print("  aucune donnée de prix structurée" + (" — page de blocage ?" if looks_blocked(fr.text) else ""))
        for q in quotes:
            print(f"  produit {q.product_index} : {q.price:.2f} {q.currency or '?'} · "
                  f"dispo={q.available} · {q.method} · « {(q.name or '?')[:90]} »")


def save(path: Path, data: dict, lead: str) -> None:
    path.write_text(lead + json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="n'écrit rien, affiche seulement")
    ap.add_argument("--only", help="identifiants séparés par des virgules, ex : cpu,gpu")
    ap.add_argument("--report", help="écrit le rapport Markdown dans ce fichier")
    ap.add_argument("--data", default=str(PRICES_FILE))
    ap.add_argument("--sources", default=str(SOURCES_FILE))
    ap.add_argument("--delay", type=float, default=3.0, help="secondes minimum entre deux requêtes au même site")
    ap.add_argument("--probe", nargs="+", metavar="URL", help="teste des adresses, sans rien écrire")
    ap.add_argument("--discover", action="store_true",
                    help="cherche des fiches par nom chez les revendeurs et les ajoute à sources.json")
    ap.add_argument("--retailers", help="limite la découverte à ces revendeurs (ids séparés par des virgules)")
    ap.add_argument("--retailers-file", default=str(RETAILERS_FILE))
    ap.add_argument("--no-shopping", action="store_true",
                    help="n'interroge pas Google Shopping même si SERPAPI_KEY est définie")
    args = ap.parse_args(argv)

    try:
        import requests
    except ImportError:
        print("Dépendances manquantes : pip install requests beautifulsoup4")
        return 1
    fetcher = Fetcher(requests.Session(), delay=args.delay)

    if args.probe:
        probe(args.probe, fetcher)
        return 0

    data_path = Path(args.data)
    raw = data_path.read_text(encoding="utf-8")
    lead = "\n" if raw.startswith("\n") else ""
    data = json.loads(raw)
    sources = load_sources(Path(args.sources), data)
    only = set(args.only.split(",")) if args.only else None

    if args.discover:
        retailers = json.loads(Path(args.retailers_file).read_text(encoding="utf-8"))["retailers"]
        chosen = set(args.retailers.split(",")) if args.retailers else None
        if chosen and (bad := chosen - retailers.keys()):
            raise SystemExit(f"revendeurs inconnus : {', '.join(sorted(bad))}")
        today = date.today()
        items = {i: find_item(data, i) or {} for i in sources["items"]}
        found = discover(items, sources, retailers, fetcher, read_source, only, chosen)
        added = merge_sources(sources, found, today.isoformat())
        names = {i: it.get("name") or i for i, it in items.items()}
        report = render_discovery_report(found, names, retailers, today)
        print("\n" + report)
        if args.report:
            Path(args.report).write_text(report, encoding="utf-8")
        if args.dry_run:
            print("(essai à blanc : sources.json n'a pas été modifié)")
        else:
            Path(args.sources).write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"✅ {added} fiche(s) ajoutée(s) à {args.sources}")
        return 0

    key = shopping.clean_key(os.environ.get("SERPAPI_KEY", ""))
    shop = amazon = None
    if key and not args.no_shopping:
        session = fetcher.session
        shop = lambda q: shopping.search(session, key, q)       # noqa: E731
        amazon = lambda q: shopping.search_amazon(session, key, q)       # noqa: E731
    else:
        print("Google Shopping : désactivé (pas de SERPAPI_KEY).")
    result = run(data, sources, fetcher, date.today(), only, args.dry_run, labels=retailer_labels(), shop=shop, amazon=amazon)
    report = render_report(result)
    print("\n" + report)
    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
    if args.dry_run or only:
        print("(essai à blanc ou sélection partielle : prices.json n'a pas été modifié)")
        return 0
    save(data_path, data, lead)
    print(f"✅ {data_path} écrit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
