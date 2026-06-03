#!/usr/bin/env python3
"""
convert-linotype-library.py
============================

Convert the Linotype Library 4.0/5.0 (Mac resource-fork Type 1 LWFN format)
plus any plain TTF/OTF/PFB files at top level into web-ready OTF + WOFF2.

Source root: /Users/ralphlengler/OskarOS/oskar-prototype/Fonts
Output:      /Users/ralphlengler/OskarOS/oskar-prototype/Fonts/_OTF
             (mirrors source A-Z structure; top-level files go to _OTF/_top)

What it handles
---------------
1. Mac LWFN suitcase (no extension, 0-byte data fork, resource fork holds
   one OR many fonts). FontForge enumerates fonts inside via
   `fontforge.fontsInFile()` and we generate one OTF per contained font.
2. Plain TrueType (.ttf) and OpenType (.otf) — pass through FontForge for
   re-saving as OTF (lightly normalised) and then WOFF2.
3. Windows Type 1 (.pfb + .pfm) — opened directly.

What it skips
-------------
- `.AFM` / `.afm` / `.pfm` / `.PFM` / `.inf` — metric sidecars (FontForge
  reads them automatically alongside the outline file when it opens).
- `*.bmap` — Mac bitmap suitcase (screen-display bitmaps, no outline data).
- `Icon\r`, `.DS_Store`, `Thumbs.db` — filesystem droppings.
- Zero-byte files with NO resource fork — dead from a prior `cp` that
  stripped HFS metadata. Logged as 'no-resource-fork'.

Output naming
-------------
Each generated font is named after its PostScript fontname
(e.g. `FrutigerLT-Black.otf`). Spaces and slashes are sanitised. Within
each mirrored family directory this is unique. If the PS name is missing
FontForge falls back to the source filename stem.

Idempotency
-----------
Skips conversion if the target .otf already exists, unless --force.

How to run
----------
1. Install FontForge with Python bindings + woff2:
     brew install fontforge woff2
2. Smoke-test on one family first:
     fontforge -script convert-linotype-library.py --only "F/Frutiger"
3. Full library:
     fontforge -script convert-linotype-library.py

Total expected time: ~60-90 minutes for the full library on an M-series Mac.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

# ---------------------------------------------------------------------------
# fontforge import — only works when this script is invoked via
# `fontforge -script` OR when fontforge's python module is in sys.path.
# ---------------------------------------------------------------------------
try:
    import fontforge
except ImportError:
    sys.stderr.write(
        "ERROR: `fontforge` module not importable.\n"
        "Install via `brew install fontforge` and run this script via:\n"
        "    fontforge -script convert-linotype-library.py [args]\n"
        "Not as plain `python3` — FontForge's Python bindings ship with the CLI.\n"
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ROOT = Path('/Users/ralphlengler/OskarOS/oskar-prototype/Fonts')
OUT_ROOT = ROOT / '_OTF'

# Crash-resilience sentinels (Mac LWFN format triggers occasional FontForge
# segfaults — typically on Multiple Master Type 1 fonts with malformed
# `blended font defn` sections. The Python-level try/except can't catch
# SIGSEGV; once FontForge dies the whole process is gone. To recover we:
#   1. Write CURRENT_FILE_SENTINEL = source path BEFORE every open()
#   2. Delete CURRENT_FILE_SENTINEL AFTER any open() completes (ok or err)
#   3. On startup, if the sentinel exists, the LAST run died on that file —
#      append it to PERMANENT_SKIP_LIST so we never try it again
#   4. Wrap the whole invocation in a bash `until` loop that re-launches the
#      script after every non-clean exit
CURRENT_FILE_SENTINEL = OUT_ROOT / '_current.txt'
PERMANENT_SKIP_LIST   = OUT_ROOT / '_skip-list.txt'

# Extensions / names that are NEVER fonts — skip silently.
SKIP_EXTS = {
    '.afm', '.pfm', '.inf', '.txt', '.bmap', '.fond',
    '.suit',  # Mac font suitcase wrapper (we open the contained file instead)
    '.lwfn',  # LWFN sometimes carries an explicit ext too — handled below
}
SKIP_NAMES = {'.DS_Store', 'Thumbs.db'}

# Extensions that are real font files we open directly.
DIRECT_FONT_EXTS = {'.ttf', '.otf', '.pfb', '.pfa', '.ttc', '.dfont'}

# Where woff2_compress lives (PATH lookup).
WOFF2_BIN = 'woff2_compress'


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _clear_sentinel() -> None:
    """Remove the crash-sentinel after a successful open()."""
    try:
        CURRENT_FILE_SENTINEL.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass


def _read_skip_list() -> set:
    """Load permanent skip-list (source paths that crashed prior runs)."""
    if not PERMANENT_SKIP_LIST.exists():
        return set()
    try:
        return {line.strip() for line in PERMANENT_SKIP_LIST.read_text().splitlines()
                if line.strip() and not line.startswith('#')}
    except Exception:
        return set()


def _append_skip_list(rel_src: str) -> None:
    """Add a crashed source path to the permanent skip-list."""
    try:
        PERMANENT_SKIP_LIST.parent.mkdir(parents=True, exist_ok=True)
        with open(PERMANENT_SKIP_LIST, 'a') as f:
            f.write(rel_src + '\n')
    except Exception as e:
        print(f'WARNING: could not append to skip-list: {e}', file=sys.stderr)


def _recover_from_prior_crash() -> str:
    """If a sentinel exists from a previous run, the previous run crashed
    on that file. Add it to the permanent skip-list and clear the sentinel.
    Returns the crashed path (or empty string if none)."""
    if not CURRENT_FILE_SENTINEL.exists():
        return ''
    try:
        crashed = CURRENT_FILE_SENTINEL.read_text().strip()
    except Exception:
        crashed = ''
    if crashed:
        _append_skip_list(crashed)
        print(f'\n*** RECOVERED: prior run crashed on "{crashed}" — '
              f'permanently skip-listed. ***\n')
    _clear_sentinel()
    return crashed


def get_resource_fork_size(path: Path) -> int:
    """Return size in bytes of the file's Mac HFS resource fork (0 if none)."""
    rsrc = str(path) + '/..namedfork/rsrc'
    try:
        return os.stat(rsrc).st_size
    except (FileNotFoundError, OSError):
        return 0


