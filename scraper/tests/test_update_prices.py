import copy
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

import fakes
from fakes import load_data, make_fetcher, product_html
from test_recompute import check
from update_prices import main, run, tracked_items
from report import render_report

TODAY = date(2026, 11, 1)
SRC = lambda *pairs: {"sources": [{"retailer": r, "url": u} for r, u in pairs]}


def cfg_cpu(**extra):
    return {"match": ["9800x3d"], "exclude": ["tray"], "qty": 1, **SRC(("A", "https://a.fr/cpu"), ("B", "https://b.fr/cpu")), **extra}


class Passage(unittest.TestCase):
    def test_articles_suivis(self):
        ids = [i for i, _ in tracked_items(load_data())]
        self.assertIn("cpu", ids)
        self.assertNotIn("clavier", ids)            # déjà acheté : figé
        self.assertNotIn("hdd", ids)                # déjà possédé
        self.assertNotIn("cornieres", ids)          # gratuit
        self.assertEqual(len(ids), 29)

    def test_deux_sites_concordants_ecrivent_le_prix_et_gardent_le_fichier_coherent(self):
        d = load_data()
        f, _, _ = make_fetcher({"https://a.fr/cpu": product_html("AMD Ryzen 7 9800X3D Boxed", "459.90"),
                                "https://b.fr/cpu": product_html("Ryzen 7 9800X3D", "460.10")})
        res = run(d, {"items": {"cpu": cfg_cpu()}}, f, TODAY, log=lambda *_: None)
        self.assertEqual(res.decisions["cpu"].status, "updated")
        self.assertEqual(res.applied["cpu"], (444, 459.9))
        self.assertEqual(d["meta"]["last_verified"], "2026-11-01")
        self.assertEqual(d["meta"]["next_verification"], "2026-11-15")
        self.assertEqual(check(d)[0], 0, check(d)[1])

    def test_une_seule_source_est_proposee_et_rien_n_est_ecrit(self):
        d = load_data(); before = copy.deepcopy(d)
        f, _, _ = make_fetcher({"https://a.fr/cpu": product_html("Ryzen 7 9800X3D", "470")})
        res = run(d, {"items": {"cpu": cfg_cpu()}}, f, TODAY, log=lambda *_: None)
        self.assertEqual(res.decisions["cpu"].status, "proposed")
        self.assertEqual(d["budget_summary"], before["budget_summary"])
        self.assertEqual(d["pc_components"][0]["price"], 444)

    def test_un_produit_different_n_est_jamais_retenu(self):
        d = load_data()
        f, _, _ = make_fetcher({"https://a.fr/cpu": product_html("Ryzen 7 9800X3D tray", "430"),
                                "https://b.fr/cpu": product_html("Ryzen 5 7600X", "200")})
        res = run(d, {"items": {"cpu": cfg_cpu()}}, f, TODAY, log=lambda *_: None)
        self.assertEqual(res.decisions["cpu"].status, "unknown")

    def test_essai_a_blanc_ne_modifie_rien(self):
        d = load_data(); before = copy.deepcopy(d)
        f, _, _ = make_fetcher({"https://a.fr/cpu": product_html("Ryzen 7 9800X3D", "459.9"), "https://b.fr/cpu": product_html("Ryzen 7 9800X3D", "460")})
        res = run(d, {"items": {"cpu": cfg_cpu()}}, f, TODAY, dry_run=True, log=lambda *_: None)
        self.assertEqual(res.decisions["cpu"].status, "updated")
        self.assertEqual(d, before)

    def test_selection_partielle_ne_date_pas_le_releve(self):
        d = load_data(); before = copy.deepcopy(d)
        f, _, _ = make_fetcher({"https://a.fr/cpu": product_html("Ryzen 7 9800X3D", "459.9"), "https://b.fr/cpu": product_html("Ryzen 7 9800X3D", "460")})
        run(d, {"items": {"cpu": cfg_cpu()}}, f, TODAY, only={"cpu"}, log=lambda *_: None)
        self.assertEqual(d, before)

    def test_releve_peu_verifie_ne_date_pas_mais_un_prix_ecrit_date(self):
        # 1 article vérifié sur 4 couverts (< 50 %), sans prix modifié : last_verified inchangé
        d = load_data(); before = d["meta"]["last_verified"]
        pages = {"https://a.fr/cpu": product_html("Ryzen 7 9800X3D", "444"), "https://b.fr/cpu": product_html("Ryzen 7 9800X3D", "444.2")}
        items = {"cpu": cfg_cpu()}
        for i in ("cm", "ram", "ssd"):
            items[i] = {"match": [], "exclude": [], **SRC(("A", f"https://a.fr/{i}"), ("B", f"https://b.fr/{i}"))}
        f, _, _ = make_fetcher(pages)
        res = run(d, {"items": items}, f, TODAY, log=lambda *_: None)
        self.assertFalse(res.marked_verified)
        self.assertEqual(d["meta"]["last_verified"], before)
        self.assertEqual(d["meta"]["last_run"]["verified"], 1)

    def test_articles_sans_source_sont_listes_pas_modifies(self):
        d = load_data()
        f, _, _ = make_fetcher({})
        res = run(d, {"items": {}}, f, TODAY, log=lambda *_: None)
        self.assertTrue(all(x.status == "uncovered" for x in res.decisions.values()))
        self.assertIn("sans source", render_report(res))

    def test_rapport_par_site_et_articles(self):
        d = load_data()
        f, _, _ = make_fetcher({"https://a.fr/cpu": product_html("Ryzen 7 9800X3D", "459.9"), "https://b.fr/cpu": 'x'})
        res = run(d, {"items": {"cpu": cfg_cpu()}}, f, TODAY, dry_run=True, log=lambda *_: None)
        text = render_report(res)
        self.assertIn("a.fr", text)
        self.assertIn("b.fr", text)
        self.assertIn("Détail des prix", text)

    def test_cli_ecrit_les_donnees_et_le_rapport(self):
        d = load_data()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            data_path, src_path, rep = tmp / "prices.json", tmp / "sources.json", tmp / "rapport.md"
            data_path.write_text("\n" + json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            src_path.write_text(json.dumps({"items": {"cpu": cfg_cpu()}}), encoding="utf-8")
            import update_prices
            fake_pages = {"https://a.fr/cpu": product_html("Ryzen 7 9800X3D", "459.9"), "https://b.fr/cpu": product_html("Ryzen 7 9800X3D", "460")}
            f, _, _ = make_fetcher(fake_pages)
            original = update_prices.Fetcher
            update_prices.Fetcher = lambda s, delay: f
            try:
                self.assertEqual(main(["--data", str(data_path), "--sources", str(src_path), "--report", str(rep)]), 0)
            finally:
                update_prices.Fetcher = original
            written = data_path.read_text(encoding="utf-8")
            self.assertTrue(written.startswith("\n"))                      # le format du fichier est préservé
            self.assertEqual(json.loads(written)["pc_components"][0]["price"], 459.9)   # le moins cher de 459,90 et 460,00
            self.assertIn("Prix mis à jour", rep.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
