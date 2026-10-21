"""Rapport Markdown d'un passage : sert de description à la Pull Request."""

from collections import Counter
from urllib.parse import urlsplit

from aggregate import Decision, SourceResult

STATUS_LABEL = {"ok": "ok", "bloque": "bloqué", "robots": "interdit (robots.txt)",
                "introuvable": "introuvable", "erreur_http": "erreur HTTP",
                "reseau": "réseau", "sans_prix": "sans prix"}


def eur(x) -> str:
    return "—" if x is None else f"{x:,.2f} €".replace(",", " ").replace(".", ",")


def _cell(text) -> str:
    return str(text).replace("|", "\\|").replace("\n", " ")


def _src(r: SourceResult) -> str:
    if r.value is not None:
        extra = f" (×{r.value / r.quote.price:g})" if r.quote and r.quote.price and abs(r.value - r.quote.price) > 0.001 else ""
        vu = f" (mémorisée, vue le {r.seen[8:10]}/{r.seen[5:7]})" if r.seen else ""
        return f"[{_cell(r.retailer)}]({r.url}) {eur(r.value)}{extra}{vu}"
    why = r.note or r.detail or STATUS_LABEL.get(r.status, r.status)
    return f"[{_cell(r.retailer)}]({r.url}) ✗ {_cell(why)}"


def render_report(run) -> str:
    """`run` : le RunResult de update_prices.run()."""
    d = run.decisions
    by = lambda s: [i for i, x in d.items() if x.status == s]
    updated, proposed = by("updated"), by("proposed")
    stable, unknown, uncovered = by("stable"), by("unknown"), by("uncovered")
    covered = len(run.tracked) - len(uncovered)
    verified = len(updated) + len(stable)
    L: list[str] = []

    mode = " (essai à blanc : rien n'a été écrit)" if run.dry_run else ""
    L.append(f"Relevé du {run.today.strftime('%d/%m/%Y')}{mode}.")
    L.append("")
    L.append(f"**{verified} prix vérifiés sur {covered} articles couverts** "
             f"({len(run.tracked)} articles à suivre) · {len(updated)} mis à jour · "
             f"{len(proposed)} à confirmer · {len(unknown)} sans réponse exploitable · "
             f"{len(uncovered)} sans source.")
    if run.searches:
        L += ["", f"Recherches Google Shopping / Amazon utilisées : {run.searches[0]} sur {run.searches[1]} (forfait SerpApi gratuit : 250 par mois)."]
    if covered and not verified:
        L += ["", "⚠️ **Aucun prix n'a pu être vérifié.** Les sites ont probablement bloqué le "
              "script : voir la table des sites plus bas."]
    L.append("")

    if updated:
        L += ["### Prix mis à jour", "", "| Article | Ancien | Nouveau | Écart | Sources |", "|---|---:|---:|---:|---|"]
        for i in updated:
            x: Decision = d[i]
            L.append(f"| {_cell(run.names[i])} | {eur(x.old)} | **{eur(x.new)}** | "
                     f"{(x.new - x.old) / x.old:+.1%} | {' · '.join(_src(r) for r in x.used)} |")
        L.append("")
    if proposed:
        L += ["### À confirmer (non appliqués)", "",
              "| Article | Actuel | Proposé | Pourquoi | Sources |", "|---|---:|---:|---|---|"]
        for i in proposed:
            x = d[i]
            L.append(f"| {_cell(run.names[i])} | {eur(x.old)} | {eur(x.new)} | {_cell(x.reason)} | "
                     f"{' · '.join(_src(r) for r in x.used) or '—'} |")
        L.append("")

    L += ["<details><summary>Détail des prix, article par article</summary>", "",
          "| Article | Actuel | Retenu | État | Sources |", "|---|---:|---:|---|---|"]
    state = {"updated": "mis à jour", "stable": "stable", "proposed": "à confirmer",
             "unknown": "sans réponse", "uncovered": "sans source"}
    for i in run.tracked:
        x = d[i]
        srcs = " · ".join(_src(r) for r in x.results) if x.results else "—"
        L.append(f"| {_cell(run.names[i])} | {eur(x.old)} | {eur(x.new) if x.new else '—'} | "
                 f"{state[x.status]} | {srcs} |")
    L += ["", "</details>", ""]

    if run.hosts:
        order = ["ok", "sans_prix", "bloque", "robots", "introuvable", "erreur_http", "reseau"]
        L += ["### Sites interrogés", "", "| Site | " + " | ".join(STATUS_LABEL[s] for s in order) + " |",
              "|---|" + "---:|" * len(order)]
        for host, c in sorted(run.hosts.items()):
            L.append(f"| {host} | " + " | ".join(str(c.get(s, 0) or "") for s in order) + " |")
        L += ["", "« ok » = une page lue (le prix a pu être écarté ensuite : produit différent, hors stock…). "
              "Un site « bloqué » ou « interdit » n'est pas contourné : le script s'identifie "
              "franchement et respecte les robots.txt.", ""]
    if uncovered:
        L += ["### Articles sans source configurée", "",
              "Ajouter leurs adresses dans `scraper/sources.json` pour qu'ils soient suivis :", ""]
        L += [f"- {run.names[i]} ({eur(d[i].old)})" for i in uncovered]
        L.append("")
    return "\n".join(L).rstrip() + "\n"
