"""Les fichiers du site portent un numéro de version : sans lui, un navigateur garde l'ancien script."""
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import stamp_assets  # noqa: E402


class StampAssets(unittest.TestCase):
    def test_index_est_a_jour(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "stamp_assets.py"), "--check"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_les_deux_fichiers_portent_leur_empreinte(self):
        html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        for name in ("style.css", "app.js"):
            self.assertIn(f"{name}?v={stamp_assets.digest(name)}", html)

    def test_remplacement_idempotent_et_sensible_au_contenu(self):
        html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertEqual(stamp_assets.stamped(html), html)
        vieux = re.sub(r"\?v=[0-9a-f]+", "?v=0000000000", html)
        self.assertNotEqual(stamp_assets.stamped(vieux), vieux)

    def test_page_sans_balise_est_refusee(self):
        with self.assertRaises(SystemExit):
            stamp_assets.stamped("<html></html>")


if __name__ == "__main__":
    unittest.main()
