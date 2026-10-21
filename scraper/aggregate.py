"""Du relevé de chaque site au prix retenu pour un article.

Règle (décision d'Antoni, 21/10/2026) : le prix affiché est TOUJOURS le moins cher des relevés
valides ; les autres offres sont listées dans « Où acheter ». Seul garde-fou : un prix sous 70 %
de la médiane des relevés est jugé absurde (autre produit, erreur) et écarté. Un prix n'est écrit
automatiquement que si assez de sites ont répondu et si le saut reste raisonnable ; sinon il est
seulement PROPOSÉ dans le rapport.
"""

import re
import statistics
import unicodedata
from dataclasses import dataclass, field

from extract import Quote

DEFAULTS = {
    "min_sources": 2,      # sites valides nécessaires pour écrire un prix
    "floor": 0.70,         # un relevé sous 70 % de la médiane est écarté comme absurde
    "max_jump": 0.30,      # au-delà, la variation est proposée, jamais appliquée
    "stable": 0.0,         # prix inchangé à l'euro près : seulement alors on ne réécrit pas
    "plausible": (0.5, 2.0),  # rapport au prix actuel hors duquel un relevé est écarté
}


def norm(text: str) -> str:
    """Minuscules, sans accents, ponctuation → espace : « B850-A » et « b850 a » se valent."""
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def has_token(text: str, token: str) -> bool:
    """`token` peut proposer des alternatives : « blanc|white » est vrai si l'un des deux y est.
    Un mot très court (« to », « ca ») doit être un mot entier, pas un bout de « tomate »."""
    haystack = f" {norm(text)} "
    for alt in token.split("|"):
        n = norm(alt)
        if not n:
            continue
        if len(n) <= 3 and " " not in n:
            if f" {n} " in haystack:
                return True
        elif n in haystack:
            return True
    return False


@dataclass
class SourceResult:
    retailer: str
    url: str
    status: str                       # ok | robots | bloque | introuvable | erreur_http | reseau | sans_prix
    detail: str = ""
    quote: Quote | None = None        # offre retenue sur cette page
    value: float | None = None        # prix de l'article (prix de la page × quantité)
    note: str = ""                    # pourquoi la page n'a pas été retenue
    seen: str = ""                    # date ISO d'une offre MÉMORISÉE (vue lors d'un relevé précédent, pas aujourd'hui)


@dataclass
class Decision:
    status: str                       # updated | stable | proposed | unknown | uncovered
    old: float | None
    new: float | None = None          # prix retenu (appliqué si status == updated)
    reason: str = ""
    used: list[SourceResult] = field(default_factory=list)
    results: list[SourceResult] = field(default_factory=list)


def pick_quote(quotes: list[Quote], match: list[str], exclude: list[str]) -> tuple[Quote | None, str]:
    """Choisit l'offre qui correspond bien à l'article attendu, ou explique pourquoi aucune."""
    reasons: list[str] = []
    passing: list[Quote] = []
    for q in quotes:
        if q.currency not in (None, "EUR"):
            reasons.append(f"devise {q.currency}")
            continue
        if q.available is False:
            reasons.append("hors stock")
            continue
        if q.name:
            missing = [m for m in match if not has_token(q.name, m)]
            banned = [x for x in exclude if has_token(q.name, x)]
            if missing or banned:
                why = f"manque {', '.join(missing)}" if missing else f"contient {', '.join(banned)}"
                reasons.append(f"produit différent ({why}) : « {q.name[:60]} »")
                continue
        elif match:
            pass  # nom absent : accepté, signalé par la méthode ; impossible de vérifier
        passing.append(q)
    if not passing:
        return None, "; ".join(dict.fromkeys(reasons)) or "aucune offre lisible"
    first = min(q.product_index for q in passing)
    return min((q for q in passing if q.product_index == first), key=lambda q: q.price), ""


def decide(old: float | None, results: list[SourceResult], params: dict | None = None) -> Decision:
    p = {**DEFAULTS, **(params or {})}
    low, high = p["plausible"]
    valid: list[SourceResult] = []
    for r in results:
        if r.value is None:
            continue
        if old and not (low <= r.value / old <= high):
            r.note = f"hors plage ({r.value:g} € contre {old:g} € actuels)"
            continue
        valid.append(r)

    if not valid:
        return Decision("unknown", old, reason="aucune source exploitable", results=results)

    median = statistics.median(r.value for r in valid)
    agreeing = [r for r in valid if r.value >= p["floor"] * median]
    for r in valid:
        if r not in agreeing:
            r.note = f"trop bas par rapport aux autres ({r.value:g} € contre médiane {median:g} €) : écarté"
    consensus = round(min(r.value for r in agreeing), 2)

    if len(agreeing) < p["min_sources"]:
        return Decision("proposed", old, consensus,
                        f"{len(agreeing)} source valide sur {p['min_sources']} requises",
                        agreeing, results)
    if old and abs(consensus - old) <= max(p["stable"] * old, 0.005):
        return Decision("stable", old, consensus, "", agreeing, results)
    if old and abs(consensus - old) > p["max_jump"] * old:
        return Decision("proposed", old, consensus,
                        f"variation de {(consensus - old) / old:+.0%}, à confirmer à la main",
                        agreeing, results)
    return Decision("updated", old, consensus, "", agreeing, results)
