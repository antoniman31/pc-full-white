import unittest

import fakes
from fakes import FakeResponse, make_fetcher, product_html
from fetch import USER_AGENT, looks_blocked

ROBOTS_OK = "User-agent: *\nDisallow: /panier\n"


class Politesse(unittest.TestCase):
    def test_robots_interdit_la_page_n_est_pas_lue(self):
        f, session, _ = make_fetcher({"https://s.fr/robots.txt": "User-agent: *\nDisallow: /fiche/\n",
                                      "https://s.fr/fiche/1": "<html></html>"})
        r = f.get("https://s.fr/fiche/1")
        self.assertEqual(r.status, "robots")
        self.assertNotIn("https://s.fr/fiche/1", session.calls)

    def test_robots_403_le_site_nous_ferme_la_porte(self):
        f, session, _ = make_fetcher({"https://s.fr/robots.txt": FakeResponse(403), "https://s.fr/p": "x"})
        self.assertEqual(f.get("https://s.fr/p").status, "bloque")
        self.assertNotIn("https://s.fr/p", session.calls)

    def test_robots_404_tout_est_permis(self):
        f, _, _ = make_fetcher({"https://s.fr/p": "<html>ok</html>"})
        r = f.get("https://s.fr/p")
        self.assertEqual((r.status, r.text), ("ok", "<html>ok</html>"))

    def test_robots_indisponible_on_ne_devine_pas(self):
        f, _, _ = make_fetcher({"https://s.fr/robots.txt": FakeResponse(500), "https://s.fr/p": "x"})
        self.assertEqual(f.get("https://s.fr/p").status, "reseau")

    def test_robots_lent_une_seconde_chance_et_la_cause_est_dite(self):
        from fakes import FakeResponse
        reponses = iter([TimeoutError(), FakeResponse(200, "User-agent: *\nDisallow:\n")])

        def robots():
            r = next(reponses)
            if isinstance(r, Exception):
                raise r
            return r
        f, _, _ = make_fetcher({"https://s.fr/robots.txt": robots, "https://s.fr/p": product_html("X", 5)})
        self.assertEqual(f.get("https://s.fr/p").status, "ok")
        f2, _, _ = make_fetcher({"https://s.fr/robots.txt": FakeResponse(503), "https://s.fr/p": "x"})
        r = f2.get("https://s.fr/p")
        self.assertEqual((r.status, r.detail), ("reseau", "robots.txt indisponible (HTTP 503)"))

    def test_robots_lu_une_seule_fois_par_site(self):
        f, session, _ = make_fetcher({"https://s.fr/robots.txt": ROBOTS_OK, "https://s.fr/a": "a", "https://s.fr/b": "b"})
        f.get("https://s.fr/a"); f.get("https://s.fr/b")
        self.assertEqual(session.calls.count("https://s.fr/robots.txt"), 1)

    def test_cadence_par_site(self):
        f, _, clock = make_fetcher({"https://s.fr/robots.txt": ROBOTS_OK, "https://s.fr/a": "a", "https://s.fr/b": "b"}, delay=3.0)
        f.get("https://s.fr/a"); f.get("https://s.fr/b")
        self.assertEqual(clock.slept, [3.0, 3.0])         # page a après robots.txt, puis page b

    def test_deux_sites_differents_ne_s_attendent_pas(self):
        f, _, clock = make_fetcher({"https://a.fr/x": "x", "https://b.fr/x": "x"})
        f.get("https://a.fr/x"); f.get("https://b.fr/x")
        # un délai (robots.txt → page) par site, et aucun entre les deux sites : la cadence est par site
        self.assertEqual(clock.slept, [3.0, 3.0])

    def test_crawl_delay_du_site_prime_s_il_est_plus_long(self):
        f, _, clock = make_fetcher({"https://s.fr/robots.txt": "User-agent: *\nCrawl-delay: 10\n", "https://s.fr/a": "a"}, delay=3.0)
        f.get("https://s.fr/a")
        self.assertEqual(clock.slept, [10.0])

    def test_une_seule_nouvelle_tentative_sur_429(self):
        calls = {"n": 0}

        def page():
            calls["n"] += 1
            return FakeResponse(429, "", {"Retry-After": "7"}) if calls["n"] == 1 else FakeResponse(200, "<html>ok</html>")
        f, _, clock = make_fetcher({"https://s.fr/p": page})
        self.assertEqual(f.get("https://s.fr/p").status, "ok")
        self.assertEqual(calls["n"], 2)
        self.assertIn(7.0, clock.slept)

    def test_429_persistant_reste_bloque_sans_boucle(self):
        calls = {"n": 0}

        def page():
            calls["n"] += 1
            return FakeResponse(429)
        f, _, _ = make_fetcher({"https://s.fr/p": page})
        self.assertEqual(f.get("https://s.fr/p").status, "bloque")
        self.assertEqual(calls["n"], 2)

    def test_codes_http_et_reseau(self):
        f, _, _ = make_fetcher({"https://s.fr/403": FakeResponse(403), "https://s.fr/404": FakeResponse(404),
                                "https://s.fr/500": FakeResponse(500), "https://s.fr/boom": ConnectionError("x")})
        self.assertEqual(f.get("https://s.fr/403").status, "bloque")
        self.assertEqual(f.get("https://s.fr/404").status, "introuvable")
        self.assertEqual(f.get("https://s.fr/500").status, "erreur_http")
        self.assertEqual(f.get("https://s.fr/boom").status, "reseau")

    def test_url_invalide(self):
        f, _, _ = make_fetcher({})
        self.assertEqual(f.get("ftp://x").status, "erreur_http")

    def test_le_script_s_identifie_franchement(self):
        self.assertIn("pc-full-white-price-check", USER_AGENT)
        self.assertNotIn("Mozilla", USER_AGENT)

    def test_pages_de_blocage_detectees(self):
        self.assertTrue(looks_blocked("<title>Just a moment...</title>"))
        self.assertTrue(looks_blocked("Please complete the CAPTCHA"))
        self.assertFalse(looks_blocked("<html>Ryzen 7 9800X3D</html>"))


if __name__ == "__main__":
    unittest.main()
