"""Doublures de test : une fausse session HTTP, une fausse horloge, des pages produit."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parents[2]


class FakeResponse:
    def __init__(self, status=200, text="", headers=None):
        self.status_code, self.text, self.headers = status, text, headers or {}


class FakeSession:
    """`pages` : url → texte HTML, FakeResponse, ou exception à lever. Inconnue → 404."""

    def __init__(self, pages=None):
        self.pages, self.calls = dict(pages or {}), []

    def get(self, url, headers=None, timeout=None, allow_redirects=True):
        self.calls.append(url)
        page = self.pages.get(url)
        if page is None:
            return FakeResponse(404, "")
        if isinstance(page, Exception):
            raise page
        if callable(page):
            return page()
        return page if isinstance(page, FakeResponse) else FakeResponse(200, page)


class FakeClock:
    def __init__(self):
        self.now, self.slept = 1000.0, []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def make_fetcher(pages, delay=3.0):
    from fetch import Fetcher
    clock = FakeClock()
    session = FakeSession(pages)
    return Fetcher(session, delay=delay, sleep=clock.sleep, clock=clock), session, clock


def product_html(name, price, availability="InStock", currency="EUR"):
    node = {"@context": "https://schema.org", "@type": "Product", "name": name,
            "offers": {"@type": "Offer", "price": str(price), "priceCurrency": currency,
                       "availability": f"https://schema.org/{availability}"}}
    return f'<html><head><script type="application/ld+json">{json.dumps(node)}</script></head><body></body></html>'


def load_data():
    return json.loads((ROOT / "data" / "prices.json").read_text(encoding="utf-8"))
