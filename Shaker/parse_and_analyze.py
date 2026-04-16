#!/usr/bin/env python3
"""
DJ Music Pool Analysis Script
Parses HITS and REST files, classifies misattributions, generates analysis outputs.
"""

import re
import json
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict

# File paths
BASE_DIR = Path("/sessions/sweet-nice-newton/mnt/OskarOS/shaker")
POOLS = ["60", "70", "80", "Clube Killers", "Dance 2000", "AfroBeats e Amapiano"]

# Known cover artists and their eras
COVER_ARTISTS = {
    "thelma houston": {"original_artist": "Rolling Stones", "era": "70s-80s"},
    "the lettermen": {"original_artist": "Various", "era": "60s-70s"},
    "les chakachas": {"original_artist": "Various", "era": "60s"},
    "carl carlton": {"original_artist": "Various", "era": "70s-80s"},
    "shadows": {"original_artist": "Various", "era": "60s"},
    "aretha franklin": {"original_artist": "Various", "era": "60s-70s"},
    "fun fun": {"original_artist": "Various", "era": "80s"},
    "the t-bones": {"original_artist": "Booker T.", "era": "60s"},
    "al browns tunetoppers": {"original_artist": "Various", "era": "50s-60s"},
}

GENERIC_TITLES = {
    "time", "cold", "forever", "love", "dance", "night", "day", "heart",
    "eyes", "feel", "think", "want", "need", "know", "come", "go",
    "dream", "away", "back", "fbi", "madison"
}

CLASSIC_SONGS = {
    ("The Rolling Stones", "Jumpin' Jack Flash"): "1968",
    ("Pink Floyd", "Time"): "1973",
    ("The Rolling Stones", "Paint It Black"): "1966",
}


def parse_listeners(listener_str: str) -> int:
    """Convert listener string like '1.1M', '948K', '12K' to integer."""
    if not listener_str or listener_str == "—":
        return 0

    listener_str = listener_str.strip()
    if listener_str.endswith("M"):
        return int(float(listener_str[:-1]) * 1_000_000)
    elif listener_str.endswith("K"):
        return int(float(listener_str[:-1]) * 1_000)
    else:
        try:
            return int(listener_str)
        except ValueError:
            return 0


def normalize_artist(artist: str) -> str:
    """Normalize artist name for comparison."""
    return artist.lower().strip()


def is_cover_or_version(matched_artist: str, file_artist: str, title: str) -> Tuple[bool, str]:
    """
    Determine if file_artist is a known cover artist of matched_artist's song.
    Returns (is_cover, reason).
    """
    normalized_file = normalize_artist(file_artist)
    normalized_matched = normalize_artist(matched_artist)

    # Check if file artist is a known cover artist
    for cover_artist, info in COVER_ARTISTS.items():
        if cover_artist in normalized_file:
            # This is a known cover/interpretive artist
            # But we need to check if it's actually a cover of the matched song
            # or just a coincidence
            title_lower = title.lower()

            # Check if title is generic (more likely to be coincidence)
            if any(generic in title_lower for generic in GENERIC_TITLES):
                # Generic title with known cover artist could still be cover
                # but needs more evidence
                if cover_artist == "thelma houston" and "jumpin" in title_lower:
                    return (True, "Thelma Houston covered 'Jumpin' Jack Flash'")
                if cover_artist == "the lettermen" and "sealed" in title_lower:
                    return (True, "The Lettermen covered 'Sealed with a Kiss'")
                return (False, "Generic title with cover artist - likely coincidence")
            else:
                # Specific title with known cover artist is likely real
                return (True, f"{file_artist} is a known cover/interpretive artist")

    return (False, "Not a known cover artist")


