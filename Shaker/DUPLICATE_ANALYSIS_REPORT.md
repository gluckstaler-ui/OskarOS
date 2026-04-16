# Duplicate Track Analysis — Complete Report

Generated: 2026-03-17 18:01:04

## Executive Summary

Analysis of all 6 HITS pool files identified extensive duplication both within individual pools and across pools. The redundancy represents significant opportunity for consolidation.

### Scope

- **Total tracks parsed:** 2,215
- **Files processed:** 6 HITS markdown files
- **Analysis method:** Normalized artist + title matching (case-insensitive, whitespace-stripped)

### Key Findings

| Metric | Count |
|--------|-------|
| **Within-pool duplicate groups** | 434 |
| **Extra files (removable from within-pool)** | 779 |
| **Cross-pool duplicate groups** | 454 |
| **Pools affected by cross-pool duplication** | 6 |

## Details by Pool

### Pool: _60 (60s Hits)

- **Total tracks:** 35
- **Within-pool duplicates:** 1 group (Creedence Clearwater Revival — Proud Mary)
- **Cross-pool appearances:** 1 track (The Equals — Baby Come Back)

### Pool: _70 (70s Hits)

- **Total tracks:** 204
- **Within-pool duplicates:** 53 groups
- **Within-pool removable files:** 98
- **Cross-pool appearances:** Multiple (ABBA, Earth Wind & Fire, Diana Ross, etc.)

### Pool: _80 (80s Hits)

- **Total tracks:** 910
- **Within-pool duplicates:** 293 groups (largest pool)
- **Within-pool removable files:** 532
- **Cross-pool appearances:** Multiple

### Pool: Clube Killers

- **Total tracks:** 718
- **Within-pool duplicates:** 62 groups
- **Within-pool removable files:** 102
- **Cross-pool appearances:** Multiple

### Pool: Dance 2000

- **Total tracks:** 231
- **Within-pool duplicates:** 25 groups
- **Within-pool removable files:** 40
- **Cross-pool appearances:** Multiple

### Pool: AfroBeats e Amapiano

- **Total tracks:** 117
- **Within-pool duplicates:** 1 group
- **Within-pool removable files:** 5
- **Cross-pool appearances:** Minimal

## Most Duplicated Tracks (Cross-Pool)

The following tracks appear in the most pools (by listener count):

1. **ABBA — Dancing Queen** (2.5M listeners) - 4 versions across 2 pools
2. **Daft Punk — One More Time** (2.3M listeners) - 4 versions across 2 pools
3. **Earth, Wind & Fire — September** (2.1M listeners) - 3 versions across 2 pools
4. **Bon Jovi — Livin' on a Prayer** (2.0M listeners) - 4 versions across 2 pools
5. **Smash Mouth — All Star** (1.6M listeners) - 2 versions across 2 pools

## Highest Within-Pool Duplication

The 80 pool contains the most within-pool duplicates:
- Gloria Gaynor — I Will Survive (4 versions)
- Marvin Gaye & Tammi Terrell — You're All I Need to Get By (4 versions)
- Michael Jackson — Don't Stop 'Til You Get Enough (3 versions)
- Multiple tracks with 2-3 remix versions

## Output File

Complete detail available in: **duplicates_for_claude_code.md**

Structure:
- **Summary Stats** — Key metrics
- **Within-Pool Duplicates** — Organized by pool, sorted by listener count
- **Cross-Pool Duplicates** — Tracks appearing in multiple pools

Each entry includes:
- Artist name
- Track title
- Listener count
- Number of versions found
- Exact filenames for each version

## Recommendations

1. **Within-pool cleanup:** The 779 extra files represent remix redundancy that could be consolidated. Keep the highest-listener version of each song per pool.

2. **Cross-pool strategy:** 454 duplicates across pools suggest intentional seeding across different vibe collections, or unintended overlap. Review whether duplicates serve distinct purposes in different contexts.

3. **Data integrity:** Naming inconsistencies (e.g., "Creedance" vs "Creedence") suggest source data normalization may be needed for future imports.

## Next Steps for Claude Code

Use `duplicates_for_claude_code.md` to:
- Generate removal lists (keep 1 per song per pool)
- Identify cross-pool consolidation opportunities
- Audit the intentionality of duplicates per vibe

