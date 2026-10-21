import json
import unittest
from datetime import date

import fakes
from fakes import FakeResponse, FakeSession, load_data, make_fetcher, product_html
from test_recompute import check
import shopping
from shopping import search, to_results
from update_prices import run

KEY = "cle-secrete-123"
TODAY = date(2026, 11, 1)


def reply(*items, status=200, **extra):
    return FakeResponse(status, json.dumps({"shopping_results": list(items), **extra}))


def item(title, price, merchant, link="https://www.google.com/shopping/product/1", **kw):
    return {"title": title, "extracted_price": price, "price": f"{price:.2f} €".replace(".", ","),
            "source": merchant, "product_link": link, **kw}


class Recherche(unittest.TestCase):
    def sess(self, response):
        return FakeSession({shopping.ENDPOINT: response})

    def test_offres_lues_avec_marchand_prix_et_lien(self):
        s = self.sess(reply(item("Xiaomi A24i", 99.9, "Fnac"), item("Xiaomi A24i", 105, "Darty", link="https://www.darty.com/p/1")))
        offers, err = search(s, KEY, "Xiaomi A24i")
        self.assertEqual(err, "")
        self.assertEqual([(o.merchant, o.price) for o in offers], [("Fnac", 99.9), ("Darty", 105.0)])
        self.assertEqual(s.params["gl"], "fr")
        self.assertEqual(s.params["engine"], "google_shopping")

    def test_le_lien_du_marchand_prime_sur_la_fiche_google_et_http_est_refuse(self):
        o = item("X", 10, "Fnac", link="https://www.google.com/g")
        o["link"] = "https://www.fnac.com/x"
        bad = item("Y", 10, "Darty", link="http://insecure.example/y")
        offers, _ = search(self.sess(reply(o, bad)), KEY, "q")
        self.assertEqual([x.link for x in offers], ["https://www.fnac.com/x"])

    def test_lien_google_avec_espaces_et_accents_est_encode(self):
        o = item("X", 10, "Fnac", link="https://www.google.fr/search?ibp=oshop&q=vis agglomérés 4x30&prds=productid:1,x:2")
        offers, _ = search(self.sess(reply(o)), KEY, "q")
        self.assertEqual(offers[0].link,
                         "https://www.google.fr/search?ibp=oshop&q=vis%20agglom%C3%A9r%C3%A9s%204x30&prds=productid:1,x:2")

    def test_prix_non_euro_ou_non_numerique_ignore(self):
        usd = item("X", 10, "Shop"); usd["price"] = "$10.00"
        nan = item("Y", 10, "Shop"); nan["extracted_price"] = "dix"
        offers, _ = search(self.sess(reply(usd, nan, item("Z", 12, "Shop"))), KEY, "q")
        self.assertEqual([o.title for o in offers], ["Z"])

    def test_erreurs_sans_jamais_citer_la_cle(self):
        for resp, expected in ((FakeResponse(403, "{}"), "clé SerpApi refusée (HTTP 403"),
                               (FakeResponse(429, "{}"), "quota SerpApi atteint")):
            offers, err = search(self.sess(resp), KEY, "q")
            self.assertEqual(offers, [])
            self.assertTrue(err.startswith(expected), err)
        boom = ConnectionError(f"https://serpapi.com/search.json?api_key={KEY}")
        offers, err = search(self.sess(lambda: (_ for _ in ()).throw(boom)), KEY, "q")
        self.assertEqual((offers, err), ([], "réseau (ConnectionError)"))
        self.assertNotIn(KEY, err)
        _, err = search(self.sess(FakeResponse(200, json.dumps({"error": f"Invalid {KEY}"}))), KEY, "q")
        self.assertNotIn(KEY, err)

    def test_cle_refusee_dit_le_motif_de_serpapi_sans_la_cle(self):
        r = FakeResponse(401, json.dumps({"error": f"Invalid API key {KEY}. Your API key should be here"}))
        offers, err = search(self.sess(r), KEY, "q")
        self.assertEqual(offers, [])
        self.assertTrue(err.startswith("clé SerpApi refusée (HTTP 401 : Invalid API key ***"), err)
        self.assertIn(f"{len(KEY)} caractères, pas 64 hexadécimaux", err)
        self.assertNotIn(KEY, err)
        good = "ab12" * 16
        _, err = search(self.sess(FakeResponse(401, "{}")), good, "q")
        self.assertIn("64 caractères hexadécimaux", err)
        self.assertNotIn(good, err)

    def test_secret_mal_colle_est_nettoye(self):
        self.assertEqual(shopping.clean_key('  "abc"\n'), "abc")
        self.assertEqual(shopping.clean_key(None), "")

    def test_aucun_resultat_n_est_pas_une_erreur(self):
        r = FakeResponse(200, json.dumps({"error": "Google hasn't returned any results for this query."}))
        self.assertEqual(search(self.sess(r), KEY, "q"), ([], ""))


class Filtrage(unittest.TestCase):
    def offers(self):
        return [shopping.ShopOffer("Logitech Z207 Blanc", "Fnac", 56.0, "https://g/1"),
                shopping.ShopOffer("Logitech Z207 Blanc", "Fnac", 54.0, "https://g/2"),
                shopping.ShopOffer("Logitech Z207 Noir", "Darty", 50.0, "https://g/3"),
                shopping.ShopOffer("Logitech Z207 Blanc", "LDLC", 55.0, "https://g/4")]

    def test_nom_valide_un_prix_par_marchand_et_marchands_deja_lus_ecartes(self):
        res = to_results(self.offers(), {"match": ["z207", "blanc|white"], "exclude": []}, {"ldlc"})
        self.assertEqual([(r.retailer, r.value, r.url) for r in res],
                         [("Fnac" + shopping.SUFFIX, 54.0, "https://g/2")])

    def test_quantite_multiplie_le_prix_unitaire(self):
        res = to_results(self.offers()[:2], {"match": ["z207"], "exclude": [], "qty": 3}, set())
        self.assertEqual(res[0].value, 162.0)


