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
from recompute import (HISTORY_COLUMNS, apply_updates, find_item, next_run_date, record_history,
                       stamp)


def passage(data, today, updates):
    """Ce que fait un vrai relevé quand des prix changent (voir update_prices.run)."""
    apply_updates(data, updates)
    record_history(data, today)
    stamp(data, today, tracked=29, verified=len(updates), updated=len(updates), mark_verified=True)


def check(data) -> tuple[int, str]:
    """Juge : le vrai scripts/check_prices.py, pas une recopie de ses formules."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        name = f.name
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "check_prices.py"), name],
                       capture_output=True, text=True)
    Path(name).unlink()
    return r.returncode, r.stdout + r.stderr


class Totaux(unittest.TestCase):
    def test_donnees_de_depart_coherentes(self):
        self.assertEqual(check(load_data())[0], 0)

    def test_un_prix_modifie_garde_le_fichier_coherent(self):
        d = load_data()
        passage(d, date(2026, 11, 15), {"cpu": 464, "gpu": 1270, "karlby": 179, "gpro27qi": 310})
        code, out = check(d)
        self.assertEqual(code, 0, out)
        self.assertEqual(find_item(d, "cpu")["price"], 464)

    def test_ecart_applique_au_total_pc_sans_le_remplacer(self):
        d = load_data()
        before = d["budget_summary"]["pc_total"]
        apply_updates(d, {"cpu": 464})                     # +20 €
        self.assertEqual(d["budget_summary"]["pc_total"], round(before + 20, 2))

    def test_un_article_non_pc_ne_touche_pas_le_total_pc(self):
        d = load_data()
        before = d["budget_summary"]["pc_total"]
        apply_updates(d, {"fauteuil": 199, "enceintes": 49.98})
        self.assertEqual(d["budget_summary"]["pc_total"], before)

    def test_recap_des_achats_somme_le_reste_a_acheter(self):
        d = load_data()
        apply_updates(d, {"cpu": 470, "alex1": 74.99, "lampe": 49, "scie_cloche": 16.5})
        total = sum(r["price"] for r in d["purchase_recap"])
        self.assertAlmostEqual(total, d["budget_summary"]["remaining_to_buy"], places=1)

    def test_marges_suivent(self):
        d = load_data()
        apply_updates(d, {"gpu": 1420})
        b, m = d["budget_summary"], d["meta"]
        self.assertAlmostEqual(b["pc_margin"], m["pc_limit"] - b["pc_total"], places=2)
        self.assertAlmostEqual(b["margin_vs_prime"], m["prime_limit"] - b["remaining_to_buy"], places=2)

    def test_article_inconnu(self):
        with self.assertRaises(KeyError):
            apply_updates(load_data(), {"inexistant": 1})

    def test_les_articles_achetes_ne_sont_jamais_modifies(self):
        d = load_data()
        before = copy.deepcopy(d["budget_summary"]["already_bought"])
        apply_updates(d, {"cpu": 460})
        self.assertEqual(d["budget_summary"]["already_bought"], before)


class Historique(unittest.TestCase):
    def test_ajoute_un_releve_et_une_colonne(self):
        d = load_data()
        n_hist, n_dates = len(d["price_history"]), len(d["price_history_dates"])
        apply_updates(d, {"cpu": 464})
        record_history(d, date(2026, 11, 15))
        self.assertEqual(len(d["price_history"]), n_hist + 1)
        self.assertEqual(d["price_history"][-1]["date"], "2026-11-15")
        self.assertEqual(d["price_history_dates"][-1], "15/11")
        for c in d["price_history_components"]:
            self.assertEqual(len(c["series"]), len(d["price_history_dates"]), c["component"])
            self.assertEqual(c["series"][-1], c["current"])
        self.assertEqual(find_item(d, "cpu")["price"], d["price_history_components"][0]["current"])
        self.assertEqual(d["price_history_total_series"][-1], round(d["budget_summary"]["pc_total"]))

    def test_relance_le_meme_jour_remplace_au_lieu_d_ajouter(self):
        d = load_data()
        passage(d, date(2026, 11, 15), {"cpu": 464})
        n_hist, n_dates = len(d["price_history"]), len(d["price_history_dates"])
        passage(d, date(2026, 11, 15), {"cpu": 470})
        self.assertEqual((len(d["price_history"]), len(d["price_history_dates"])), (n_hist, n_dates))
        self.assertEqual(d["price_history_components"][0]["current"], 470)
        self.assertEqual(check(d)[0], 0)

    def test_le_tableau_garde_au_plus_ref_plus_sept_releves(self):
        d = load_data()
        for jour in range(1, 13):                           # douze relevés d'affilée
            passage(d, date(2027, jour, 15), {"cpu": 450 + jour})
        self.assertEqual(len(d["price_history_dates"]), HISTORY_COLUMNS)
        self.assertEqual(d["price_history_dates"][0], "Réf.")
        self.assertEqual(d["price_history_dates"][-1], "15/12")
        for c in d["price_history_components"]:
            self.assertEqual(len(c["series"]), HISTORY_COLUMNS)
            self.assertEqual(c["series"][0], c["ref"])       # la référence initiale n'est jamais perdue
        self.assertEqual(check(d)[0], 0)

    def test_evolution_et_tendance(self):
        d = load_data()
        apply_updates(d, {"cpu": 500})
        record_history(d, date(2026, 11, 15))
        cpu = d["price_history_components"][0]
        self.assertEqual((cpu["evolution"], cpu["trend"]), (500 - cpu["ref"], "up"))


class Calendrier(unittest.TestCase):
    def test_prochain_passage_est_le_1er_ou_le_15(self):
        for today, expected in [(date(2026, 10, 21), date(2026, 11, 1)), (date(2026, 11, 1), date(2026, 11, 15)),
                                (date(2026, 11, 15), date(2026, 12, 1)), (date(2026, 12, 20), date(2027, 1, 1)),
                                (date(2027, 1, 1), date(2027, 1, 15))]:
            self.assertEqual(next_run_date(today), expected, today)

    def test_stamp_date_le_releve_seulement_si_assez_verifie(self):
        d = load_data(); before = d["meta"]["last_verified"]
        stamp(d, date(2026, 11, 1), tracked=29, verified=2, updated=0, mark_verified=False)
        self.assertEqual(d["meta"]["last_verified"], before)
        self.assertEqual(d["meta"]["last_run"], {"date": "2026-11-01", "tracked": 29, "verified": 2, "updated": 0})
        self.assertEqual(d["meta"]["next_verification"], "2026-11-15")
        stamp(d, date(2026, 11, 1), 29, 20, 1, mark_verified=True)
        self.assertEqual(d["meta"]["last_verified"], "2026-11-01")


if __name__ == "__main__":
    unittest.main()
