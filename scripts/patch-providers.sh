#!/usr/bin/env python3
"""
OmniRoute Custom Provider Catalog Patcher
==========================================
Idempotently injects custom provider entries into OmniRoute's compiled JS
bundles after any `npm install -g omniroute` update.

Why this exists:
  OmniRoute has no external config file for the provider catalog — it's
  hardcoded in compiled .next/*.js. This script re-applies the patch so
  custom providers appear in the UI "Add Provider" dropdown.

What this patches vs what survives naturally:
  - Provider CONNECTIONS (routing) → stored in ~/.omniroute/storage.sqlite
    ✅ Survives updates automatically. No patching needed.
  - Provider CATALOG (UI dropdown entries) → compiled into .next/*.js
    ❌ Wiped on npm reinstall. This script re-applies them.

Usage:
  ./patch-providers.sh          # patch current install
  ./patch-providers.sh --check  # dry-run, show what would be patched
  ./patch-providers.sh --status # show current patch status

Author: openclaw / auto-generated
"""

import sys
import os
import glob
import json
from pathlib import Path

# ─── Configuration ──────────────────────────────────────────────────────────

OMNIROUTE_DIR = Path(os.environ.get(
    "OMNIROUTE_NPM_DIR",
    "/home/openclaw/.npm-global/lib/node_modules/omniroute"
))
NEXT_DIR = OMNIROUTE_DIR / "app" / ".next"

# Anchor: the last built-in provider entry in the compiled catalog.
# We insert our providers immediately after this string.
ANCHOR = '"tavily-search":{id:"tavily-search",alias:"tavily-search",name:"Tavily Search",icon:"manage_search",color:"#5B4FDB",textIcon:"TV",website:"https://tavily.com",authHint:"API key from app.tavily.com (format: tvly-...)"}'

# Sentinel: used to detect if patch is already applied (check for first entry)
SENTINEL = "byteplus:"

# ─── Custom Providers ────────────────────────────────────────────────────────
# Each entry must satisfy OmniRoute's providerSchema:
#   required: id, alias, name, icon (Material icon), color (#RRGGBB)
#   optional: textIcon, website, passthroughModels, hasFree, freeNote, apiHint

CUSTOM_PROVIDERS = [
    # ── From berkahkarya-saas-bot: video generation ──────────────────────────
    {
        "id": "byteplus",
        "alias": "bp",
        "name": "BytePlus (Seedance)",
        "icon": "video_library",
        "color": "#1E9BF0",
        "textIcon": "BP",
        "website": "https://www.byteplus.com",
        "apiHint": "API key from BytePlus Ark console — Seedance video gen + LLM",
    },
    {
        "id": "laozhang",
        "alias": "lz",
        "name": "LaoZhang AI",
        "icon": "movie",
        "color": "#E53E3E",
        "textIcon": "LZ",
        "website": "https://api.laozhang.ai",
        "apiHint": "OpenAI-compatible Sora/video proxy (sk-...)",
    },
    {
        "id": "evolink",
        "alias": "ev",
        "name": "EvoLink",
        "icon": "videocam",
        "color": "#00C853",
        "textIcon": "EV",
        "website": "https://api.evolink.ai",
        "apiHint": "Async webhook-based video generation (sk-...)",
    },
    {
        "id": "hypereal",
        "alias": "hr",
        "name": "Hypereal AI",
        "icon": "hd",
        "color": "#7C4DFF",
        "textIcon": "HR",
        "website": "https://api.hypereal.tech",
        "apiHint": "Kling-3.0-based text/image-to-video (ck_...)",
    },
    {
        "id": "kie",
        "alias": "kie",
        "name": "Kie.ai",
        "icon": "theaters",
        "color": "#F06292",
        "textIcon": "KI",
        "website": "https://kie.ai",
        "apiHint": "Runway-based video generation",
    },
    # ── From berkahkarya-saas-bot: image generation ──────────────────────────
    {
        "id": "falai",
        "alias": "fal",
        "name": "Fal.ai",
        "icon": "speed",
        "color": "#FF6B00",
        "textIcon": "FL",
        "website": "https://fal.ai",
        "apiHint": "Queue-based image + video generation (key:secret format)",
    },
    {
        "id": "replicate",
        "alias": "rep",
        "name": "Replicate",
        "icon": "repeat",
        "color": "#222222",
        "textIcon": "RP",
        "website": "https://replicate.com",
        "apiHint": "Image (FLUX) and video (CogVideoX) generation (r8_...)",
    },
    # ── From openclaw providers ──────────────────────────────────────────────
    {
        "id": "vastai",
        "alias": "vast",
        "name": "Vast.ai GPU",
        "icon": "memory",
        "color": "#0F9D58",
        "textIcon": "VA",
        "website": "https://vast.ai",
        "apiHint": "On-demand GPU for CogVideoX and other video models",
    },
    {
        "id": "tinker",
        "alias": "tinker",
        "name": "Tinker (Thinking Machines)",
        "icon": "psychology",
        "color": "#6366F1",
        "textIcon": "TK",
        "website": "https://thinkingmachin.es",
        "apiHint": "API key from Thinking Machines AI — Philippine AI provider (tml-...)",
    },
    # ── OpenCode Zen provider ──────────────────────────────────────────────────
    {
        "id": "opencode-zen",
        "alias": "oczen",
        "name": "OpenCode Zen",
        "icon": "terminal",
        "color": "#00E676",
        "textIcon": "OZ",
        "website": "https://opencode.ai/zen",
        "apiHint": "OpenCode Zen API key (oczen_...)",
    },
]


