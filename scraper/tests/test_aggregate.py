import unittest

import fakes  # noqa: F401
from aggregate import SourceResult, decide, has_token, pick_quote
from extract import Quote


def q(price, name="X", currency="EUR", available=None, index=0):
    return Quote(price, currency, available, name, "json-ld", index)


def src(value, retailer="A"):
    return SourceResult(retailer, f"https://{retailer}.example/p", "ok", value=value, quote=q(value))


class Tokens(unittest.TestCase):
    def test_alternatives_accents_ponctuation(self):
        self.assertTrue(has_token("ASUS ROG STRIX B850-A GAMING", "B850 A"))
        self.assertTrue(has_token("Corsair Vengeance Blanc", "blanc|white"))
        self.assertFalse(has_token("Corsair Vengeance Black", "blanc|white"))
        self.assertTrue(has_token("Fauteuil MATCHSPEL Bomstad", "bomstad"))
        self.assertTrue(has_token("Plan de travail chêne", "chene"))

    def test_mot_court_doit_etre_un_mot_entier(self):
        self.assertFalse(has_token("Cacao", "ca"))
        self.assertFalse(has_token("Ventilateur Setup", "set"))
        self.assertTrue(has_token("Lot de 3 ventilateurs", "lot"))
        self.assertTrue(has_token("Samsung 990 PRO 2 To", "2 to|2tb"))


class PickQuote(unittest.TestCase):
    def test_garde_le_bon_produit(self):
        quote, _ = pick_quote([q(444, "AMD Ryzen 7 9800X3D Boxed")], ["9800x3d"], ["tray"])
        self.assertEqual(quote.price, 444)

    def test_ecarte_une_variante_ou_un_kit(self):
        quote, why = pick_quote([q(500, "Ryzen 7 9800X3D + MSI B850 kit")], ["9800x3d"], ["kit"])
        self.assertIsNone(quote)
        self.assertIn("produit différent", why)
        quote, why = pick_quote([q(400, "Ryzen 7 9700X")], ["9800x3d"], [])
        self.assertIsNone(quote)
        self.assertIn("manque", why)

    def test_ecarte_hors_stock_et_devise_etrangere(self):
        self.assertIsNone(pick_quote([q(444, available=False)], [], [])[0])
        self.assertIsNone(pick_quote([q(444, currency="USD")], [], [])[0])
        self.assertIn("hors stock", pick_quote([q(444, available=False)], [], [])[1])

    def test_prend_le_premier_produit_qui_correspond_pas_la_suggestion(self):
        quotes = [q(100, "Carrousel", index=0), q(449, "Ryzen 7 9800X3D", index=1), q(9, "Ryzen 7 9800X3D accessoire", index=2)]
        quote, _ = pick_quote(quotes, ["9800x3d"], [])
        self.assertEqual(quote.price, 449)

    def test_nom_absent_accepte(self):
        quote, _ = pick_quote([q(50, name=None)], ["x"], [])
        self.assertEqual(quote.price, 50)

    def test_prix_le_plus_bas_parmi_les_offres_du_meme_produit(self):
        quote, _ = pick_quote([q(460, "P", index=0), q(449, "P", index=0)], [], [])
        self.assertEqual(quote.price, 449)


class Decide(unittest.TestCase):
    def test_deux_sites_concordants_le_moins_cher_est_retenu(self):
        d = decide(444, [src(449.9, "A"), src(450.1, "B")])
        self.assertEqual((d.status, d.new), ("updated", 449.9))
        self.assertEqual(len(d.used), 2)

    def test_variation_negligeable_est_stable(self):
        d = decide(444, [src(444.5, "A"), src(443.8, "B")])
        self.assertEqual(d.status, "stable")

    def test_une_seule_source_est_proposee_jamais_appliquee(self):
        d = decide(444, [src(450, "A")])
        self.assertEqual(d.status, "proposed")
        self.assertIn("source valide", d.reason)

    def test_un_site_aberrant_est_ecarte(self):
        d = decide(444, [src(450, "A"), src(452, "B"), src(300, "C")])
        self.assertEqual(d.status, "updated")
        self.assertEqual(d.new, 450)
        self.assertEqual({r.retailer for r in d.used}, {"A", "B"})

    def test_saut_trop_grand_propose_sans_appliquer(self):
        d = decide(444, [src(640, "A"), src(650, "B")])      # +46 %
        self.assertEqual(d.status, "proposed")
        self.assertIn("variation", d.reason)

    def test_releve_hors_plage_est_ecarte(self):
        d = decide(444, [src(40, "A"), src(45, "B")])
        self.assertEqual(d.status, "unknown")

    def test_aucune_source_exploitable(self):
        d = decide(444, [SourceResult("A", "u", "bloque"), SourceResult("B", "u", "sans_prix")])
        self.assertEqual(d.status, "unknown")

    def test_min_sources_a_un_pour_un_vendeur_unique(self):
        d = decide(169, [src(179, "ikea")], {"min_sources": 1})
        self.assertEqual((d.status, d.new), ("updated", 179))

    def test_sources_qui_divergent_le_moins_cher_est_affiche(self):
        # 400 € et 500 € : on affiche 400 €, 500 € reste dans « Où acheter ».
        d = decide(444, [src(400, "A"), src(500, "B")])
        self.assertEqual((d.status, d.new), ("updated", 400))
        self.assertEqual({r.retailer for r in d.used}, {"A", "B"})

    def test_prix_absurde_ecarte_le_moins_cher_sain_est_retenu(self):
        # 300 € contre une médiane à 450 € (< 70 %) : autre produit ou erreur, écarté.
        d = decide(444, [src(300, "A"), src(450, "B"), src(455, "C")])
        self.assertEqual((d.status, d.new), ("updated", 450))
        self.assertEqual({r.retailer for r in d.used}, {"B", "C"})

    def test_le_moins_cher_est_retenu_meme_loin_des_autres(self):
        d = decide(444, [src(440, "A"), src(446, "B"), src(455, "C"), src(600, "D")])
        self.assertEqual(d.new, 440)
        self.assertEqual({r.retailer for r in d.used}, {"A", "B", "C", "D"})


if __name__ == "__main__":
    unittest.main()