def looks_like_icon_file(name: str) -> bool:
    """Mac Finder icon files have a CR (\\r) in the name."""
    return name.startswith('Icon') and ('\r' in name or '\\r' in name)


def classify(path: Path) -> str:
    """Return one of:
      - 'skip'         (not a font; ignore silently)
      - 'direct'       (ttf/otf/pfb — open by path)
      - 'lwfn'         (Mac resource-fork suitcase; may contain 1+ fonts)
      - 'dead'         (zero-byte with no resource fork — copy stripped it)
    """
    name = path.name
    if name in SKIP_NAMES:
        return 'skip'
    if looks_like_icon_file(name):
        return 'skip'
    if name.startswith('.'):
        return 'skip'

    ext = path.suffix.lower()
    if ext in SKIP_EXTS:
        return 'skip'
    if ext in DIRECT_FONT_EXTS:
        return 'direct'

    # No useful extension — could be an LWFN suitcase OR junk.
    try:
        data_size = path.stat().st_size
    except OSError:
        return 'skip'
    rsrc_size = get_resource_fork_size(path)

    if data_size == 0 and rsrc_size > 0:
        return 'lwfn'
    if data_size == 0 and rsrc_size == 0:
        return 'dead'

    # Has a data fork but no recognised extension — probably stray. Try LWFN
    # anyway only if there's also a resource fork (multi-fork mixed file).
    if rsrc_size > 0:
        return 'lwfn'
    return 'skip'


def sanitise_filename(s: str) -> str:
    """PostScript names are usually safe, but defensively strip path-hostile
    characters."""
    if not s:
        return 'unnamed'
    bad = '/\\:*?"<>|'
    out = ''.join('_' if c in bad else c for c in s)
    out = out.strip().replace(' ', '_')
    return out or 'unnamed'