class Passage(unittest.TestCase):
    CFG = {"query": "Logitech Z207 blanc", "match": ["z207", "blanc"], "exclude": ["noir"], "qty": 1, "sources": []}

    def shop(self, *offers, error=""):
        calls = []

        def f(q):
            calls.append(q)
            return list(offers), error
        f.calls = calls
        return f

    def go(self, cfg, shop, data=None):
        d = data or load_data()
        f, _, _ = make_fetcher({})
        res = run(d, {"items": {"enceintes": cfg}}, f, TODAY, shop=shop, log=lambda *_: None)
        return d, res

    def test_prix_confirme_par_shopping_reste_stable_et_garde_les_liens(self):
        shop = self.shop(shopping.ShopOffer("Logitech Z207 Blanc", "Fnac", 55.0, "https://www.google.com/s/1"),
                         shopping.ShopOffer("Logitech Z207 Blanc", "Darty", 55.1, "https://www.google.com/s/2"))
        d, res = self.go(self.CFG, shop)
        self.assertEqual(res.decisions["enceintes"].status, "stable")
        self.assertEqual(shop.calls, ["Logitech Z207 blanc"])
        self.assertEqual(len(next(i for i in d["peripherals"] if i["id"] == "enceintes")["offers"]), 2)

    def test_prix_ecrit_et_offres_via_google_shopping(self):
        shop = self.shop(shopping.ShopOffer("Logitech Z207 Blanc", "Fnac", 60.0, "https://www.google.com/s/1"),
                         shopping.ShopOffer("Logitech Z207 Blanc", "Darty", 61.0, "https://www.google.com/s/2"))
        d, res = self.go(self.CFG, shop)
        self.assertEqual(res.decisions["enceintes"].status, "updated")
        item = next(i for i in d["peripherals"] if i["id"] == "enceintes")
        self.assertEqual(item["price"], 60.5)
        self.assertEqual([o["retailer"] for o in item["offers"]], ["Fnac (via Google Shopping)", "Darty (via Google Shopping)"])
        self.assertEqual(check(d)[0], 0, check(d)[1])

    def test_reference_a_valider_jamais_ecrite(self):
        shop = self.shop(shopping.ShopOffer("Logitech Z207 Blanc", "Fnac", 60.0, "https://www.google.com/s/1"),
                         shopping.ShopOffer("Logitech Z207 Blanc", "Darty", 61.0, "https://www.google.com/s/2"))
        d, res = self.go({**self.CFG, "auto": False}, shop)
        x = res.decisions["enceintes"]
        self.assertEqual((x.status, x.reason), ("proposed", "produit de référence à valider"))
        self.assertEqual(next(i for i in d["peripherals"] if i["id"] == "enceintes")["price"], 54.98)

    def test_sans_cle_pas_de_recherche_et_article_sans_source(self):
        _, res = self.go(self.CFG, None)
        self.assertEqual(res.decisions["enceintes"].status, "uncovered")

    def test_erreur_de_l_api_est_dite_dans_la_decision(self):
        _, res = self.go(self.CFG, self.shop(error="quota SerpApi atteint"))
        x = res.decisions["enceintes"]
        self.assertEqual((x.status, x.reason), ("unknown", "quota SerpApi atteint"))

    def test_cle_refusee_arrete_les_recherches_du_passage(self):
        d = load_data()
        f, _, _ = make_fetcher({})
        shop = self.shop(error="clé SerpApi refusée (HTTP 401)")
        run(d, {"items": {i: {**self.CFG} for i in ("enceintes", "lampe", "a24i")}}, f, TODAY,
            shop=shop, log=lambda *_: None)
        self.assertEqual(len(shop.calls), 1)

    def test_prix_stable_en_direct_ne_consomme_aucune_recherche(self):
        d = load_data()
        pages = {"https://a.fr/z": product_html("Logitech Z207 Blanc", "54.98"),
                 "https://b.fr/z": product_html("Logitech Z207 Blanc", "54.98")}
        f, _, _ = make_fetcher(pages)
        cfg = {**self.CFG, "sources": [{"retailer": "A", "url": "https://a.fr/z"}, {"retailer": "B", "url": "https://b.fr/z"}]}
        shop = self.shop()
        res = run(d, {"items": {"enceintes": cfg}}, f, TODAY, shop=shop, log=lambda *_: None)
        self.assertEqual(res.decisions["enceintes"].status, "stable")
        self.assertEqual(shop.calls, [])

    def test_budget_de_recherches(self):
        import update_prices
        d = load_data()
        f, _, _ = make_fetcher({})
        items = {i: {**self.CFG} for i in ("enceintes", "lampe", "a24i")}
        old, update_prices.SHOPPING_BUDGET = update_prices.SHOPPING_BUDGET, 2
        try:
            shop = self.shop()
            run(d, {"items": items}, f, TODAY, shop=shop, log=lambda *_: None)
        finally:
            update_prices.SHOPPING_BUDGET = old
        self.assertEqual(len(shop.calls), 2)


if __name__ == "__main__":
    unittest.main()
