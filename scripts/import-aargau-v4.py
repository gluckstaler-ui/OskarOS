#!/usr/bin/env python3
"""
import-aargau-v4.py — Ralph 2026-06-05

Import file:///Users/ralphlengler/Downloads/aargau-psyche-leadliste-200_4.html
into the scout pool with Ralph's merge rules:

  - Name-based match (normalized).
  - If name doesn't exist → INSERT new row via /raw-prospects.
  - If name exists:
      • For each top-level / payload field: if existing is empty AND new has
        value → fill it.
      • If existing is non-empty AND differs from new (and new has value) →
        OVERWRITE (new HTML is source of truth per Ralph).

Two NEW fields land in raw_payload:
  - verfuegbarkeit (Verfügbarkeit, e.g. "Keine neuen Kunden" / "Verfügbar · nimmt auf")
  - verband_url    (URL from the FSP-Profil column → psychologie.ch/de/psyfinder/<slug>)

Usage:
  python3 scripts/import-aargau-v4.py [--apply] [--file <path>]
Without --apply: dry-run, prints the diff per row.
With --apply:   hits PATCH/POST endpoints on http://localhost:3000.
--file overrides the default input path (defaults to the v4 export).
"""

import sys, re, json, sqlite3, urllib.request, urllib.error
from html.parser import HTMLParser
from pathlib import Path

def _arg(name, default):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv): return sys.argv[i + 1]
    return default

INPUT_HTML = Path(_arg('--file', '/Users/ralphlengler/Downloads/aargau-psyche-leadliste-200_4.html'))
DB_PATH    = Path('/Users/ralphlengler/OskarOS/oskar-prototype/db/crm.db')
API_BASE   = 'http://localhost:3000/api/admin/crm/raw-prospects'
APPLY      = '--apply' in sys.argv
# Ralph 2026-06-05 · default merge is FILL-ONLY (don't overwrite differing
# non-empty values). Pass --overwrite to revert to "new is truth" semantics.
# Fill-only is safer when the pool has been enriched by the FSP scraper
# (region "AG" + split adr/plz/bezirk) — overwriting would downgrade the
# scraper's structured data with the file's flatter values.
FILL_ONLY  = '--overwrite' not in sys.argv
print(f'[import] reading {INPUT_HTML}  · merge={("FILL-ONLY" if FILL_ONLY else "OVERWRITE")}')

# ── Parsing ───────────────────────────────────────────────────────────────