def _build_js_entry(p: dict) -> str:
    """Serialize a provider dict to compact JS object literal."""
    parts = [
        f'id:{json.dumps(p["id"])}',
        f'alias:{json.dumps(p["alias"])}',
        f'name:{json.dumps(p["name"])}',
        f'icon:{json.dumps(p["icon"])}',
        f'color:{json.dumps(p["color"])}',
    ]
    if "textIcon" in p:
        parts.append(f'textIcon:{json.dumps(p["textIcon"])}')
    if "website" in p:
        parts.append(f'website:{json.dumps(p["website"])}')
    if "apiHint" in p:
        parts.append(f'apiHint:{json.dumps(p["apiHint"])}')
    if p.get("passthroughModels"):
        parts.append("passthroughModels:!0")
    if p.get("hasFree"):
        parts.append("hasFree:!0")
    if "freeNote" in p:
        parts.append(f'freeNote:{json.dumps(p["freeNote"])}')
    return f'{p["id"]}:{{{",".join(parts)}}}'


def _build_injection() -> str:
    """Build the full injection string (comma-separated provider entries)."""
    return "," + ",".join(_build_js_entry(p) for p in CUSTOM_PROVIDERS)


def find_patchable_files() -> list:
    """Find all compiled JS files that contain the anchor but lack the sentinel."""
    if not NEXT_DIR.exists():
        return []
    results = []
    for path in NEXT_DIR.rglob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            if ANCHOR in text and SENTINEL not in text:
                results.append(path)
        except OSError:
            pass
    return results


def find_already_patched() -> list:
    """Find files that already have the patch applied."""
    if not NEXT_DIR.exists():
        return []
    results = []
    for path in NEXT_DIR.rglob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            if ANCHOR in text and SENTINEL in text:
                results.append(path)
        except OSError:
            pass
    return results


URL_FIXES = [
    ("https://api.ollama.com/v1/", "https://ollama.com/v1/"),
]

SOURCE_FIXES = [
    (
        OMNIROUTE_DIR / "app" / "open-sse" / "config" / "providerRegistry.ts",
        "https://api.ollama.com/v1/",
        "https://ollama.com/v1/",
    ),
]


def apply_url_fixes(dry_run: bool = False) -> int:
    fixed = 0
    for path in NEXT_DIR.rglob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
            new_text = text
            for old, new in URL_FIXES:
                new_text = new_text.replace(old, new)
            if new_text != text:
                if not dry_run:
                    path.write_text(new_text, encoding="utf-8")
                fixed += 1
        except OSError:
            pass
    for src_path, old, new in SOURCE_FIXES:
        if src_path.exists():
            try:
                text = src_path.read_text(encoding="utf-8", errors="ignore")
                if old in text:
                    if not dry_run:
                        src_path.write_text(text.replace(old, new), encoding="utf-8")
                    fixed += 1
            except OSError:
                pass
    return fixed


def apply_patches(dry_run: bool = False) -> dict:
    injection = _build_injection()
    to_patch = find_patchable_files()
    already_done = find_already_patched()

    stats = {
        "already_patched": len(already_done),
        "newly_patched": 0,
        "url_fixes": 0,
        "errors": [],
        "dry_run": dry_run,
    }

    for path in to_patch:
        try:
            if not dry_run:
                text = path.read_text(encoding="utf-8", errors="ignore")
                patched = text.replace(ANCHOR, ANCHOR + injection)
                path.write_text(patched, encoding="utf-8")
            stats["newly_patched"] += 1
        except OSError as e:
            stats["errors"].append(f"{path.name}: {e}")

    stats["url_fixes"] = apply_url_fixes(dry_run=dry_run)
    return stats


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--apply"

    if not NEXT_DIR.exists():
        print(f"ERROR: .next directory not found at {NEXT_DIR}")
        print("       Run 'npm install -g omniroute' first.")
        sys.exit(1)

    if mode == "--status":
        patched = find_already_patched()
        needs_patch = find_patchable_files()
        total = len(patched) + len(needs_patch)
        if needs_patch:
            print(f"STATUS: NEEDS PATCH — {len(needs_patch)}/{total} files unpatched")
            for f in needs_patch[:5]:
                print(f"  - {f.relative_to(NEXT_DIR)}")
            if len(needs_patch) > 5:
                print(f"  ... and {len(needs_patch) - 5} more")
            sys.exit(1)
        else:
            print(f"STATUS: UP TO DATE — all {len(patched)} files patched ({len(CUSTOM_PROVIDERS)} providers)")
            sys.exit(0)

    elif mode == "--check":
        stats = apply_patches(dry_run=True)
        if stats["newly_patched"] == 0 and stats["already_patched"] > 0:
            print(f"DRY RUN: already patched ({stats['already_patched']} files). Nothing to do.")
        elif stats["newly_patched"] == 0:
            print("DRY RUN: no patchable files found. Is omniroute installed?")
        else:
            print(f"DRY RUN: would patch {stats['newly_patched']} files "
                  f"({stats['already_patched']} already done)")
        sys.exit(0)

    else:  # --apply (default)
        stats = apply_patches(dry_run=False)
        newly = stats["newly_patched"]
        done = stats["already_patched"]

        if stats["errors"]:
            for e in stats["errors"]:
                print(f"  ERROR: {e}", file=sys.stderr)

        if newly == 0 and done > 0:
            print(f"PATCH: already up to date ({done} files, {len(CUSTOM_PROVIDERS)} providers)")
        elif newly == 0:
            print("PATCH: nothing to patch — is omniroute installed?")
            sys.exit(1)
        else:
            print(f"PATCH: applied to {newly} files "
                  f"({done} were already patched, {len(CUSTOM_PROVIDERS)} providers injected)")

        sys.exit(1 if stats["errors"] else 0)


if __name__ == "__main__":
    main()
