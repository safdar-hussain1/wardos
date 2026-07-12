#!/usr/bin/env python3
"""Bake docs/data/dashboard.json into docs/index.html.

The dashboard is a single self-contained file with its data inlined, so it works
from the filesystem as well as from GitHub Pages and cannot drift from the export.

Regenerate the whole chain with:

    java -jar target/health-haven.jar export docs/data/dashboard.json
    python3 scripts/build_dashboard.py
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "docs" / "index.template.html"
DATA = ROOT / "docs" / "data" / "dashboard.json"
OUTPUT = ROOT / "docs" / "index.html"
PLACEHOLDER = "/*__DATA__*/{}"


def main() -> int:
    if not DATA.exists():
        sys.exit(f"missing {DATA} — run: java -jar target/health-haven.jar export")

    template = TEMPLATE.read_text(encoding="utf-8")
    if PLACEHOLDER not in template:
        sys.exit(f"placeholder {PLACEHOLDER!r} not found in {TEMPLATE}")

    # Re-serialise compactly; </script> inside a string would end the block early.
    payload = json.dumps(json.loads(DATA.read_text(encoding="utf-8")),
                         separators=(",", ":")).replace("</", "<\\/")

    OUTPUT.write_text(template.replace(PLACEHOLDER, payload), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
