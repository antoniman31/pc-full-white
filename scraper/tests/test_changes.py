"""Changements saisis sur le site : appliqués à prices.json sans le rendre incohérent."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

import fakes
from fakes import ROOT, load_data
from test_recompute import check

from aggregate import SourceResult
from changes import apply_changes, clean_changes, derive_cfg, load_changes
from recompute import find_item
from update_prices import effective_cfg, load_sources, run, tracked_items


def changes(items=None, added=None):
    return clean_changes({"version": 1, "items": items or {}, "added": added or []})


def applique(items=None, added=None):
    d = load_data()
    log = apply_changes(d, changes(items, added))
    return d, log


class Validation(unittest.TestCase):
    def test_version_inconnue_refusee(self):
        with self.assertRaises(ValueError):
            clean_changes({"version": 2})

    def test_entrees_douteuses_ecartees(self):
        c = clean_changes({"version": 1, "items": {
            "cpu": {"status": "bought", "paid": -5},
            "__proto__": {"status": "to_buy"},
            "ssd": {"status": "bought", "paid": 100, "vendor": "x" * 200, "date": "pas une date"},
            "../x": {"deleted": True},
        }, "added": [{"id": "ok-1", "section": "pc_components", "name": "Câble", "price": 5},
                     {"id": "ok-1", "section": "pc_components", "name": "doublon"},
                     {"id": "x", "section": "inconnue", "name": "n"},
                     {"id": "y", "section": "mobilier", "name": ""}]})
        self.assertEqual(set(c["items"]), {"ssd"})
        self.assertEqual(len(c["items"]["ssd"]["vendor"]), 60)
        self.assertEqual(c["items"]["ssd"]["date"], "")
        self.assertEqual([a["id"] for a in c["added"]], ["ok-1"])

    def test_fichier_absent_ne_change_rien(self):
        self.assertEqual(load_changes(Path("/nulle/part.json")), {"version": 1, "items": {}, "added": []})


class Application(unittest.TestCase):
    def test_sans_changement_rien_ne_bouge(self):
        d = load_data()
        avant = copy.deepcopy(d)
        self.assertEqual(apply_changes(d, changes()), [])
        self.assertEqual(d, avant)

    def test_achat_fige_le_prix_et_sort_du_reste_a_acheter(self):
        d0 = load_data()
        cpu = find_item(d0, "cpu")["price"]
        d, log = applique({"cpu": {"status": "bought", "paid": 400, "date": "2026-10-21", "vendor": "TopAchat"}})
        item = find_item(d, "cpu")
        self.assertEqual((item["status"], item["price"], item["vendor"], item["price_released"]), ("bought", 400, "TopAchat", cpu))
        b0, b = d0["budget_summary"], d["budget_summary"]
        self.assertAlmostEqual(b["remaining_to_buy"], b0["remaining_to_buy"] - cpu, 2)
        self.assertAlmostEqual(b["already_bought"], b0["already_bought"] + 400, 2)
        self.assertEqual(check(d)[0], 0, check(d)[1])
        self.assertNotIn("cpu", [i for i, _ in tracked_items(d)])

    def test_achat_annule_rend_le_prix_releve(self):
        d, _ = applique({"cpu": {"status": "bought", "paid": 400, "date": "", "vendor": ""}})
        apply_changes(d, changes({"cpu": {"status": "to_buy"}}))
        item = find_item(d, "cpu")
        self.assertEqual((item["status"], item["price"]), ("to_buy", load_data()["pc_components"][0]["price"]))
        self.assertNotIn("vendor", item)
        self.assertEqual(check(d)[0], 0, check(d)[1])

    def test_application_idempotente(self):
        items = {"cpu": {"status": "bought", "paid": 400, "date": "2026-10-21", "vendor": "x"},
                 "ssd": {"price": 450}, "clavier": {"deleted": True}}
        added = [{"id": "user-1", "section": "mobilier", "name": "Tapis", "price": 30}]
        d, _ = applique(items, added)
        deux = copy.deepcopy(d)
        apply_changes(deux, changes(items, added))
        self.assertEqual(deux, d)

    def test_prix_saisi_a_la_main_est_marque_et_compte(self):
        d, _ = applique({"ssd": {"price": 450}})
        ssd = find_item(d, "ssd")
        self.assertEqual((ssd["price"], ssd["price_manual"]), (450, True))
        self.assertEqual(check(d)[0], 0, check(d)[1])
        apply_changes(d, changes({"ssd": {"price": None}}))
        self.assertNotIn("price_manual", find_item(d, "ssd"))

    def test_produit_change_abandonne_offres_et_marque_l_article(self):
        d0 = load_data()
        find_item(d0, "boitier")["offers"] = [{"retailer": "X", "url": "https://x.fr", "price": 1, "seen": "2026-10-01"}]
        apply_changes(d0, changes({"boitier": {"name": "Fractal North", "model": "Fractal North blanc"}}))
        item = find_item(d0, "boitier")
        self.assertEqual((item["name"], item["model"], item["offers"], item["product_changed"]),
                         ("Fractal North", "Fractal North blanc", [], True))

    def test_suppression_retire_l_article_des_totaux_et_de_l_historique(self):
        d, _ = applique({"cpu": {"deleted": True}})
        self.assertIsNone(find_item(d, "cpu"))
        self.assertIn("cpu", d["meta"]["removed_items"])
        self.assertEqual(check(d)[0], 0, check(d)[1])
        self.assertFalse([c for c in d["price_history_components"] if c.get("refs") == ["cpu"]])

    def test_article_ajoute_compte_dans_son_onglet_et_dans_le_recap(self):
        d0 = load_data()
        d, _ = applique(added=[{"id": "user-1", "section": "mobilier", "name": "Tapis", "price": 30, "model": "bleu"},
                               {"id": "user-2", "section": "pc_components", "name": "Câble SATA", "price": 8}])
        self.assertEqual(find_item(d, "user-1")["model"], "bleu")
        self.assertTrue(find_item(d, "user-2")["user"])
        b0, b = d0["budget_summary"], d["budget_summary"]
        self.assertAlmostEqual(b["remaining_to_buy"], b0["remaining_to_buy"] + 38, 2)
        self.assertAlmostEqual(b["pc_total"], b0["pc_total"] + 8, 2)
        self.assertEqual(check(d)[0], 0, check(d)[1])
        recap = [r for r in d["purchase_recap"] if r["refs"] == ["recap_added"]]
        self.assertEqual([r["price"] for r in recap], [30])

    def test_article_ajoute_puis_achete_sort_du_recap(self):
        d, _ = applique({"user-1": {"status": "bought", "paid": 25, "date": "", "vendor": ""}},
                        [{"id": "user-1", "section": "mobilier", "name": "Tapis", "price": 30}])
        self.assertFalse([r for r in d["purchase_recap"] if r["refs"] == ["recap_added"]])
        self.assertEqual(check(d)[0], 0, check(d)[1])


class Suivi(unittest.TestCase):
    def test_configuration_derivee_du_nom(self):
        cfg = derive_cfg({"name": "Câble SATA", "model": "Corsair Premium 45 cm", "source_url": "https://www.ldlc.com/fiche/x.html"})
        self.assertEqual(cfg["query"], "Câble SATA Corsair Premium 45 cm")
        self.assertIn("corsair", cfg["match"])
        self.assertEqual(cfg["sources"], [{"retailer": "ldlc", "url": "https://www.ldlc.com/fiche/x.html"}])
        self.assertIs(cfg["auto"], False)

    def test_article_ajoute_ou_change_ignore_sources_json_et_n_est_jamais_ecrit_seul(self):
        item = {"id": "boitier", "name": "Fractal North", "product_changed": True}
        cfg = effective_cfg(item, {"query": "ancien", "sources": [{"retailer": "x", "url": "https://x.fr"}]})
        self.assertEqual(cfg["query"], "Fractal North")
        self.assertIs(cfg["auto"], False)

    def test_prix_saisi_a_la_main_jamais_ecrase(self):
        cfg = effective_cfg({"id": "ssd", "price_manual": True}, {"query": "q", "sources": []})
        self.assertIs(cfg["auto"], False)

    def test_article_sans_prix_ajoute_est_suivi(self):
        d, _ = applique(added=[{"id": "user-1", "section": "mobilier", "name": "Tapis", "price": 0}])
        self.assertIn("user-1", [i for i, _ in tracked_items(d)])

    def test_sources_d_un_article_supprime_ne_bloquent_pas_le_releve(self):
        d, _ = applique({"cpu": {"deleted": True}})
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "sources.json"
            p.write_text(json.dumps({"items": {"cpu": {"sources": []}, "ssd": {"sources": []}}}), encoding="utf-8")
            self.assertEqual(set(load_sources(p, d)["items"]), {"ssd"})

    def test_le_releve_propose_sans_ecrire_pour_un_prix_saisi_a_la_main(self):
        d, _ = applique({"ssd": {"price": 450}})
        srcs = {"items": {"ssd": {"sources": [{"retailer": "a", "url": "https://a.fr/x"}, {"retailer": "b", "url": "https://b.fr/x"}]}}}
        import update_prices
        original = update_prices.read_source
        update_prices.read_source = lambda f, s, c: SourceResult(s["retailer"], s["url"], "ok", value=480.0)
        try:
            res = run(d, srcs, None, date(2026, 11, 1), only=None, dry_run=True, log=lambda *_: None)
        finally:
            update_prices.read_source = original
        dec = res.decisions["ssd"]
        self.assertEqual((dec.status, dec.new), ("proposed", 480.0))
        self.assertIn("à la main", dec.reason)


class Script(unittest.TestCase):
    def test_script_applique_et_est_idempotent(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            (t / "prices.json").write_text(json.dumps(load_data(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (t / "changes.json").write_text(json.dumps({"version": 1, "items": {"cpu": {"status": "bought", "paid": 400}}}), encoding="utf-8")
            cmd = [sys.executable, str(ROOT / "scripts" / "apply_changes.py"), "--data", str(t / "prices.json"), "--changes", str(t / "changes.json")]
            un = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(un.returncode, 0, un.stdout + un.stderr)
            self.assertIn("acheté : CPU", un.stdout)
            self.assertEqual(check(json.loads((t / "prices.json").read_text(encoding="utf-8")))[0], 0)
            deux = subprocess.run(cmd, capture_output=True, text=True)
            self.assertIn("Rien à changer", deux.stdout)

    def test_script_refuse_un_fichier_invalide(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t)
            (t / "prices.json").write_text(json.dumps(load_data()), encoding="utf-8")
            (t / "changes.json").write_text('{"version": 9}', encoding="utf-8")
            r = subprocess.run([sys.executable, str(ROOT / "scripts" / "apply_changes.py"), "--data", str(t / "prices.json"),
                                "--changes", str(t / "changes.json")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main()
