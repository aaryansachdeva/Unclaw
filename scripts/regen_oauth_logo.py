"""Regenerate electron/oauthLogo.ts from src/assets/logo.png.

The OAuth success page (served by Electron's loopback HTTP server in
the user's browser) embeds the UnClaw logo inline as a base64 PNG so
no asset path needs to be resolvable from the main process at runtime.
This script is the source of truth for that embedded copy — run it
whenever the source logo changes.

Usage:
    python scripts/regen_oauth_logo.py
"""

import base64
import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "assets" / "logo.png"
DST = ROOT / "electron" / "oauthLogo.ts"
TARGET = 256  # px on the longer side; keeps base64 ~47KB instead of ~185KB

HEADER = """// UnClaw logo, 256x256 PNG, base64-encoded. Auto-generated from
// src/assets/logo.png by `scripts/regen_oauth_logo.py` — embedded so
// the OAuth success page (rendered inside the user's browser, not the
// renderer) can show the brand mark without any asset-path resolution
// gymnastics.
//
// To regenerate after a logo change, from the repo root:
//   python scripts/regen_oauth_logo.py

export const LOGO_BASE64 =
"""


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source logo at {SRC}")

    img = Image.open(SRC)
    img.thumbnail((TARGET, TARGET), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    DST.write_text(HEADER + f"  '{b64}';\n", encoding="utf-8")
    print(f"wrote {DST.relative_to(ROOT)} ({len(b64)} base64 chars from a "
          f"{img.size[0]}x{img.size[1]} PNG)")


if __name__ == "__main__":
    main()