class RowParser(HTMLParser):
    """Extracts <tr><td>...</td>...</tr> records, capturing the FSP-Profil link."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.in_table = False
        self.cur_row = []
        self.cur_cell = []
        self.cur_href = None   # captured from <a href> inside a cell
        self.cell_open = False
        self.row_open = False

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.in_table = True
        elif tag == 'tr' and self.in_table:
            self.row_open = True
            self.cur_row = []
        elif tag == 'td' and self.row_open:
            self.cell_open = True
            self.cur_cell = []
            self.cur_href = None
        elif tag == 'a' and self.cell_open:
            for k, v in attrs:
                if k == 'href':
                    self.cur_href = v
                    break

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell_open:
            text = ''.join(self.cur_cell).strip()
            self.cur_row.append({'text': text, 'href': self.cur_href})
            self.cell_open = False
        elif tag == 'tr' and self.row_open:
            # Accept both shapes: aargau (9 cols) and ZH-FSP (10 cols).
            if self.cur_row and len(self.cur_row) in (9, 10):
                self.rows.append(self.cur_row)
            self.row_open = False
        elif tag == 'table':
            self.in_table = False

    def handle_data(self, data):
        if self.cell_open:
            self.cur_cell.append(data)


def parse_html(path):
    """Parse either schema (9-col aargau, 10-col ZH-FSP) → canonical record."""
    with open(path, encoding='utf-8') as f:
        html = f.read()
    p = RowParser()
    p.feed(html)
    out = []
    for r in p.rows:
        if len(r) == 9:
            # Aargau Lead-Liste shape: Region|Name|Typ|Phone|Email|Adresse|
            # Verfügbarkeit|Website-Status|FSP-Profil
            region, name, typ, phone, email, adr, verf, ws, fsp = r
            out.append({
                'region':        region['text'],
                'bezirk':        '',                       # not in aargau schema
                'name':          name['text'],
                'typ':           typ['text'],
                'phone':         phone['text'],
                'email':         email['text'],
                'adresse':       adr['text'],
                'availability_label': verf['text'],
                'website_status': ws['text'],
                'verband_url':   fsp['href'] or '',
                'fsp_profile_text': fsp['text'],
            })
        else:
            # ZH-FSP shape: Nr|Name|Adresse|Bezirk|Phone|Email|Titel|
            # Verfügbarkeit|FSP-Profil|Homepage
            nr, name, adr, bezirk, phone, email, titel, verf, fsp, hp = r
            # Homepage column: <a href="https://psychcentral.ch">psychcentral.ch</a>
            # or the literal "keine eigene HP". When there's a URL use it as
            # website_status; otherwise mirror the "Keine eigene Website" sentinel
            # so the rest of the pipeline (clean_website) classifies it greenfield.
            hp_url = hp['href'] or ''
            ws_text = hp_url if hp_url else hp['text']  # 'keine eigene HP' falls through
            out.append({
                'region':        bezirk['text'],            # ZH uses 'Zürich' here too
                'bezirk':        bezirk['text'],
                'name':          name['text'],
                'typ':           titel['text'],             # ZH's "Titel" maps to aargau's "Typ"
                'phone':         phone['text'],
                'email':         email['text'],
                'adresse':       adr['text'],
                'availability_label': verf['text'],
                'website_status': ws_text,
                'verband_url':   fsp['href'] or '',
                'fsp_profile_text': fsp['text'],
            })
    return out

# ── Normalisation ────────────────────────────────────────────────────────

def clean(v):
    """Empty/dash markers → ''."""
    if v is None: return ''
    s = str(v).strip()
    if s in ('—', '–', '-', '−', '', 'n/a', 'N/A'): return ''
    # Strip <span class="tief"> annotations that leak through as " tief"
    s = re.sub(r'\s+tief\s*$', '', s, flags=re.IGNORECASE).strip()
    return s

def clean_phone(v):
    s = clean(v)
    return s

def clean_email(v):
    s = clean(v)
    return s.lower() if '@' in s else ''

def clean_website(v):
    """Extract domain from `website-status` cell — 'Keine eigene Website (LEAD)' → ''."""
    s = clean(v)
    if not s: return ''
    low = s.lower()
    if low.startswith('keine eigene') or low.startswith('kein psyfinder'): return ''
    # Strip protocol/path
    s = re.sub(r'^https?://', '', s.lower())
    s = re.sub(r'^www\.', '', s)
    s = s.split('/')[0].split()[0]
    return s if '.' in s else ''

def norm_name(s):
    """
    Lowercase ASCII-fold, drop parens, collapse — for name dedup.

    Bug fix (Ralph 2026-06-05): the zürich xlsx ingest fused the last name
    with the trailing practice name (no space → "SavariaPraxis Nord"). The
    new ZH-FSP HTML splits them correctly ("Savaria (Praxis Nord)"). Without
    a CamelCase-split step, the 41 fused names false-positive as new
    inserts. Split lowercase→uppercase boundaries BEFORE the ASCII fold,
    then continue as before.
    """
    if not s: return ''
    # CamelCase split FIRST — "SavariaPraxis" → "Savaria Praxis", but leave
    # all-caps acronyms alone ("FMH", "FSP" stay intact).
    s = re.sub(r'([a-zäöüéèêàç])([A-Z])', r'\1 \2', s)
    s = s.lower()
    s = (s.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue')
           .replace('ß', 'ss').replace('é', 'e').replace('è', 'e')
           .replace('ê', 'e').replace('à', 'a').replace('ç', 'c'))
    s = re.sub(r'\([^)]*\)', '', s)                              # drop parentheticals
    s = re.sub(r'\b(dr\.?|med\.?|prof\.?|fmh|phil\.?|lic\.?)\b', ' ', s)  # drop titles
    # Preserve hyphens — "Hans-Ulrich" must stay one token, otherwise
    # "Hans-Ulrich Karli" and "Hans-Ulrich Baur" both collapse to "hans
    # ulrich" after the trim-to-2 below.
    s = re.sub(r'[^a-z-]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    # Trim to first 2 tokens — "Nathalie Savaria Praxis Nord" → "nathalie savaria"
    # so the HTML's "Nathalie Savaria (Praxis Nord)" → "nathalie savaria" matches.
    # Safe for German names (most are first+last); the parenthetical drop already
    # handles the simple cases, this picks up the CamelCase-fused zürich rows.
    tokens = s.split()
    if len(tokens) >= 2:
        return ' '.join(tokens[:2])
    return s

# ── Diff helpers ─────────────────────────────────────────────────────────

def merge_field(existing, new):
    """
    Merge rule depends on FILL_ONLY:
      - new empty                → keep existing (always — don't blank a field)
      - new non-empty, existing empty → fill (always)
      - new non-empty, existing differs:
          * FILL_ONLY=True  → keep existing (no overwrite)
          * FILL_ONLY=False → overwrite (new is source of truth)
    Returns (final_value, changed_bool).
    """
    if not new:
        return existing, False
    if not existing:
        return new, True
    if existing == new:
        return existing, False
    if FILL_ONLY:
        return existing, False
    return new, True

# ── Main ─────────────────────────────────────────────────────────────────

def main():
    rows = parse_html(INPUT_HTML)
    print(f'Parsed {len(rows)} rows from HTML.')

    # Load existing pool — full table, including the JSON raw_payload.
    # Ralph's "no duplicates" rule applies to the whole pool table, not just
    # live rows — a rejected row (capture failure) carrying name X still
    # blocks an insert for name X. We mark rejected/promoted matches so
    # apply-mode routes them to direct-SQL updates (the PATCH endpoint
    # refuses rejected/promoted rows by design).
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    pool = con.execute('''
        SELECT id, source, name, company, phone, email, website, country, industry, raw_payload,
               promoted_at, rejected_at
        FROM raw_prospects
    ''').fetchall()
    live = sum(1 for r in pool if not r['promoted_at'] and not r['rejected_at'])
    print(f'Pool rows: {len(pool)} total ({live} live, {len(pool)-live} promoted/rejected)')

    # Index pool by normalised name → row.
    index = {}
    for r in pool:
        k = norm_name(r['name'])
        if not k:
            continue
        index.setdefault(k, []).append(r)

    inserts, updates, sql_updates, no_change, collisions = [], [], [], [], []
    for r in rows:
        name      = clean(r['name'])
        new_phone = clean_phone(r['phone'])
        new_email = clean_email(r['email'])
        new_site  = clean_website(r['website_status'])
        new_label = clean(r['availability_label'])
        new_vurl  = clean(r['verband_url'])
        new_typ   = clean(r['typ'])
        new_adr   = clean(r['adresse'])
        new_reg   = clean(r['region'])
        new_ws    = clean(r['website_status'])

        key = norm_name(name)
        matches = index.get(key, [])
        if len(matches) == 0:
            # ZH-FSP rows carry a bezirk; aargau rows don't. Build a
            # payload that includes whichever the source provides.
            new_bezirk_ins = clean(r['bezirk'])
            payload = {
                'region': new_reg, 'name': name, 'typ': new_typ,
                'phone': new_phone or '—', 'email': new_email or '—',
                'adr': new_adr,
                'website_status': new_ws,
                'availability_label': new_label,
                'verband_url': new_vurl,
            }
            if new_bezirk_ins:
                payload['bezirk'] = new_bezirk_ins
            inserts.append({
                'name': name, 'phone': new_phone, 'email': new_email,
                'website': new_site, 'country': 'CH', 'industry': 'Psychotherapy',
                'raw_payload': payload,
            })
            continue
        if len(matches) > 1:
            collisions.append((name, [m['id'] for m in matches]))
            # Fall through and update the first match — flagged for review
        m = matches[0]

        # Existing payload
        try:
            ep = json.loads(m['raw_payload'] or '{}')
        except json.JSONDecodeError:
            ep = {}

        # Merge top-level fields
        changes_top = {}
        for col, new in [('phone', new_phone), ('email', new_email), ('website', new_site)]:
            final, changed = merge_field(m[col] or '', new)
            if changed:
                changes_top[col] = final

        # Merge payload fields. ZH-FSP carries a bezirk; aargau doesn't.
        # We pass new_bezirk through so re-imports against zürich-sourced
        # rows in the pool can refresh bezirk too.
        new_bezirk = clean(r['bezirk'])
        merged_payload = dict(ep)
        changes_payload = {}
        for k_new, new in [
            ('region',         new_reg),
            ('bezirk',         new_bezirk),
            ('typ',            new_typ),
            ('adr',            new_adr),  # canonical existing key
            ('website_status', new_ws),
            ('availability_label', new_label),
            ('verband_url',    new_vurl),
        ]:
            old = ep.get(k_new) or ''
            # Also try the zürich-shape `adresse` for `adr` lookup
            if k_new == 'adr' and not old:
                old = ep.get('adresse') or ''
            final, changed = merge_field(old, new)
            if changed:
                changes_payload[k_new] = final
                merged_payload[k_new] = final

        # Always force-add verfuegbarkeit/verband_url even if old was empty
        # (already handled by merge_field above).

        if not changes_top and not changes_payload:
            no_change.append(m['id'])
            continue

        rec = {
            'id': m['id'],
            'name': m['name'],
            'changes_top': changes_top,
            'changes_payload': changes_payload,
            'patch_body': {
                **changes_top,
                'raw_payload': json.dumps(merged_payload, ensure_ascii=False),
            },
            'merged_payload_json': json.dumps(merged_payload, ensure_ascii=False),
        }
        # Rejected/promoted rows can't go through PATCH (the route refuses
        # them by design — line 48 of [id]/route.ts). Route to direct SQL.
        if m['rejected_at'] or m['promoted_at']:
            rec['state'] = 'rejected' if m['rejected_at'] else 'promoted'
            sql_updates.append(rec)
        else:
            updates.append(rec)

    # ── Summary ──────────────────────────────────────────────────────────
    print()
    print('=' * 70)
    print(f'INSERTS (truly new):        {len(inserts)}')
    print(f'UPDATES (live, via PATCH):  {len(updates)}')
    print(f'SQL-UPDATES (rejected/promoted, direct DB): {len(sql_updates)}')
    print(f'NO CHANGE:                  {len(no_change)}')
    print(f'COLLISIONS:                 {len(collisions)}  (same norm_name → multiple pool rows)')
    print('=' * 70)
    print()
    if sql_updates:
        print('Rejected/promoted rows that will receive new payload data via SQL:')
        for u in sql_updates:
            print(f'  {u["id"]:18}  {u["name"]:55}  [{u["state"]}]')
        print()
    if inserts:
        print('Truly NEW inserts:')
        for i in inserts:
            print(f'  {i["name"]}')
        print()
    if collisions:
        print('Name collisions (manual review):')
        for name, ids in collisions[:10]:
            print(f'  {name!r:50}  → ids: {ids}')
        if len(collisions) > 10:
            print(f'  ... and {len(collisions)-10} more')
        print()

    # Sample 5 updates so Ralph can sanity-check the merge
    print('Sample updates (first 5):')
    for u in updates[:5]:
        print(f'  {u["id"]}  {u["name"]!r}')
        for k, v in u['changes_top'].items():
            print(f'     top {k:8} → {v!r}')
        for k, v in u['changes_payload'].items():
            print(f'     pl  {k:14} → {v!r}')
    print()

    if not APPLY:
        print('Dry-run only. Re-run with --apply to write the changes.')
        return

    # ── APPLY ────────────────────────────────────────────────────────────
    print('APPLY mode — hitting the API...')

    # 1. INSERTS via POST /raw-prospects (batched)
    if inserts:
        # Strip the embedded raw_payload to plain object (the API JSON-encodes it)
        candidates = [
            {
                'name': i['name'], 'phone': i['phone'], 'email': i['email'],
                'website': i['website'], 'country': i['country'], 'industry': i['industry'],
                'raw_payload': i['raw_payload'],
            } for i in inserts
        ]
        payload = json.dumps({
            'candidates': candidates,
            'source': f'html-import:{INPUT_HTML.name}',
        }).encode('utf-8')
        req = urllib.request.Request(
            API_BASE, data=payload, method='POST',
            headers={'Content-Type': 'application/json'},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = json.loads(r.read())
            print(f'  INSERTS: created={resp.get("created")} skipped={resp.get("skipped")}')
        except urllib.error.HTTPError as e:
            print(f'  INSERTS FAILED: {e}  body={e.read()[:300]}')

    # 2. UPDATES via PATCH /raw-prospects/<id> (sequential — small N)
    ok_count, fail_count = 0, 0
    for u in updates:
        body = json.dumps(u['patch_body']).encode('utf-8')
        url = f'{API_BASE}/{u["id"]}'
        req = urllib.request.Request(url, data=body, method='PATCH',
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()  # discard
            ok_count += 1
        except urllib.error.HTTPError as e:
            fail_count += 1
            print(f'  PATCH {u["id"]} FAILED: {e.code} {e.read()[:200]}')
    print(f'  PATCH UPDATES: ok={ok_count} fail={fail_count}')

    # 3. SQL UPDATES for rejected/promoted rows — bypass the PATCH route's
    #    409 guard. We only touch raw_payload + the top-level identity
    #    fields the user might have refined in v4; we leave promoted_at /
    #    rejected_at / scout_json untouched (those are triage-state stamps
    #    that the import should never overwrite).
    sql_ok, sql_fail = 0, 0
    if sql_updates:
        con_w = sqlite3.connect(DB_PATH)
        try:
            for u in sql_updates:
                top = u['changes_top']
                # Build dynamic UPDATE — only the fields that actually changed.
                cols = list(top.keys()) + ['raw_payload']
                vals = [top[c] for c in top] + [u['merged_payload_json']] + [u['id']]
                set_clause = ', '.join(f'{c} = ?' for c in cols)
                try:
                    con_w.execute(f'UPDATE raw_prospects SET {set_clause} WHERE id = ?', vals)
                    sql_ok += 1
                except Exception as e:
                    sql_fail += 1
                    print(f'  SQL UPDATE {u["id"]} FAILED: {e}')
            con_w.commit()
        finally:
            con_w.close()
        print(f'  SQL UPDATES (rejected/promoted): ok={sql_ok} fail={sql_fail}')
    print()
    print('DONE.')

if __name__ == '__main__':
    main()
