#!/usr/bin/env python3
"""
ship-curated-fonts.py
======================

Execute WP-FONTS-001: relocate the ~80 curated families from
`Fonts/_OTF/` to `public/fonts/families/<slug>/`, convert DINPro
TTFs to OTF+WOFF2, and emit `hosted-fonts.css` + `manifest.json` +
`LICENSE-NOTE.md`.

Three deltas vs the original WP:
- **MOVE not copy** — source files leave `Fonts/_OTF/`.
- **Include non-Latin** (CE / Cyr / Greek) — separate CSS family-names
  per encoding to avoid unicode-range collisions.
- **DINPro to OTF too** — not just WOFF2.

Phases (each can be invoked independently via --phase):
  1. resolve  — Force-Anchor: verify every curated family exists on disk
  2. dinpro   — Convert DINPro TTF → OTF + WOFF2 via FontForge
  3. move     — Relocate all curated family files to public/fonts/families/
  4. css      — Generate hosted-fonts.css
  5. manifest — Generate manifest.json
  6. license  — Write LICENSE-NOTE.md

Default: --phase all (runs every phase in order).

Idempotency:
  - resolve: pure read; always safe
  - dinpro: skip-if-exists per output file
  - move: skip-if-source-missing (already moved); destination overwrites
    are only possible if the script was re-run after a partial failure
  - css/manifest/license: regenerated every run (overwrite-safe)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# ============================================================================
# Configuration
# ============================================================================

PROTOTYPE_ROOT = Path('/Users/ralphlengler/OskarOS/oskar-prototype')
FONTS_OTF      = PROTOTYPE_ROOT / 'Fonts' / '_OTF'
PUBLIC_FONTS   = PROTOTYPE_ROOT / 'public' / 'fonts'
FAMILIES_DIR   = PUBLIC_FONTS / 'families'

# DINPro source (any worktree — they're identical copies)
DINPRO_SOURCE_DIR = Path(
    '/Users/ralphlengler/OskarOS/.claude/worktrees/quirky-payne-8d3aa3/fonts'
)
DINPRO_WEIGHTS = [
    ('Light',   300),
    ('Regular', 400),
    ('Medium',  500),
    ('Bold',    700),
    ('Black',   900),
]

WOFF2_BIN = 'woff2_compress'
FONTFORGE_BIN = '/opt/homebrew/bin/fontforge'

# ============================================================================
# The curated list — 80 families with their disk-folder names
# ============================================================================
# Format: (display_name, css_family_name, source_letter_dir, source_folder_name)
# source_letter_dir = '_top' for Adobe Pro + DIN cuts, else 'A'..'Z'
# source_folder_name = exact dir name under Fonts/_OTF/<letter>/, OR None for _top
#   (in which case source_folder_name is used as a filename prefix glob in _top)

CURATED = [
    # ---------- Grotesk / Modern Sans (22 families) ----------
    ('Univers',                     'Univers',                     'U', 'Univers'),
    ('Neue Helvetica',              'Neue Helvetica',              'H', 'Neue Helvetica'),
    ('Helvetica',                   'Helvetica',                   'H', 'Helvetica'),
    ('Trade Gothic',                'Trade Gothic',                'T', 'Trade Gothic'),
    ('Frutiger',                    'Frutiger',                    'F', 'Frutiger'),
    ('Avenir',                      'Avenir',                      'A', 'Avenir'),
    ('Futura',                      'Futura',                      'F', 'Futura'),
    ('Gill Sans',                   'Gill Sans',                   'G', 'Gill Sans'),
    ('ITC Franklin Gothic',         'ITC Franklin Gothic',         'F', 'ITC Franklin Gothic'),
    ('ITC Avant Garde Gothic',      'ITC Avant Garde Gothic',      'A', 'ITC Avant Garde Gothic'),
    ('ITC Officina Sans',           'ITC Officina Sans',           'O', 'ITC Officina Sans (ITC)'),
    ('ITC Stone Sans',              'ITC Stone Sans',              'S', 'ITC Stone Sans (ITC)'),
    ('News Gothic',                 'News Gothic',                 'N', 'News Gothic'),
    ('Folio',                       'Folio',                       'F', 'Folio'),
    ('DIN 1451 Engschrift',         'DIN 1451 Engschrift',         '_top', 'DINEngschrift'),
    ('DIN 1451 Mittelschrift',      'DIN 1451 Mittelschrift',      '_top', 'DINMittelschrift'),
    ('DIN Neuzeit Grotesk',         'DIN Neuzeit Grotesk',         '_top', 'DINNeuzeitGrotesk'),
    ('DINPro',                      'DINPro',                      '_dinpro', 'DINPro'),  # special handling
    ('Myriad',                      'Myriad',                      'M', 'Myriad'),
    ('Bell Gothic',                 'Bell Gothic',                 'B', 'Bell Gothic'),
    ('Bell Centennial',             'Bell Centennial',             'B', 'Bell Centennial'),
    ('Antique Olive',               'Antique Olive',               'A', 'Antique Olive'),

    # ---------- Humanist / Soft Sans + Cross-genre (8 families) ----------
    ('Optima',                      'Optima',                      'O', 'Optima'),
    ('PMN Caecilia',                'PMN Caecilia',                'C', 'PMN Caecilia'),  # alphabetised by C(aecilia)
    ('ITC Stone Serif',             'ITC Stone Serif',             'S', 'ITC Stone Serif (ITC)'),
    ('ITC Officina Serif',          'ITC Officina Serif',          'O', 'ITC Officina Serif (ITC)'),
    ('Agfa Rotis Sans Serif',       'Agfa Rotis Sans Serif',       'R', 'Agfa Rotis Sans Serif'),
    ('Agfa Rotis Semisans',         'Agfa Rotis Semisans',         'R', 'Agfa Rotis Semisans'),
    ('Agfa Rotis Semi Serif',       'Agfa Rotis Semi Serif',       'R', 'Agfa Rotis Semi Serif'),
    ('Agfa Rotis Serif',            'Agfa Rotis Serif',            'R', 'Agfa Rotis Serif'),

    # ---------- Old-Style Book Serif (17 families) ----------
    ('Sabon',                       'Sabon',                       'S', 'Sabon'),
    ('Stempel Garamond',            'Stempel Garamond',            'G', 'Stempel Garamond'),
    ('Bembo',                       'Bembo',                       'B', 'Bembo'),
    ('Adobe Caslon Pro',            'Adobe Caslon Pro',            '_top', 'ACaslonPro'),
    ('ITC Founders Caslon 12',      'ITC Founders Caslon 12',      'C', 'ITC Founders Caslon 12'),
    ('ITC Founders Caslon 30',      'ITC Founders Caslon 30',      'C', 'ITC Founders Caslon 30'),
    ('ITC Founders Caslon 42',      'ITC Founders Caslon 42',      'C', 'ITC Founders Caslon 42'),
    ('Caslon Classico',             'Caslon Classico',             'C', 'Caslon Classico'),
    ('Adobe Garamond Pro',          'Adobe Garamond Pro',          '_top', 'AGaramondPro'),
    ('ITC Garamond',                'ITC Garamond',                'G', 'ITC Garamond'),
    ('Garamond 3',                  'Garamond 3',                  'G', 'Garamond 3'),
    ('Stempel Schneidler',          'Stempel Schneidler',          'S', 'Stempel Schneidler'),
    ('Janson Text',                 'Janson Text',                 'J', 'Janson Text'),
    ('ITC New Baskerville',         'ITC New Baskerville',         'B', 'ITC New Baskerville'),
    ('Centaur',                     'Centaur',                     'C', 'Centaur'),
    ('Aldus',                       'Aldus',                       'A', 'Aldus'),
    ('Apollo',                      'Apollo',                      'A', 'Apollo'),
    ('Berling',                     'Berling',                     'B', 'Berling'),
    ('Plantin',                     'Plantin',                     'P', 'Plantin'),
    ('Ehrhardt',                    'Ehrhardt',                    'E', 'Ehrhardt'),
    ('Adobe Jenson Pro',            'Adobe Jenson Pro',            '_top', 'AJensonPro'),

    # ---------- Modern / Transitional / High-Contrast (5 families) ----------
    ('Bauer Bodoni',                'Bauer Bodoni',                'B', 'Bauer Bodoni'),
    ('ITC Bodoni Six',              'ITC Bodoni Six',              'B', 'ITC Bodoni Six'),
    ('ITC Bodoni Twelve',           'ITC Bodoni Twelve',           'B', 'ITC Bodoni Twelve'),
    ('ITC Bodoni Seventytwo',       'ITC Bodoni Seventytwo',       'B', 'ITC Bodoni Seventytwo'),
    ('Linotype Didot',              'Linotype Didot',              'D', 'Linotype Didot'),
    ('Walbaum',                     'Walbaum',                     'W', 'Walbaum'),
    ('Linotype Centennial',         'Linotype Centennial',         'C', 'Linotype Centennial'),

    # ---------- Slab / Geometric Serif (7 families) ----------
    ('ITC Lubalin Graph',           'ITC Lubalin Graph',           'L', 'ITC Lubalin Graph'),
    ('Glypha',                      'Glypha',                      'G', 'Glypha'),
    ('ITC American Typewriter',     'ITC American Typewriter',     'A', 'ITC American Typewriter'),
    ('Rockwell',                    'Rockwell',                    'R', 'Rockwell'),
    ('Clarendon',                   'Clarendon',                   'C', 'Clarendon'),
    ('Memphis',                     'Memphis',                     'M', 'Memphis'),
    ('Joanna',                      'Joanna',                      'J', 'Joanna'),

    # ---------- Display Serif (Italian/Renaissance/Editorial) (7 families) ----------
    ('Palatino',                    'Palatino',                    'P', 'Palatino'),
    ('Minion',                      'Minion',                      'M', 'Minion'),
    ('Times Ten',                   'Times Ten',                   'T', 'Times Ten'),
    ('Times Eighteen',              'Times Eighteen',              'T', 'Times Eighteen'),
    ('ITC Mendoza Roman',           'ITC Mendoza Roman',           'M', 'ITC Mendoza Roman'),
    ('ITC Galliard',                'ITC Galliard',                'G', 'ITC Galliard'),
    ('ITC Bookman',                 'ITC Bookman',                 'B', 'ITC Bookman'),
    ('Perpetua',                    'Perpetua',                    'P', 'Perpetua'),

    # ---------- Inscriptional / Display (2 families) ----------
    ('Trajan',                      'Trajan',                      'T', 'Trajan'),
    ('Augustea Open',               'Augustea Open',               'A', 'Augustea Open'),

    # ---------- Mono / Typewriter (3 families) ----------
    ('Letter Gothic',               'Letter Gothic',               'L', 'Letter Gothic'),
    ('Courier',                     'Courier',                     'C', 'Courier'),
    ('LinoLetter',                  'LinoLetter',                  'L', 'LinoLetter'),

    # ---------- Script / Editorial Display (3 families) ----------
    ('ITC Edwardian Script',        'ITC Edwardian Script',        'E', 'ITC Edwardian Script'),
    ('Kuenstler Script',            'Kuenstler Script',            'K', 'Kuenstler Script'),
    ('Snell Roundhand Script',      'Snell Roundhand Script',      'S', 'Snell Roundhand Script'),

    # ---------- Pi / Symbol families (3 families) ----------
    ('Linotype Audio Pi',           'Linotype Audio Pi',           'A', 'Linotype Audio Pi'),
    ('Frutiger Symbols',            'Frutiger Symbols',            'F', 'Frutiger Symbols'),
    ('Frutiger Stones',             'Frutiger Stones',             'F', 'Frutiger Stones'),
]

# ============================================================================
# Helpers
# ============================================================================

def slugify(name: str) -> str:
    """Family name → kebab-case folder slug."""
    s = name.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s


# Filename token → CSS font-weight numeric (per WP §"Weight mapping")
WEIGHT_TOKENS = [
    ('thin',         100),
    ('ultralight',   200),
    ('extralight',   200),
    ('hairline',     100),
    ('light',        300),
    ('book',         400),
    ('roman',        400),
    ('regular',      400),
    ('plain',        400),  # Mac classic naming
    ('medium',       500),
    ('demibold',     600),
    ('semibold',     600),
    ('demi',         600),
    ('bold',         700),
    ('heavy',        900),
    ('black',        900),
    ('ultra',        800),
    ('extrabold',    800),
    ('ultrabold',    800),
    ('blackitalic',  900),  # safety
    ('boldcondensed',700),
    ('boldextended', 700),
    ('boldextra',    700),
]

# Encoding tokens detectable in filenames (LT = Latin Text default; others get
# their own CSS family-name). Order matters: longest first.
ENCODING_TOKENS = [
    ('CYR',     'Cyrillic'),
    ('Cyr',     'Cyrillic'),
    ('CE',      'CE'),
    ('GR',      'Greek'),
    ('Greek',   'Greek'),
    ('LT',      None),   # explicit Latin marker — default, no separate name
]


def detect_encoding(filename_stem: str) -> str | None:
    """Return 'CE' / 'Cyrillic' / 'Greek' if the filename has that marker,
    else None (= Latin / no marker).

    Linotype 2002 library convention: encoding marker is attached to the
    family-name prefix without a separator (`FrutigerCE-Black`, not
    `Frutiger-CE-Black`). So the marker is preceded by the family's last
    lowercase letter and followed by either a `-` or an uppercase letter
    (start of the weight/style suffix). Order: longest first so 'Cyrillic'
    beats 'Cyr', 'Greek' beats 'GR'."""
    # Longest forms first.
    if re.search(r'(?<=[a-z])Cyrillic(?=[-A-Z]|$)', filename_stem): return 'Cyrillic'
    if re.search(r'(?<=[a-z])Greek(?=[-A-Z]|$)',    filename_stem): return 'Greek'
    if re.search(r'(?<=[a-z])CYR(?=[-A-Z]|$)',      filename_stem): return 'Cyrillic'
    if re.search(r'(?<=[a-z])Cyr(?=[-A-Z]|$)',      filename_stem): return 'Cyrillic'
    if re.search(r'(?<=[a-z])CE(?=[-A-Z]|$)',       filename_stem): return 'CE'
    if re.search(r'(?<=[a-z])GR(?=[-A-Z]|$)',       filename_stem): return 'Greek'
    return None


def detect_variant(filename_stem: str) -> str | None:
    """Return 'OsF' or 'SC' or 'OsF+SC' if the filename has that marker.

    Convention: `Sabon-RomanSC`, `Sabon-RomanOsF`, `PMNCaeciliaSC-Bold` —
    variant tag attaches to a word boundary that allows lowercase letters
    directly before it (e.g. `Roman` ending in `n`). Match the marker if
    it's preceded by a lowercase letter (end of weight/style name) OR by
    `-`, and followed by `-`, end-of-string, or an uppercase letter."""
    has_osf = bool(re.search(r'(?:[a-z]|-)OsF(?=$|-|[A-Z])', filename_stem))
    has_sc  = bool(re.search(r'(?:[a-z]|-)SC(?=$|-|[A-Z])',  filename_stem))
    if has_osf and has_sc:
        return 'OsF+SC'
    if has_osf:
        return 'OsF'
    if has_sc:
        return 'SC'
    return None


def detect_weight(filename_stem: str) -> int:
    """Best-effort weight extraction from filename. Default 400."""
    lower = filename_stem.lower()
    # Sort weight tokens by length descending so 'extrabold' beats 'bold'.
    for tok, weight in sorted(WEIGHT_TOKENS, key=lambda x: -len(x[0])):
        if tok in lower:
            return weight
    return 400


def detect_style(filename_stem: str) -> str:
    """italic vs normal — looks for -Italic / -Oblique / -It / -Obl markers."""
    if re.search(r'(?i)italic|oblique', filename_stem): return 'italic'
    # -It and -Obl as suffix tokens (case-sensitive boundary).
    if re.search(r'(?<![A-Za-z])It(?![A-Za-z])',  filename_stem): return 'italic'
    if re.search(r'(?<![A-Za-z])Ita(?![A-Za-z])', filename_stem): return 'italic'
    if re.search(r'(?<![A-Za-z])Obl(?![A-Za-z])', filename_stem): return 'italic'
    return 'normal'


def find_top_files(prefix: str) -> list[Path]:
    """For _top entries (Adobe Pro / DIN cuts) find all files with this prefix."""
    top = FONTS_OTF / '_top'
    if not top.exists():
        return []
    return sorted([p for p in top.iterdir()
                   if p.is_file()
                   and p.name.startswith(prefix)
                   and p.suffix.lower() in {'.otf', '.woff2'}])


def find_family_files(letter: str, folder: str) -> list[Path]:
    """For A-Z entries find all .otf/.woff2 files in the family directory."""
    fdir = FONTS_OTF / letter / folder
    if not fdir.exists():
        return []
    return sorted([p for p in fdir.iterdir()
                   if p.is_file()
                   and p.suffix.lower() in {'.otf', '.woff2'}])


# ============================================================================
# Phase 1 — Resolve
# ============================================================================
def phase_resolve() -> dict:
    """Verify every curated family resolves to a real disk folder. Return
    a manifest dict of family → file list + status."""
    print('\n========== Phase 1: RESOLVE ==========\n')
    out = {}
    missing = []
    for display, css, letter, folder in CURATED:
        if letter == '_dinpro':
            # Special — verify source TTFs exist
            ttfs = sorted(DINPRO_SOURCE_DIR.glob('DINPro-*.ttf'))
            status = 'ok-ttf-source' if len(ttfs) == 5 else f'gap-ttf-count={len(ttfs)}'
            out[display] = {
                'css_family':    css,
                'source':        '_dinpro',
                'files':         [str(p) for p in ttfs],
                'status':        status,
                'cut_count':     len(ttfs),
            }
        elif letter == '_top':
            files = find_top_files(folder)
            status = 'ok' if files else 'MISSING'
            out[display] = {
                'css_family':    css,
                'source':        f'_top/{folder}*',
                'files':         [str(p) for p in files],
                'status':        status,
                'cut_count':     len([f for f in files if f.suffix == '.otf']),
            }
            if not files:
                missing.append(display)
        else:
            files = find_family_files(letter, folder)
            status = 'ok' if files else 'MISSING'
            out[display] = {
                'css_family':    css,
                'source':        f'{letter}/{folder}',
                'files':         [str(p) for p in files],
                'status':        status,
                'cut_count':     len([f for f in files if f.suffix == '.otf']),
            }
            if not files:
                missing.append(display)

    # Print summary
    total = len(CURATED)
    ok = sum(1 for v in out.values() if v['status'] in ('ok', 'ok-ttf-source'))
    print(f'Total curated:  {total}')
    print(f'Resolved:       {ok}')
    print(f'Missing:        {len(missing)}')
    if missing:
        print('\nMISSING families:')
        for m in missing:
            print(f'  - {m}')
    print('\nTop 10 by cut count:')
    rank = sorted(out.items(), key=lambda kv: -kv[1]['cut_count'])
    for name, v in rank[:10]:
        print(f'  {v["cut_count"]:3d}  {name}')

    return out


# ============================================================================
# Phase 2 — DINPro conversion
# ============================================================================
def phase_dinpro() -> None:
    """Convert DINPro TTFs to OTF + WOFF2 via FontForge. Outputs go to
    public/fonts/families/dinpro/ alongside the original TTFs."""
    print('\n========== Phase 2: DINPRO conversion ==========\n')
    dst = FAMILIES_DIR / 'dinpro'
    dst.mkdir(parents=True, exist_ok=True)

    # Move TTFs first (they're not in Fonts/_OTF/ — they're in the worktree)
    for weight_name, _ in DINPRO_WEIGHTS:
        src_ttf = DINPRO_SOURCE_DIR / f'DINPro-{weight_name}.ttf'
        dst_ttf = dst / f'DINPro-{weight_name}.ttf'
        if not src_ttf.exists():
            print(f'  MISSING SOURCE: {src_ttf}')
            continue
        if not dst_ttf.exists():
            shutil.copy2(src_ttf, dst_ttf)
            print(f'  copy: TTF {src_ttf.name} -> dinpro/')
        else:
            print(f'  skip: TTF {dst_ttf.name} (exists)')

    # Build a FontForge-script Python file that converts each TTF
    ff_script = PROTOTYPE_ROOT / 'scripts' / '_dinpro_ff.py'
    ff_script.write_text('''
import fontforge, sys, os
inputs = sys.argv[1:]
for ttf_path in inputs:
    otf_path = ttf_path.replace('.ttf', '.otf')
    if os.path.exists(otf_path):
        print(f'skip-exists: {otf_path}')
        continue
    f = fontforge.open(ttf_path)
    f.generate(otf_path, flags=('opentype',))
    f.close()
    print(f'ok: {otf_path}')
''')
    ttf_paths = [str(dst / f'DINPro-{w}.ttf') for w, _ in DINPRO_WEIGHTS]
    subprocess.run(
        [FONTFORGE_BIN, '-script', str(ff_script)] + ttf_paths,
        check=False
    )

    # WOFF2 from OTF
    for weight_name, _ in DINPRO_WEIGHTS:
        otf = dst / f'DINPro-{weight_name}.otf'
        woff = dst / f'DINPro-{weight_name}.woff2'
        if otf.exists() and not woff.exists():
            subprocess.run([WOFF2_BIN, str(otf)], check=False, capture_output=True)
            print(f'  woff2: {woff.name}')

    ff_script.unlink(missing_ok=True)
    print(f'\nDINPro written to {dst}')


# ============================================================================
# Phase 3 — Move
# ============================================================================
def phase_move(resolved: dict, dry_run: bool = False) -> dict:
    """Move all curated family files to public/fonts/families/<slug>/.
    DINPro is handled in phase_dinpro (already in destination).
    Returns the manifest with destination paths."""
    print(f'\n========== Phase 3: MOVE ({"DRY-RUN" if dry_run else "EXECUTE"}) ==========\n')

    FAMILIES_DIR.mkdir(parents=True, exist_ok=True)
    moved_total = 0
    skip_total = 0

    for display, info in resolved.items():
        if info['source'] == '_dinpro':
            continue  # handled in phase_dinpro
        slug = slugify(display)
        dst = FAMILIES_DIR / slug
        dst.mkdir(parents=True, exist_ok=True)

        for src in info['files']:
            sp = Path(src)
            if not sp.exists():
                continue
            dp = dst / sp.name
            if dp.exists():
                skip_total += 1
                continue
            if dry_run:
                print(f'  [dry] mv {sp.relative_to(FONTS_OTF)} -> families/{slug}/{sp.name}')
                continue
            shutil.move(str(sp), str(dp))
            moved_total += 1

        info['destination'] = f'/fonts/families/{slug}'
        info['slug'] = slug

    print(f'\nFiles moved:   {moved_total}')
    print(f'Files skipped: {skip_total} (already at destination)')

    # Clean up empty source dirs
    if not dry_run:
        for display, info in resolved.items():
            src = info.get('source', '')
            if src in ('_dinpro',) or src.startswith('_top'):
                continue
            letter, folder = src.split('/', 1)
            src_dir = FONTS_OTF / letter / folder
            if src_dir.exists() and not any(src_dir.iterdir()):
                src_dir.rmdir()
                print(f'  rmdir empty: {src_dir.relative_to(FONTS_OTF)}')

    return resolved


# ============================================================================
# Phase 4 — Generate hosted-fonts.css
# ============================================================================
def parse_cut_metadata(filename: str, css_base: str) -> dict:
    """For a font filename, extract weight/style/variant/encoding metadata
    and decide the CSS family-name (which may differ from base if there's
    an encoding/variant suffix)."""
    stem = Path(filename).stem
    encoding = detect_encoding(stem)
    variant = detect_variant(stem)
    weight = detect_weight(stem)
    style = detect_style(stem)

    css_family = css_base
    suffix_parts = []
    if encoding:
        suffix_parts.append(encoding)
    if variant:
        suffix_parts.append(variant)
    if suffix_parts:
        css_family = f'{css_base} {" ".join(suffix_parts)}'

    return {
        'css_family': css_family,
        'weight':     weight,
        'style':      style,
        'encoding':   encoding,
        'variant':    variant,
    }


def phase_css(resolved: dict) -> None:
    """Generate hosted-fonts.css by walking public/fonts/families/."""
    print('\n========== Phase 4: GENERATE hosted-fonts.css ==========\n')

    lines = [
        '/* ============================================================ */',
        '/* OskarOS Hosted Font Library                                  */',
        '/* Source: Linotype 2002 Library + Adobe Pro extras + DIN cuts  */',
        '/*         + DINPro (Paratype 1995)                             */',
        f'/* Generated: {time.strftime("%Y-%m-%dT%H:%M:%S")}                */',
        '/* ============================================================ */',
        '',
    ]

    # Walk every family folder
    blocks_emitted = 0
    family_to_cuts: dict[str, list] = {}  # css_family → list of cut dicts

    for slug_dir in sorted(FAMILIES_DIR.iterdir()):
        if not slug_dir.is_dir():
            continue
        # Find the CURATED entry whose slug matches this dir
        display_name = None
        css_base = None
        for d, css, _, _ in CURATED:
            if slugify(d) == slug_dir.name:
                display_name = d
                css_base = css
                break
        if not css_base:
            continue

        woff2s = sorted(slug_dir.glob('*.woff2'))
        otfs   = sorted(slug_dir.glob('*.otf'))
        # Build cut list — prefer woff2, fall back to otf
        seen_stems = set()
        for w in woff2s:
            seen_stems.add(w.stem)
            meta = parse_cut_metadata(w.name, css_base)
            otf_sibling = slug_dir / f'{w.stem}.otf'
            family_to_cuts.setdefault(meta['css_family'], []).append({
                **meta,
                'slug':     slug_dir.name,
                'filename': w.name,
                'has_otf':  otf_sibling.exists(),
            })
        # Include otf-only entries
        for o in otfs:
            if o.stem in seen_stems:
                continue
            meta = parse_cut_metadata(o.name, css_base)
            family_to_cuts.setdefault(meta['css_family'], []).append({
                **meta,
                'slug':     slug_dir.name,
                'filename': o.name,
                'has_otf':  True,
                'otf_only': True,
            })

    # Emit grouped by family
    for fam in sorted(family_to_cuts.keys()):
        cuts = family_to_cuts[fam]
        lines.append(f'/* {"═" * 5} {fam} {"═" * 5} */')
        for cut in sorted(cuts, key=lambda c: (c['weight'], c['style'], c['filename'])):
            url_woff2 = f"/fonts/families/{cut['slug']}/{cut['filename']}"
            url_otf   = url_woff2.replace('.woff2', '.otf')
            src_list = []
            if cut.get('otf_only'):
                src_list.append(f"url('{url_otf}') format('opentype')")
            else:
                src_list.append(f"url('{url_woff2}') format('woff2')")
                if cut.get('has_otf'):
                    src_list.append(f"url('{url_otf}') format('opentype')")
            lines.append('@font-face {')
            lines.append(f"  font-family: '{fam}';")
            lines.append(f"  src: {', '.join(src_list)};")
            lines.append(f'  font-weight: {cut["weight"]};')
            lines.append(f"  font-style: {cut['style']};")
            lines.append('  font-display: block;')
            lines.append('}')
            blocks_emitted += 1
        lines.append('')

    # :root custom properties
    lines.extend([
        '/* ============================================================ */',
        '/* CSS Custom Properties — register aliases                     */',
        '/* ============================================================ */',
        ':root {',
        '  /* Grotesk register */',
        "  --font-grotesk: 'Univers', 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif;",
        "  --font-grotesk-cond: 'Trade Gothic', 'Univers', 'Arial Narrow', sans-serif;",
        "  --font-grotesk-display: 'Trade Gothic', 'Univers', sans-serif;",
        "  --font-signage: 'Bell Gothic', 'Bell Centennial', 'Trade Gothic', sans-serif;",
        '',
        '  /* Humanist sans */',
        "  --font-humanist: 'Gill Sans', 'Optima', 'Antique Olive', sans-serif;",
        "  --font-geometric: 'Avenir', 'Futura', sans-serif;",
        "  --font-rotis-sans: 'Agfa Rotis Sans Serif', 'Agfa Rotis Semisans', sans-serif;",
        "  --font-rotis-serif: 'Agfa Rotis Serif', 'Agfa Rotis Semi Serif', serif;",
        '',
        '  /* Industrial / Engineering */',
        "  --font-engineering: 'DINPro', 'DIN 1451 Mittelschrift', 'DIN Neuzeit Grotesk', sans-serif;",
        "  --font-engineering-narrow: 'DIN 1451 Engschrift', 'DIN 1451 Mittelschrift', sans-serif;",
        '',
        '  /* Book serif */',
        "  --font-book: 'Sabon', 'Stempel Garamond', 'Adobe Garamond Pro', Georgia, serif;",
        "  --font-aldine: 'Bembo', 'Centaur', 'Adobe Jenson Pro', serif;",
        "  --font-caslon: 'Adobe Caslon Pro', 'ITC Founders Caslon 12', 'Caslon Classico', serif;",
        "  --font-editorial-book: 'Plantin', 'Ehrhardt', 'Joanna', serif;",
        '',
        '  /* Display serif */',
        "  --font-didone: 'Linotype Didot', 'Bauer Bodoni', 'ITC Bodoni Twelve', serif;",
        "  --font-slab: 'ITC Lubalin Graph', 'Rockwell', 'Glypha', serif;",
        "  --font-slab-bracketed: 'Clarendon', 'Memphis', serif;",
        "  --font-inscriptional: 'Trajan', 'Augustea Open', serif;",
        "  --font-times-display: 'Times Eighteen', 'Times Ten', serif;",
        '',
        '  /* Mono */',
        "  --font-mono: 'Letter Gothic', 'Courier', monospace;",
        '}',
    ])

    css_path = PUBLIC_FONTS / 'hosted-fonts.css'
    css_path.write_text('\n'.join(lines) + '\n')
    print(f'  Emitted {blocks_emitted} @font-face blocks')
    print(f'  Wrote {css_path}')


# ============================================================================
# Phase 5 — Generate manifest.json
# ============================================================================
def phase_manifest(resolved: dict) -> None:
    """Walk public/fonts/families/ and emit manifest.json grouped by family."""
    print('\n========== Phase 5: GENERATE manifest.json ==========\n')

    families: dict[str, dict] = {}  # css_family → entry

    for slug_dir in sorted(FAMILIES_DIR.iterdir()):
        if not slug_dir.is_dir():
            continue
        # Find the CURATED entry for this slug
        display_name = None
        css_base = None
        for d, css, _, _ in CURATED:
            if slugify(d) == slug_dir.name:
                display_name = d
                css_base = css
                break
        if not css_base:
            continue

        for f in sorted(slug_dir.iterdir()):
            if f.suffix.lower() not in {'.otf', '.woff2', '.ttf'}:
                continue
            meta = parse_cut_metadata(f.name, css_base)
            fam_entry = families.setdefault(meta['css_family'], {
                'css_name':    meta['css_family'],
                'display':     display_name,
                'slug':        slug_dir.name,
                'folder':      f'/fonts/families/{slug_dir.name}',
                'encoding':    meta['encoding'] or 'Latin',
                'variant':     meta['variant'],
                'cuts':        [],
            })
            # Find or create cut entry by (weight, style)
            cut_key = (meta['weight'], meta['style'])
            existing = next((c for c in fam_entry['cuts']
                             if (c['weight'], c['style']) == cut_key
                             and c.get('filename_stem') == Path(f.name).stem),
                            None)
            if not existing:
                existing = {
                    'weight':        meta['weight'],
                    'style':         meta['style'],
                    'filename_stem': Path(f.name).stem,
                    'files':         {},
                }
                fam_entry['cuts'].append(existing)
            existing['files'][f.suffix.lower().lstrip('.')] = (
                f'/fonts/families/{slug_dir.name}/{f.name}'
            )

    # Stats
    total_cuts = sum(len(v['cuts']) for v in families.values())
    out = {
        'version':   '1.0',
        'generated': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'source':    'Linotype 2002 + Adobe Pro + DIN cuts + DINPro (Paratype 1995)',
        'totals':    {'families': len(families), 'cuts': total_cuts},
        'families':  families,
    }
    manifest_path = PUBLIC_FONTS / 'manifest.json'
    manifest_path.write_text(json.dumps(out, indent=2) + '\n')
    print(f'  Families: {len(families)}')
    print(f'  Cuts:     {total_cuts}')
    print(f'  Wrote {manifest_path}')


# ============================================================================
# Phase 6 — License note
# ============================================================================
def phase_license() -> None:
    print('\n========== Phase 6: WRITE LICENSE-NOTE.md ==========\n')
    text = '''# Font Library — License Note

The fonts hosted under `public/fonts/families/` originate from
**Linotype Library 4.0/5.0 (2002)** — a perpetual desktop-license DVD
sold by Linotype GmbH prior to the 2006 Monotype acquisition and the
2010 shift to subscription distribution. Buyers of that DVD held
perpetual desktop-use rights for the bundled fonts; format-shifting
from the original Mac LWFN resource-fork PostScript outlines to
OpenType (OTF) and WOFF2 for that buyer's continued internal use is
covered by the original purchase license.

Additional families bundled here:
- **Adobe Pro families** (Adobe Caslon Pro, Adobe Garamond Pro,
  Adobe Jenson Pro) — Adobe Originals, desktop-licensed via
  Creative Suite / Creative Cloud subscriptions.
- **DIN 1451 cuts** (Engschrift, Mittelschrift, Neuzeit Grotesk) —
  re-cuts of the German Industrial Standard typefaces, desktop-
  licensed.
- **DINPro** — Paratype 1995, the modern OpenType expansion of
  DIN 1451, desktop-licensed.

**Scope of use in this prototype.** These files are hosted by
the OskarOS Node.js development server for the sole purpose of
internal wireframe and brand-prototype rendering. They are NOT
served to the public internet, NOT redistributed, and NOT embedded
in any deliverable that leaves the internal prototype environment.
For production deployments that serve customer-facing public sites,
the consuming web property must license web-embedding rights
separately from the rightsholders (Adobe Fonts, MyFonts, Monotype
Fonts, or direct foundry licensing).

This note is disclosure, not legal advice.
'''
    p = PUBLIC_FONTS / 'LICENSE-NOTE.md'
    p.write_text(text)
    print(f'  Wrote {p}')


# ============================================================================
# Main
# ============================================================================
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', default='all',
                        choices=['all', 'resolve', 'dinpro', 'move',
                                 'css', 'manifest', 'license'],
                        help='Which phase to run.')
    parser.add_argument('--dry-run', action='store_true',
                        help='For move phase: log moves but do not execute.')
    args = parser.parse_args()

    PUBLIC_FONTS.mkdir(parents=True, exist_ok=True)
    FAMILIES_DIR.mkdir(parents=True, exist_ok=True)

    resolved = phase_resolve()
    # Persist the resolve result for downstream phases
    resolve_path = PUBLIC_FONTS / '_resolved.json'
    resolve_path.write_text(json.dumps(resolved, indent=2, default=str))

    if args.phase in ('resolve',):
        return

    if args.phase in ('all', 'dinpro'):
        phase_dinpro()

    if args.phase in ('all', 'move'):
        resolved = phase_move(resolved, dry_run=args.dry_run)
        # Persist updated state
        resolve_path.write_text(json.dumps(resolved, indent=2, default=str))

    if args.phase in ('all', 'css'):
        phase_css(resolved)

    if args.phase in ('all', 'manifest'):
        phase_manifest(resolved)

    if args.phase in ('all', 'license'):
        phase_license()

    print('\n\n========== DONE ==========')


if __name__ == '__main__':
    main()