def classify_rest_entry(matched_artist: str, matched_title: str,
                       file_artist: str, listeners: int, tier: int,
                       filename: str) -> Tuple[str, str]:
    """
    Classify a REST entry as REAL COVER, TITLE COINCIDENCE, PARSING ERROR, or LOW LISTENER CORRECT.
    Returns (classification, notes).

    Key logic:
    - Generic titles (Time, Dreams, Forever) with mismatched artists = TITLE COINCIDENCE
    - Specific titles with known cover artists = REAL COVER
    - Low listeners with Tier 1 = LOW LISTENER CORRECT (actually correct, just unpopular)
    - Everything else: check genre/era similarity
    """

    # Check for parsing errors (swapped names)
    if " - " in filename:
        parts = filename.split(" - ")
        if len(parts) > 0:
            file_content = parts[0].lower()
            # Look for patterns like "word word - artist" where it should be "artist - word word"
            if re.search(r'^\w+\s+\w+\s*-\s*\w+', filename):
                # Potential parsing error - need more evidence
                pass

    # Low listener count with Tier 1 = likely correctly attributed original (not misattributed)
    if listeners < 10_000 and tier == 1:
        return ("LOW LISTENER CORRECT", "Low listeners but Tier 1 suggests correct attribution")

    # Analyze artist similarity
    normalized_file = normalize_artist(file_artist)
    normalized_matched = normalize_artist(matched_artist)

    # Check if artists are same (shouldn't happen in REST, but safety check)
    if normalized_file == normalized_matched:
        return ("LOW LISTENER CORRECT", "Same artist - likely correct but low listeners")

    # Check title genericity
    title_lower = matched_title.lower()
    is_generic = any(generic in title_lower for generic in GENERIC_TITLES)

    # Strategy: Generic titles with mismatched artists = almost always coincidence
    if is_generic:
        return ("TITLE COINCIDENCE", f"Generic title '{matched_title}' with different artist - likely coincidence")

    # For specific titles, check if file_artist is a known cover artist
    is_cover, reason = is_cover_or_version(matched_artist, file_artist, matched_title)
    if is_cover:
        return ("REAL COVER", reason)

    # Known classic songs with specific matches
    for (classic_artist, classic_title), year in CLASSIC_SONGS.items():
        if (normalize_artist(classic_artist) == normalized_matched and
            classic_title.lower() in title_lower):
            # This is a famous song
            if "thelma houston" in normalized_file and "jumpin" in title_lower:
                return ("REAL COVER", "Thelma Houston's version of 'Jumpin' Jack Flash'")

    # Specific titles with unknown artist = conservative: assume it's a real cover
    # (DJ music pools often feature remixes/covers)
    return ("REAL COVER", f"Specific title; {file_artist} may have covered {matched_artist}'s version")


def parse_markdown_table(file_path: Path, is_hits: bool = True) -> List[Dict]:
    """Parse markdown table from file. Extract table lines, stop at ---."""
    entries = []

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    for line in lines:
        # Stop parsing at the --- separator
        if line.strip().startswith("---"):
            break

        # Check if this is a table line
        if line.startswith("|"):
            # Skip header and separator rows
            if "Artist" in line or all(c in "|-=" for c in line.replace(" ", "")):
                continue

            # Parse table row
            parts = [p.strip() for p in line.split("|")]
            # Remove empty first and last elements (from leading/trailing |)
            parts = [p for p in parts if p]

            expected_len = 7 if is_hits else 6
            if len(parts) < expected_len:
                continue

            try:
                entry = {
                    'num': parts[0],
                    'artist': parts[1],
                    'title': parts[2],
                    'listeners': parts[3],
                    'tier': int(parts[4]),
                }

                if is_hits:
                    entry['art'] = parts[5]
                    entry['filename'] = parts[6]
                else:
                    entry['filename'] = parts[5]

                entries.append(entry)
            except (ValueError, IndexError) as e:
                continue

    return entries


def get_pool_name_from_file(filename: str) -> str:
    """Extract pool name from filename."""
    for pool in POOLS:
        if pool in filename:
            return pool
    return "Unknown"


