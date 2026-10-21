import unittest

import fakes
from fakes import make_fetcher, product_html
from discover import candidate_links, discover, merge_sources, render_discovery_report, search_url
from update_prices import read_source

RETAILERS = {"alpha": {"name": "Alpha", "search": "https://alpha.fr/recherche/{q}/"},
             "beta": {"name": "Beta", "search": "https://beta.fr/s?q={q+}"}}
CFG = {"query": "Ryzen 7 9800X3D", "match": ["9800x3d"], "exclude": ["kit"], "qty": 1, "sources": []}


def search_page(*links):
    anchors = "".join(f'<a href="{u}">{t}</a>' for u, t in links)
    return f"<html><body>{anchors}</body></html>"


class Recherche(unittest.TestCase):
    def test_encodage_de_la_requete(self):
        self.assertEqual(search_url("https://a.fr/recherche/{q}/", "Ryzen 7 9800X3D"), "https://a.fr/recherche/Ryzen%207%209800X3D/")
        self.assertEqual(search_url("https://b.fr/s?q={q+}", "RTX 5070 Ti"), "https://b.fr/s?q=RTX+5070+Ti")

    def test_liens_candidats_filtres_par_mots_et_par_site(self):
        html = search_page(("/fiche/1.html", "AMD Ryzen 7 9800X3D Boxed"), ("/fiche/2.html", "Ryzen 5 7600X"),
                           ("https://autre.fr/x", "Ryzen 7 9800X3D"), ("/panier", "Panier"))
        self.assertEqual(candidate_links(html, "https://alpha.fr/recherche/x/", ["9800x3d"]), ["https://alpha.fr/fiche/1.html"])

    def test_liens_candidats_via_donnees_structurees(self):
        html = ('<html><head><script type="application/ld+json">{"@type":"ItemList","itemListElement":['
                '{"@type":"Product","name":"Ryzen 7 9800X3D","url":"/p/9800x3d"},{"@type":"Product","name":"Autre","url":"/p/autre"}]}</script></head></html>')
        self.assertEqual(candidate_links(html, "https://alpha.fr/r", ["9800x3d"]), ["https://alpha.fr/p/9800x3d"])


class Decouverte(unittest.TestCase):
    def pages(self):
        return {
            "https://alpha.fr/recherche/Ryzen%207%209800X3D/": search_page(("/fiche/1", "Ryzen 7 9800X3D Boxed"), ("/fiche/2", "Ryzen 7 9800X3D kit carte mère")),
            "https://alpha.fr/fiche/1": product_html("AMD Ryzen 7 9800X3D Boxed", "449.90"),
            "https://alpha.fr/fiche/2": product_html("Ryzen 7 9800X3D + carte mère kit", "699"),
            "https://beta.fr/s?q=Ryzen+7+9800X3D": search_page(("/p/9", "Ryzen 7 9800X3D")),
            "https://beta.fr/p/9": product_html("Ryzen 7 9800X3D", "452", availability="OutOfStock"),
        }

    def run_discovery(self, cfg=None, **kw):
        f, session, _ = make_fetcher(self.pages())
        items = {"cpu": {"name": "CPU"}}
        sources = {"items": {"cpu": cfg or {**CFG, "sources": []}}}
        return discover(items, sources, RETAILERS, f, read_source, log=lambda *_: None, **kw), sources, session

    def test_trouve_la_bonne_fiche_et_ecarte_le_kit_et_le_hors_stock(self):
        res, _, _ = self.run_discovery()
        self.assertEqual([(x.retailer, x.price) for x in res.found["cpu"]], [("alpha", 449.9)])
        self.assertEqual(res.tried["alpha"]["trouve"], 1)
        self.assertEqual(res.tried["beta"]["aucune_fiche_valide"], 1)        # en rupture : écartée

    def test_ne_cherche_pas_chez_un_revendeur_deja_present(self):
        cfg = {**CFG, "sources": [{"retailer": "alpha", "url": "https://alpha.fr/fiche/1"}]}
        _, _, session = self.run_discovery(cfg)
        self.assertFalse(any("alpha.fr/recherche" in c for c in session.calls))

    def test_article_sans_requete_ou_desactive_ignore(self):
        for cfg in ({"match": [], "sources": []}, {**CFG, "discover": False}):
            res, _, session = self.run_discovery(cfg)
            self.assertEqual(res.found, {})
            self.assertEqual(res.searched, 0)

    def test_limite_aux_revendeurs_demandes(self):
        res, _, _ = self.run_discovery(only_retailers={"beta"})
        self.assertNotIn("alpha", res.tried)

    def test_revendeur_qui_bloque_est_compte_pas_contourne(self):
        f, _, _ = make_fetcher({"https://alpha.fr/recherche/Ryzen%207%209800X3D/": "<title>Just a moment...</title>"})
        res = discover({"cpu": {}}, {"items": {"cpu": {**CFG, "sources": []}}}, {"alpha": RETAILERS["alpha"]}, f, read_source, log=lambda *_: None)
        self.assertEqual(res.tried["alpha"]["bloque"], 1)
        self.assertEqual(res.found, {})

    def test_fusion_ajoute_sans_doublon_ni_suppression(self):
        res, sources, _ = self.run_discovery()
        self.assertEqual(merge_sources(sources, res, "2026-11-01"), 1)
        self.assertEqual(merge_sources(sources, res, "2026-11-01"), 0)       # idempotent
        s = sources["items"]["cpu"]["sources"]
        self.assertEqual((s[0]["retailer"], s[0]["url"], s[0]["price"]), ("alpha", "https://alpha.fr/fiche/1", 449.9))

    def test_rapport(self):
        from datetime import date
        res, _, _ = self.run_discovery()
        text = render_discovery_report(res, {"cpu": "CPU"}, RETAILERS, date(2026, 11, 1))
        self.assertIn("1 fiches validées", text)
        self.assertIn("Alpha", text)


if __name__ == "__main__":
    unittest.main()