def output_dir_for(src: Path) -> Path:
    """Mirror the source directory structure under OUT_ROOT. Top-level files
    (siblings of the A-Z dirs) go into _OTF/_top/."""
    rel_parent = src.parent.relative_to(ROOT)
    if str(rel_parent) == '.':
        return OUT_ROOT / '_top'
    return OUT_ROOT / rel_parent


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------
def generate_otf(font, out_path: Path) -> None:
    """Write one open FontForge font as OTF (CFF-based OpenType)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # 'opentype' = CFF; 'PfEd-comments' off to keep file small; 'glyph-comments' off.
    font.generate(str(out_path), flags=('opentype',))


def run_woff2(otf_path: Path) -> str:
    """Compress an OTF to WOFF2 alongside it. Returns one of:
       'ok' / 'no-bin' / 'err'."""
    try:
        result = subprocess.run(
            [WOFF2_BIN, str(otf_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return 'ok'
    except FileNotFoundError:
        return 'no-bin'
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return 'err'


def _open_and_generate(src: Path, open_target: str, face_name,
                       out_dir: Path, force: bool, do_woff2: bool,
                       dry_run: bool) -> dict:
    """Open one font, generate OTF + WOFF2. Returns one result dict.

    Writes a crash sentinel before calling fontforge.open() and clears it
    after. If FontForge segfaults mid-open, the sentinel survives and the
    next script run reads it to permanently blacklist that path.
    """
    rel_src = str(src.relative_to(ROOT))

    # Crash sentinel — survives SIGSEGV, read on next run.
    try:
        with open(CURRENT_FILE_SENTINEL, 'w') as sf:
            sf.write(rel_src + '\n')
            sf.flush()
            os.fsync(sf.fileno())
    except Exception:
        pass  # Sentinel write failure is non-fatal; we just lose recovery.

    try:
        font = fontforge.open(open_target)
    except Exception as e:
        _clear_sentinel()
        return {'src': rel_src, 'face': face_name,
                'status': 'err-open', 'detail': str(e)[:200]}

    # Open succeeded — sentinel can be cleared now.
    _clear_sentinel()

    try:
        ps_name = (font.fontname or '').strip()

        # Mac bitmap-suitcase detection: a real PostScript fontname can NEVER
        # contain a space (per the Type 1 spec). Files where `fontname` has a
        # space are bitmap-only suitcases — FontForge synthesises the family
        # name as the fontname. Generating an OTF from those produces ugly
        # bitmap-traced glyphs. Skip them.
        if ' ' in ps_name:
            font.close()
            return {'src': rel_src, 'face': face_name,
                    'status': 'skip-bitmap',
                    'detail': f'ps_name has space: {ps_name!r}'}

        if not ps_name:
            ps_name = face_name or src.stem
        out_stem = sanitise_filename(ps_name)
        out_otf = out_dir / f'{out_stem}.otf'

        if out_otf.exists() and not force:
            font.close()
            return {'src': rel_src, 'face': face_name,
                    'out': str(out_otf.relative_to(OUT_ROOT)),
                    'status': 'skip-exists'}

        if dry_run:
            font.close()
            return {'src': rel_src, 'face': face_name,
                    'out': str(out_otf.relative_to(OUT_ROOT)),
                    'status': 'dry-run'}

        generate_otf(font, out_otf)
        font.close()

        woff_status = 'skipped'
        if do_woff2:
            woff_status = run_woff2(out_otf)

        return {'src': rel_src, 'face': face_name,
                'out': str(out_otf.relative_to(OUT_ROOT)),
                'status': 'ok', 'woff2': woff_status}

    except Exception as e:
        try:
            font.close()
        except Exception:
            pass
        return {'src': rel_src, 'face': face_name,
                'status': 'err-generate',
                'detail': str(e)[:200],
                'trace': traceback.format_exc(limit=3)[-400:]}


def convert_path(src: Path, force: bool, do_woff2: bool, dry_run: bool):
    """Process one source path. Returns a list of result dicts (one per
    generated font — multi-face TTC/dfont files can produce many)."""
    cls = classify(src)
    if cls == 'skip':
        return [{'src': str(src.relative_to(ROOT)), 'status': 'skip'}]
    if cls == 'dead':
        return [{'src': str(src.relative_to(ROOT)),
                 'status': 'dead-resource-fork'}]

    out_dir = output_dir_for(src)

    # --- Mac LWFN (resource-fork PostScript Type 1) ---------------------
    # fontforge.fontsInFile() returns () empty for these files — it only
    # reads OTF/TTF/TTC headers, not Mac LWFN resource-fork structures.
    # But fontforge.open() handles them fine. So for LWFN-classified files
    # we bypass enumeration entirely and open directly.
    if cls == 'lwfn':
        return [_open_and_generate(src, str(src), None, out_dir,
                                   force, do_woff2, dry_run)]

    # --- Direct font formats (TTF/OTF/PFB/PFA/TTC/dfont) ----------------
    # Use fontsInFile to support multi-face files (.ttc, .dfont).
    try:
        faces = fontforge.fontsInFile(str(src))
    except Exception as e:
        return [{'src': str(src.relative_to(ROOT)),
                 'status': 'err-enumerate',
                 'detail': str(e)[:200]}]

    # Some single-face files (corrupt TTFs, weird formats) return empty.
    # Try a direct open() as a last resort before giving up.
    if not faces:
        return [_open_and_generate(src, str(src), None, out_dir,
                                   force, do_woff2, dry_run)]

    results = []
    for face_name in faces:
        # `path(facename)` syntax is needed for multi-face files.
        if len(faces) > 1:
            open_target = f'{src}({face_name})'
        else:
            open_target = str(src)
        results.append(_open_and_generate(src, open_target, face_name,
                                          out_dir, force, do_woff2, dry_run))
    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--only', default=None,
                        help='Only process this sub-path (relative to Fonts/), '
                             'e.g. "F/Frutiger" or "F" for all F-fonts.')
    parser.add_argument('--limit', type=int, default=None,
                        help='Stop after this many source files (for testing).')
    parser.add_argument('--no-woff2', action='store_true',
                        help='Skip WOFF2 generation (OTF only).')
    parser.add_argument('--force', action='store_true',
                        help='Overwrite existing OTF files.')
    parser.add_argument('--dry-run', action='store_true',
                        help='Walk + classify, but do not write any output.')
    args = parser.parse_args()

    # Determine walk root.
    walk_root = ROOT
    if args.only:
        candidate = ROOT / args.only
        if not candidate.exists():
            sys.exit(f'--only path does not exist: {candidate}')
        walk_root = candidate

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    log_path = OUT_ROOT / '_convert.log'
    summary_path = OUT_ROOT / '_convert-summary.json'

    # Crash recovery — if a sentinel exists from a previous run that
    # segfaulted, blacklist that path so we don't crash on it again.
    crashed = _recover_from_prior_crash()
    skip_list = _read_skip_list()
    if crashed and crashed in skip_list:
        print(f'[recover] {len(skip_list)} paths now permanently skip-listed.')
    elif skip_list:
        print(f'[recover] {len(skip_list)} paths in permanent skip-list.')

    # Check whether woff2_compress is available; warn once if not.
    do_woff2 = not args.no_woff2
    if do_woff2:
        try:
            subprocess.run([WOFF2_BIN, '--help'], capture_output=True, timeout=5)
        except FileNotFoundError:
            print(f'WARNING: `{WOFF2_BIN}` not found in PATH. '
                  f'OTFs will be written but WOFF2 skipped.')
            print(f'   Install via: brew install woff2')
            do_woff2 = False

    summary = {
        'started_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'root': str(ROOT),
        'walk_root': str(walk_root),
        'out_root': str(OUT_ROOT),
        'counts': {
            'src_seen': 0,
            'src_skip': 0,
            'src_dead': 0,
            'faces_ok': 0,
            'faces_skip_exists': 0,
            'faces_skip_bitmap': 0,
            'faces_err_open': 0,
            'faces_err_generate': 0,
            'faces_err_enumerate': 0,
            'woff2_ok': 0,
            'woff2_err': 0,
        },
        'failures': [],
        'dead_resource_forks': [],
    }

    log_fp = open(log_path, 'a')
    log_fp.write(f'\n===== Run started {summary["started_at"]} =====\n')

    src_count = 0
    t0 = time.time()

    for dirpath, dirnames, filenames in os.walk(walk_root):
        dp = Path(dirpath)
        # Never descend into the output directory.
        if OUT_ROOT == dp or OUT_ROOT in dp.parents:
            dirnames[:] = []
            continue
        # Deterministic order
        dirnames.sort()
        for fname in sorted(filenames):
            src = dp / fname
            summary['counts']['src_seen'] += 1

            if args.limit and src_count >= args.limit:
                break

            # Crash skip-list lookup — paths that crashed prior runs.
            rel = str(src.relative_to(ROOT))
            if rel in skip_list:
                line = f'[skip-crashed       ] {rel}  (prior FontForge crash)'
                print(line)
                log_fp.write(line + '\n')
                log_fp.flush()
                continue

            results = convert_path(src, force=args.force,
                                   do_woff2=do_woff2, dry_run=args.dry_run)
            for r in results:
                tag = r['status']
                if tag == 'skip':
                    summary['counts']['src_skip'] += 1
                    continue  # don't even print
                if tag == 'dead-resource-fork':
                    summary['counts']['src_dead'] += 1
                    summary['dead_resource_forks'].append(r['src'])
                elif tag == 'ok':
                    summary['counts']['faces_ok'] += 1
                    if r.get('woff2') == 'ok':
                        summary['counts']['woff2_ok'] += 1
                    elif r.get('woff2') == 'err':
                        summary['counts']['woff2_err'] += 1
                elif tag == 'skip-exists':
                    summary['counts']['faces_skip_exists'] += 1
                elif tag == 'skip-bitmap':
                    summary['counts']['faces_skip_bitmap'] += 1
                elif tag == 'err-open':
                    summary['counts']['faces_err_open'] += 1
                    summary['failures'].append(r)
                elif tag == 'err-generate':
                    summary['counts']['faces_err_generate'] += 1
                    summary['failures'].append(r)
                elif tag == 'err-enumerate':
                    summary['counts']['faces_err_enumerate'] += 1
                    summary['failures'].append(r)

                line = f'[{tag:18s}] {r.get("src","?")}'
                face = r.get('face') or ''
                if face:
                    line += f'  face={face}'
                if 'out' in r:
                    line += f'  -> {r["out"]}'
                if 'detail' in r:
                    line += f'  ({r["detail"]})'
                print(line)
                log_fp.write(line + '\n')

            log_fp.flush()
            src_count += 1

        if args.limit and src_count >= args.limit:
            break

    summary['finished_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    summary['elapsed_sec'] = round(time.time() - t0, 1)
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    log_fp.write(f'===== Run finished {summary["finished_at"]} '
                 f'({summary["elapsed_sec"]}s) =====\n')
    log_fp.close()

    c = summary['counts']
    print(f'\n----- DONE in {summary["elapsed_sec"]}s -----')
    print(f'  Sources seen:        {c["src_seen"]}')
    print(f'  Sources skipped:     {c["src_skip"]}  (sidecars, icons, dotfiles)')
    print(f'  Dead resource forks: {c["src_dead"]}  (lost data, cannot recover)')
    print(f'  Faces converted OK:  {c["faces_ok"]}')
    print(f'  Faces already exist: {c["faces_skip_exists"]}')
    print(f'  Bitmap suitcases:    {c["faces_skip_bitmap"]} (skipped — outline-less)')
    print(f'  WOFF2 created:       {c["woff2_ok"]}')
    print(f'  Errors:              open={c["faces_err_open"]} '
          f'enum={c["faces_err_enumerate"]} gen={c["faces_err_generate"]}')
    print(f'  Log:                 {log_path}')
    print(f'  Summary JSON:        {summary_path}')


if __name__ == '__main__':
    main()