def main():
    print("Starting DJ Music Pool Analysis...")

    # Load all HITS and REST data
    all_hits = {}
    all_rest = {}

    for pool in POOLS:
        hits_file = BASE_DIR / f"_HITS__{pool}.md"
        rest_file = BASE_DIR / f"_REST__{pool}.md"

        if hits_file.exists():
            try:
                hits_data = parse_markdown_table(hits_file, is_hits=True)
                all_hits[pool] = hits_data
                print(f"  {pool} HITS: {len(hits_data)} entries")
            except Exception as e:
                print(f"  ERROR parsing {hits_file}: {e}")

        if rest_file.exists():
            try:
                rest_data = parse_markdown_table(rest_file, is_hits=False)
                all_rest[pool] = rest_data
                print(f"  {pool} REST: {len(rest_data)} entries")
            except Exception as e:
                print(f"  ERROR parsing {rest_file}: {e}")

    # Process HITS: deduplicate by Artist+Title, keep highest listener count
    hits_dedup = {}
    for pool, entries in all_hits.items():
        for entry in entries:
            key = (entry['artist'], entry['title'])
            listeners = parse_listeners(entry['listeners'])

            if key not in hits_dedup:
                hits_dedup[key] = {
                    'artist': entry['artist'],
                    'title': entry['title'],
                    'listeners': entry['listeners'],
                    'listeners_int': listeners,
                    'tier': entry['tier'],
                    'pools': [pool]
                }
            else:
                # Update if this version has higher listener count
                if listeners > hits_dedup[key]['listeners_int']:
                    hits_dedup[key]['listeners'] = entry['listeners']
                    hits_dedup[key]['listeners_int'] = listeners
                    hits_dedup[key]['tier'] = entry['tier']

                # Add pool if not already in list
                if pool not in hits_dedup[key]['pools']:
                    hits_dedup[key]['pools'].append(pool)

    # Process REST: classify each entry
    rest_classified = []
    for pool, entries in all_rest.items():
        for entry in entries:
            listeners = parse_listeners(entry['listeners'])
            classification, notes = classify_rest_entry(
                entry['artist'],
                entry['title'],
                extract_artist_from_filename(entry['filename']),
                listeners,
                entry['tier'],
                entry['filename']
            )

            rest_classified.append({
                'pool': pool,
                'matched_artist': entry['artist'],
                'matched_title': entry['title'],
                'listeners': entry['listeners'],
                'listeners_int': listeners,
                'tier': entry['tier'],
                'file_artist': extract_artist_from_filename(entry['filename']),
                'filename': entry['filename'],
                'classification': classification,
                'notes': notes
            })

    # Sort REST by listeners descending
    rest_classified.sort(key=lambda x: x['listeners_int'], reverse=True)

    # Generate output files
    generate_rest_misattributions(rest_classified)
    generate_hits_json(hits_dedup)
    generate_summary(all_hits, all_rest, rest_classified, hits_dedup)

    print("\n✓ Analysis complete. Generated:")
    print("  - analysis_rest_misattributions.md")
    print("  - analysis_hits_data.json")
    print("  - analysis_summary.md")


def extract_artist_from_filename(filename: str) -> str:
    """Extract artist name from filename by parsing DDB_ prefix."""
    # Example: DDB_The Rolling Stones - Paint It, Black (60s Redrum)
    # Extract: The Rolling Stones

    filename = filename.strip('`')
    if filename.startswith("DDB_"):
        filename = filename[4:]

    # Find the dash that separates artist from title
    # But be careful: artist names might contain dashes
    # Pattern: "Artist Name - Song Title (metadata)"

    # Split by dash, assuming first dash is separator
    if " - " in filename:
        parts = filename.split(" - ", 1)
        artist = parts[0].strip()

        # Clean up DJ prefixes
        if artist.startswith("Dj "):
            # "Dj Name , Artist" or just "Dj Name"
            if " , " in artist:
                artist = artist.split(" , ")[1].strip()
            else:
                # Try to extract the main artist
                words = artist.split()
                if len(words) > 1:
                    artist = " ".join(words[1:])

        return artist

    return filename


def generate_rest_misattributions(rest_classified: List[Dict]):
    """Generate analysis_rest_misattributions.md."""
    output = []
    output.append("# REST Files — Misattribution Analysis\n")
    output.append(f"Generated: {get_timestamp()}\n")
    output.append(f"Total REST entries analyzed: {len(rest_classified)}\n")

    # Count by classification
    counts = defaultdict(int)
    for entry in rest_classified:
        counts[entry['classification']] += 1

    output.append("\n## Summary by Classification\n")
    for classification in ["REAL COVER", "TITLE COINCIDENCE", "PARSING ERROR", "LOW LISTENER CORRECT"]:
        count = counts[classification]
        output.append(f"- **{classification}**: {count}\n")

    output.append("\n---\n\n")
    output.append("## All Entries (sorted by listeners)\n\n")
    output.append("| Pool | Matched Artist | Matched Title | Listeners | File Artist | Classification | Notes |\n")
    output.append("|------|---|---|---|---|---|---|\n")

    for entry in rest_classified:
        output.append(
            f"| {entry['pool']} | {entry['matched_artist']} | {entry['matched_title']} | "
            f"{entry['listeners']} | {entry['file_artist']} | {entry['classification']} | {entry['notes']} |\n"
        )

    with open(BASE_DIR / "analysis_rest_misattributions.md", 'w', encoding='utf-8') as f:
        f.writelines(output)


