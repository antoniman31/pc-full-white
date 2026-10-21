#!/usr/bin/env python3
"""Pose un numéro de version sur style.css et app.js dans site/index.html.

GitHub Pages laisse les navigateurs garder ces fichiers en mémoire jusqu'à dix minutes (davantage
sur certains téléphones) : après une mise à jour, la page chargeait l'ancien script. Le numéro est
l'empreinte du fichier : il change quand le fichier change, et seulement alors.

    python3 scripts/stamp_assets.py            écrit les numéros dans index.html
    python3 scripts/stamp_assets.py --check    échoue si index.html n'est pas à jour (CI)
"""

import hashlib
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
ASSETS = {
    "style.css": r'(href=")style\.css(?:\?v=[0-9a-f]+)?(")',
    "app.js": r'(src=")app\.js(?:\?v=[0-9a-f]+)?(")',
}


def digest(name: str) -> str:
    return hashlib.sha256((SITE / name).read_bytes()).hexdigest()[:10]


def stamped(html: str) -> str:
    for name, pattern in ASSETS.items():
        html, n = re.subn(pattern, rf"\g<1>{name}?v={digest(name)}\g<2>", html)
        if n != 1:
            raise SystemExit(f"index.html : {name} doit apparaître une seule fois (trouvé {n})")
    return html


def main(argv: list[str]) -> int:
    index = SITE / "index.html"
    html = index.read_text(encoding="utf-8")
    new = stamped(html)
    if "--check" in argv:
        if new != html:
            print("site/index.html n'est pas à jour : lance `python3 scripts/stamp_assets.py` et commite le résultat.")
            return 1
        print("OK : numéros de version de style.css et app.js à jour.")
        return 0
    if new != html:
        index.write_text(new, encoding="utf-8")
        print("site/index.html mis à jour.")
    else:
        print("Déjà à jour.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
