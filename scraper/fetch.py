"""Récupération polie des pages : robots.txt respecté, identité franche, cadence limitée.

Choix assumés :
- L'User-Agent dit ce qu'est ce script (un suivi de prix personnel, deux passages par
  mois) au lieu de se faire passer pour Chrome. Conséquence : certains sites répondront
  « bloqué » là où un faux navigateur serait passé. Ils sont listés dans le rapport,
  pas contournés.
- Une URL interdite par le robots.txt de son site n'est pas lue.
- Au plus une requête toutes les `delay` secondes par site (ou le Crawl-delay du site
  s'il est plus long), une seule nouvelle tentative sur 429 / 503.
"""

import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urlsplit

USER_AGENT = ("pc-full-white-price-check/2.0 "
              "(+https://github.com/antoniman31/pc-full-white; suivi personnel, 2 passages par mois)")
UA_TOKEN = "pc-full-white-price-check"

# Pages « êtes-vous un robot ? » renvoyées avec un code 200 : aucune donnée produit dedans.
BLOCK_MARKERS = ("captcha", "access denied", "just a moment", "cf-chl", "are you a robot",
                 "unusual traffic", "request blocked", "px-captcha", "verifying you are human")


@dataclass
class FetchResult:
    url: str
    status: str               # ok | robots | bloque | introuvable | erreur_http | reseau
    http: int | None = None
    text: str | None = None
    detail: str = ""


class Fetcher:
    def __init__(self, session, delay: float = 3.0, timeout: float = 25.0,
                 sleep=time.sleep, clock=time.monotonic, max_bytes: int = 2_000_000):
        self.session = session
        self.delay = delay
        self.timeout = timeout
        self.sleep = sleep
        self.clock = clock
        self.max_bytes = max_bytes
        self._last: dict[str, float] = {}
        self._robots: dict[str, tuple[str, urllib.robotparser.RobotFileParser | None]] = {}
        self._details: dict[str, str] = {}

    # -- cadence ---------------------------------------------------------------
    def _wait(self, host: str, extra: float = 0.0):
        gap = max(self.delay, extra)
        last = self._last.get(host)
        if last is not None:
            remaining = gap - (self.clock() - last)
            if remaining > 0:
                self.sleep(remaining)
        self._last[host] = self.clock()

    def _headers(self):
        return {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "fr-FR,fr;q=0.9"}

    # -- robots.txt ------------------------------------------------------------
    def _robots_for(self, origin: str, host: str):
        if origin in self._robots:
            return self._robots[origin]
        resp, detail = None, ""
        for attempt in (1, 2, 3):       # un robots.txt lent n'est pas un robots.txt absent : on réessaie
            if attempt > 1:
                self.sleep(5 * (attempt - 1))
            self._wait(host)
            try:
                resp = self.session.get(origin + "/robots.txt", headers=self._headers(),
                                        timeout=self.timeout, allow_redirects=True)
            except Exception as exc:  # noqa: BLE001 - toute erreur réseau
                resp, detail = None, type(exc).__name__
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                detail = f"HTTP {resp.status_code}"
                resp = None
                continue
            break
        if resp is None:
            self._details[origin] = detail
            entry = ("reseau", None)
            self._robots[origin] = entry
            return entry
        code = resp.status_code
        if code == 200:
            rp = urllib.robotparser.RobotFileParser()
            rp.parse((resp.text or "").splitlines())
            entry = ("parsed", rp)
        elif code in (401, 403):
            entry = ("bloque", None)          # le site nous ferme déjà la porte
        else:
            entry = ("allow", None)           # 404 & co : pas de robots.txt = tout permis
        self._robots[origin] = entry
        return entry

    # -- lecture ---------------------------------------------------------------
    def get(self, url: str) -> FetchResult:
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            return FetchResult(url, "erreur_http", detail="URL invalide")
        origin, host = f"{parts.scheme}://{parts.netloc}", parts.netloc

        kind, rp = self._robots_for(origin, host)
        if kind == "bloque":
            return FetchResult(url, "bloque", 403, detail="robots.txt refusé (403) : site fermé aux robots")
        if kind == "reseau":
            why = self._details.get(origin)
            return FetchResult(url, "reseau", detail="robots.txt indisponible" + (f" ({why})" if why else ""))
        extra = 0.0
        if kind == "parsed":
            if not rp.can_fetch(UA_TOKEN, url):
                return FetchResult(url, "robots", detail="interdit par robots.txt")
            extra = float(rp.crawl_delay(UA_TOKEN) or 0)

        for attempt in (1, 2):
            self._wait(host, extra)
            try:
                resp = self.session.get(url, headers=self._headers(), timeout=self.timeout,
                                        allow_redirects=True)
            except Exception as exc:  # noqa: BLE001
                return FetchResult(url, "reseau", detail=f"{type(exc).__name__}")
            code = resp.status_code
            if code in (429, 503) and attempt == 1:
                try:
                    pause = min(float(resp.headers.get("Retry-After", 5)), 20.0)
                except (TypeError, ValueError):
                    pause = 5.0
                self.sleep(pause)
                continue
            break

        if code == 200:
            text = (resp.text or "")[: self.max_bytes]
            return FetchResult(url, "ok", code, text)
        if code in (401, 403, 429, 503):
            return FetchResult(url, "bloque", code, detail=f"HTTP {code}")
        if code in (404, 410):
            return FetchResult(url, "introuvable", code, detail=f"HTTP {code}")
        return FetchResult(url, "erreur_http", code, detail=f"HTTP {code}")


def looks_blocked(text: str) -> bool:
    low = (text or "")[:20000].lower()
    return any(m in low for m in BLOCK_MARKERS)