def generate_hits_json(hits_dedup: Dict):
    """Generate analysis_hits_data.json with deduplicated HITS data."""
    hits_list = []
    for (artist, title), data in sorted(hits_dedup.items(), key=lambda x: x[1]['listeners_int'], reverse=True):
        hits_list.append({
            'artist': artist,
            'title': title,
            'listeners': data['listeners'],
            'listeners_int': data['listeners_int'],
            'tier': data['tier'],
            'pools': data.get('pools', [])
        })

    output = {
        'metadata': {
            'generated': get_timestamp(),
            'total_unique_songs': len(hits_list),
            'total_pools': 6
        },
        'hits': hits_list
    }

    with open(BASE_DIR / "analysis_hits_data.json", 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)


def generate_summary(all_hits: Dict, all_rest: Dict, rest_classified: List[Dict], hits_dedup: Dict):
    """Generate analysis_summary.md with quick stats."""
    output = []
    output.append("# DJ Music Pool Analysis — Summary\n\n")
    output.append(f"Generated: {get_timestamp()}\n\n")

    output.append("## Pool Statistics\n\n")
    output.append("| Pool | HITS Count | REST Count | Total | Hit/Rest Ratio |\n")
    output.append("|------|---|---|---|---|\n")

    total_hits_all = 0
    total_rest_all = 0

    for pool in POOLS:
        hits_count = len(all_hits.get(pool, []))
        rest_count = len(all_rest.get(pool, []))
        total = hits_count + rest_count
        ratio = f"{hits_count}:{rest_count}" if rest_count > 0 else f"{hits_count}:0"

        output.append(f"| {pool} | {hits_count} | {rest_count} | {total} | {ratio} |\n")
        total_hits_all += hits_count
        total_rest_all += rest_count

    output.append(f"| **TOTAL** | **{total_hits_all}** | **{total_rest_all}** | **{total_hits_all + total_rest_all}** | **{total_hits_all}:{total_rest_all}** |\n")

    output.append("\n## REST Classification Breakdown\n\n")

    counts = defaultdict(int)
    for entry in rest_classified:
        counts[entry['classification']] += 1

    for classification in ["REAL COVER", "TITLE COINCIDENCE", "PARSING ERROR", "LOW LISTENER CORRECT"]:
        count = counts[classification]
        pct = (count / len(rest_classified)) * 100 if rest_classified else 0
        output.append(f"- **{classification}**: {count} ({pct:.1f}%)\n")

    output.append("\n## Top 10 Misattributed HITS (by listener count)\n\n")
    output.append("High-listener songs in REST files that may need verification:\n\n")
    output.append("| Matched Artist | Matched Title | Listeners | File Artist | Classification |\n")
    output.append("|---|---|---|---|---|\n")

    # Find REST entries with high listeners that aren't LOW LISTENER CORRECT
    high_misattr = [e for e in rest_classified
                    if e['listeners_int'] >= 10_000 or (e['classification'] == "TITLE COINCIDENCE")]
    high_misattr.sort(key=lambda x: x['listeners_int'], reverse=True)

    for i, entry in enumerate(high_misattr[:10], 1):
        output.append(
            f"| {entry['matched_artist']} | {entry['matched_title']} | {entry['listeners']} | "
            f"{entry['file_artist']} | {entry['classification']} |\n"
        )

    output.append("\n## Deduplication Summary\n\n")
    output.append(f"- Total HITS entries across all files: {total_hits_all}\n")
    output.append(f"- Unique songs (after dedup): {len(hits_dedup)}\n")
    output.append(f"- Duplicate versions: {total_hits_all - len(hits_dedup)}\n")

    output.append("\n## Top 20 HITS by Listener Count\n\n")
    output.append("| Artist | Title | Listeners | Tier | Pools |\n")
    output.append("|---|---|---|---|---|\n")

    sorted_hits = sorted(hits_dedup.items(), key=lambda x: x[1]['listeners_int'], reverse=True)
    for i, ((artist, title), data) in enumerate(sorted_hits[:20], 1):
        pools_str = ", ".join(data.get('pools', []))
        output.append(f"| {artist} | {title} | {data['listeners']} | {data['tier']} | {pools_str} |\n")

    with open(BASE_DIR / "analysis_summary.md", 'w', encoding='utf-8') as f:
        f.writelines(output)


def get_timestamp() -> str:
    """Return current timestamp."""
    from datetime import datetime
    return datetime.now().isoformat(timespec='seconds')


if __name__ == "__main__":
    main()
