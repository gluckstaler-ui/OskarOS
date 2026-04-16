#!/usr/bin/env python3
"""
Reclassify misattributions using improved logic.
"""

import re
from pathlib import Path
from collections import defaultdict

# Generic/very common titles that span multiple genres
GENERIC_TITLES = {
    "Time",
    "Forever",
    "Cold",
    "Pain",
    "Dreams",
    "Falling",
    "I Want You",
    "Let Me Love You",
    "Make You Feel My Love",
    "I Love You",
    "i love you",
    "Never Gonna Give You Up",
    "Sign of the Times",
    "I Don't Love You",
    "Heartbeat",
    "All I Need",
    "Someday",
    "My Love Mine All Mine",
    "No One Knows",
    "Time After Time",
    "Running Out of Time",
    "After Hours",
    "Sweet Dreams",
    "Falling",
    "The World Is Yours",
    "Fly Away",
    "One Way or Another",
    "You",
    "Easy on Me",
    "Today",
    "Schism",
    "Touch Me",
    "Friends",
    "Unfaithful",
    "Bye Bye Bye",
    "Water",
    "a lot",
    "Hello",
    "Fuel",
    "OMG",
    "Carnival",
    "Mama",
    "Tears",
    "Run",
    "Blue",
    "BLUE",
    "Pressure",
    "Mary on a Cross",
    "High Hopes",
    "Smack My Bitch Up",
    "Down",
    "Bounce",
    "1 step forward, 3 steps back",
    "I Like It",
    "Heaven",
    "Livin' La Vida Loca",
    "Better Off Alone",
    "Get Busy",
    "Honest",
    "HONEST",
    "Hate It Or Love It",
    "I THINK",
    "Forever",
    "All I Want",
    "Lullaby",
}

# Genres/pools that indicate modern non-rock artists
MODERN_POOLS = {
    "AfroBeats e Amapiano",
    "Clube Killers"
}

# Rock/indie/alternative pools
ROCK_POOLS = {
    "80",
    "70",
    "Dance 2000"
}

# Artists we know are from rock/indie/pop heritage
ROCK_INDIE_POP_ARTISTS = {
    "Pixies",
    "Radiohead",
    "The Strokes",
    "Muse",
    "Kanye West",
    "The Cranberries",
    "Guns N' Roses",
    "Rihanna",
    "Queens of the Stone Age",
    "Cyndi Lauper",
    "Rick Astley",
    "Harry Styles",
    "My Chemical Romance",
    "Childish Gambino",
    "Jessie J",
    "Cigarettes After Sex",
    "La Roux",
    "Sum 41",
    "Frank Ocean",
    "Queen",
    "Coldplay",
    "Ariana Grande",
    "Future",
    "Tyler, The Creator",
    "Aretha Franklin",
    "Justin Bieber",
    "The Game",
    "Tate McRae",
    "P!nk",
    "Drake",
    "The Weeknd",
    "Artemas",
    "Playboi Carti",
    "Sam Smith",
    "Billie Eilish",
    "Shakira",
    "Sade",
    "Alien Ant Farm",
    "Frank Sinatra",
    "Earth, Wind & Fire",
    "Charlie Puth",
    "Mariah Carey",
    "Tears for Fears",
    "Conan Gray",
    "Surf Curse",
    "Beyoncé",
    "Nas",
    "Lenny Kravitz",
    "Bryson Tiller",
    "Linkin Park",
    "Cher",
    "Blondie",
    "Adele",
    "Michael Jackson",
    "Taylor Swift",
    "Tool",
    "Rick James",
    "The Doors",
    "Chase Atlantic",
    "Papa Roach",
    "Kodaline",
    "The Cure",
    "*NSYNC",
    "Tyla",
    "21 Savage",
    "Metallica",
    "NewJeans",
    "¥$",
    "Sabrina Carpenter",
    "Snow Patrol",
    "Paramore",
    "Ghost",
    "Panic! at the Disco",
    "The Prodigy",
    "Jay Sean",
    "System of a Down",
    "Olivia Rodrigo",
    "Cardi B",
    "Bryan Adams",
    "Ricky Martin",
    "Alice Deejay",
    "Sean Paul",
    "Baby Keem",
    "Jeff Buckley",
    "Kendrick Lamar",
    "Deftones",
    "Mitski",
    "The Ronettes",
    "Bloc Party",
    "Nine Inch Nails",
    "Pink Floyd",
    "Black Eyed Peas",
    "U2",
    "Lee Marrow",
    "Flat Pack",
    "El-Tone",
    "Jammix",
    "Charles Caliber",
    "Kelvin Jones Ft. Majeeed",
    "Fast Eddie",
    "Bingo Players",
    "Laura Branigan",
    "DJ Jeff",
    "Barbara Tucker",
    "Wild Mary",
    "Timmy T",
    "Patrice Rushen",
    "The Belle Stars",
    "Maxine Singleton",
    "Passion",
    "Kehlani Ft Ludmilla",
    "Cream Vs Master At Work",
    "Alesso Vs Artemas",
    "Dave Ft Burna Boy",
    "Jens O.",
    "R.Gee",
    "David Guetta ft Sia",
    "David Guetta ft. Sia",
    "Micahel Smbrio",
    "1980 ~ Ottawan",
    "Aaron Smith Ft Indiblu",
    "Kamino & Cristoph Ft Myrn",
    "Babyface Ray, Fabolous & Rich Paul",
    "Kelvyn Boy",
    "Ir-Sais, So7ace, Blaqbonez, Issairo",
    "Jaywon Ft. Spyro",
    "Agatchu Ft. Teni",
    "Bodyque",
    "Majeeed",
    "Logos Olori Ft. Davido",
    "Fedesse",
    "Seyi Vibez",
    "Lojay",
    "Lukado",
    "M3nsa",
    "Superfreak",
    "49ers",
    "Cathy Dennis",
    "Shalamar",
    "Full Force",
    "Will Sparks & Darren Styles",
    "Omnom Ft Xkylar",
    "Simi",
    "Sebas Ramis, Life On Planets",
    "Krizbeatz, Fave, Joshua Baraka",
    "Fr3sh Trx",
    "Kojo Funds",
    "S1mba",
    "Mic_chord",
    "Treggz",
    "Olivetheboy, Mayorkun",
    "Skn The Divine",
    "Kanye West & Ty Dolla Sign",
    "Lemon Adisa Ft. Bhadboi Oml",
    "Kehlani Ft. Omah Lay",
    "8syn, Minz & One Acen",
    "8syn, Minz, One Acen",
    "J&S Projects",
    "Ruger",
    "Shana",
    "Boj FT. Victony",
    "Dremo Ft. Dandizzy",
    "Focalistic Ft. Thama Tee",
    "Highlyy Ft. Jayo",
    "The Abe Effect",
    "Kaysito De Soul, Sushi Da Deejay",
    "The S.O.S Band",
    "Gta",
    "Rayvanny",
    "Ic",
    "Kaysito De Soul",
    "Dino",
    "Alesso & Nate Smith",
    "Sara Landry & Alt8",
    "Essential I, Keyrabo, Dr Silva, Less Gee",
    "Badbwoy",
    "Mr.Lee",
    "Highlyy",
}

# Afrobeats/modern artists - if they're in AfroBeats pool, mark as coincidence
AFROBEATS_ARTISTS = {
    "Anni3",
    "Joeboy",
    "Luca Zuccotti, Portable",
    "Tekno",
    "Ic",
    "Mellowbone Sa",
    "1king Tshepo",
    "Spider",
    "Blaq Jerzee",
    "Boutross Ft. Mejja",
    "Niphkeys Ft. Mohbad & Hadurah",
    "Charles Caliber",
    "Kelvin Jones Ft. Majeeed",
    "Bokoesam, $Hirak",
    "Jamopyper",
    "Ic",
    "Juls Ft. Jayo",
    "Kj Spio Ft. Sarkodie, Loick Essien & Ambre",
    "Michael Brun Ft. Kojey Radical & Stalk Ashley",
    "Ladipoe Ft. Rozzz & Morrelo",
    "Boutross Ft. Mejja",
    "Niphkeys Ft. Mohbad & Hadurah",
    "Stefflon Don",
    "De_keay, Livin Sz",
    "Akwaboah Ft. Strongman",
    "Bramsito",
    "Rotimi, Mayorkun & Nasty C",
    "Rema",
    "Faed",
    "Hotkid",
    "Fiso El Musica",
    "Soundz, Gabzy",
    "Jayo",
    "Boy Spyce",
    "Kelvyn Boy",
    "Logos Olori Ft. Davido",
    "Fedesse",
    "Seyi Vibez",
    "Lojay",
    "Lukado",
    "M3nsa",
    "Kaysito De Soul, Sushi Da Deejay",
    "Rayvanny",
    "Frizzie Ft. Bobby Saka",
    "Locko",
    "Niphkeys, Zinoleesky, Bnxn",
    "Mfr Souls, Mdu Aka Trp",
    "D2s Gh",
    "King David Ft. Tekno",
    "Tekno Ft. Shallipopi",
    "Lemon Adisa Ft. Bhadboi Oml",
    "Kehlani Ft. Omah Lay",
    "8syn, Minz & One Acen",
    "8syn, Minz, One Acen",
    "J&S Projects",
    "Ruger",
    "Boj FT. Victony",
    "Dremo Ft. Dandizzy",
    "Focalistic Ft. Thama Tee",
    "Highlyy Ft. Jayo",
    "The Abe Effect",
    "Boj FT. Victony",
    "Dremo Ft. Dandizzy",
    "Focalistic Ft. Thama Tee",
    "Highlyy",
    "Kaysito De Soul",
}

def reclassify_entry(pool, matched_artist, matched_title, file_artist, old_classification, filename=""):
    """
    Improved classification logic.
    """

    # Rule 1: Check if filename contains the matched artist name (indicates it's a remix)
    if matched_artist.lower() in filename.lower() or "remix" in filename.lower():
        return "REAL COVER"

    # Rule 2: If matched title is very generic, lean toward TITLE COINCIDENCE
    if matched_title in GENERIC_TITLES:
        # Exception: if file artist is clearly attempting a cover (same genre)
        if pool in ROCK_POOLS or (matched_artist in ROCK_INDIE_POP_ARTISTS and file_artist in ROCK_INDIE_POP_ARTISTS):
            return "REAL COVER"
        return "TITLE COINCIDENCE"

    # Rule 3: AfroBeats pool with Western rock/pop/indie matched artist
    if pool == "AfroBeats e Amapiano":
        # If matched artist is rock/indie/pop heritage and file artist is Afrobeats
        if matched_artist in ROCK_INDIE_POP_ARTISTS and file_artist not in ROCK_INDIE_POP_ARTISTS:
            return "TITLE COINCIDENCE"
        # Known Afrobeats artists covering their own tracks are REAL
        if file_artist in AFROBEATS_ARTISTS:
            return "REAL COVER"

    # Rule 4: Clube Killers pool with modern EDM/hip-hop vs rock/indie
    if pool == "Clube Killers":
        # If matched is rock/indie and file is modern EDM/hip-hop
        if matched_artist in ROCK_INDIE_POP_ARTISTS and file_artist not in ROCK_INDIE_POP_ARTISTS:
            # Unless it's a known remix (Alesso, David Guetta, etc doing remixes)
            if not ("Alesso" in file_artist or "Guetta" in file_artist or "Diplo" in file_artist
                    or "remix" in filename.lower() or "vs" in file_artist.lower()):
                return "TITLE COINCIDENCE"

    # Default: if we got here, likely a real cover attempt
    return "REAL COVER"


def parse_listeners(listener_str):
    """Convert listener string like '3.0M' to number."""
    listener_str = str(listener_str).strip()
    if 'M' in listener_str:
        return int(float(listener_str.replace('M', '')) * 1_000_000)
    elif 'K' in listener_str:
        return int(float(listener_str.replace('K', '')) * 1_000)
    else:
        try:
            return int(listener_str)
        except:
            return 0


def main():
    input_file = Path("/sessions/sweet-nice-newton/mnt/OskarOS/shaker/analysis_rest_misattributions.md")
    output_file = Path("/sessions/sweet-nice-newton/mnt/OskarOS/shaker/analysis_rest_corrected.md")
    gold_file = Path("/sessions/sweet-nice-newton/mnt/OskarOS/shaker/gold_hits_to_recheck.md")

    with open(input_file, 'r') as f:
        content = f.read()

    # Parse header
    lines = content.split('\n')
    header_end = 0
    for i, line in enumerate(lines):
        if "| Pool |" in line:
            header_end = i
            break

    header_lines = lines[:header_end + 2]  # Include header and separator
    data_lines = lines[header_end + 2:]

    # Parse table rows
    entries = []
    for line in data_lines:
        if not line.strip() or not line.startswith('|'):
            continue

        parts = [p.strip() for p in line.split('|')[1:-1]]
        if len(parts) < 7:
            continue

        try:
            pool, matched_artist, matched_title, listeners, file_artist, classification, notes = parts
            listeners_num = parse_listeners(listeners)

            # Reclassify
            new_classification = reclassify_entry(
                pool, matched_artist, matched_title, file_artist, classification
            )

            entries.append({
                'pool': pool,
                'matched_artist': matched_artist,
                'matched_title': matched_title,
                'listeners': listeners,
                'listeners_num': listeners_num,
                'file_artist': file_artist,
                'old_classification': classification,
                'new_classification': new_classification,
                'notes': notes
            })
        except Exception as e:
            pass

    # Count stats
    counts = defaultdict(int)
    for entry in entries:
        counts[entry['new_classification']] += 1

    # Build corrected file
    corrected_lines = []
    corrected_lines.append("# REST Files — Misattribution Analysis (CORRECTED)")
    corrected_lines.append(f"Generated: 2026-03-17 (Reclassified)")
    corrected_lines.append(f"Total REST entries analyzed: {len(entries)}")
    corrected_lines.append("")
    corrected_lines.append("## Summary by Classification (CORRECTED)")
    for classification in sorted(counts.keys()):
        corrected_lines.append(f"- **{classification}**: {counts[classification]}")
    corrected_lines.append("")
    corrected_lines.append("---")
    corrected_lines.append("")
    corrected_lines.append("## All Entries (sorted by listeners)")
    corrected_lines.append("")
    corrected_lines.append("| Pool | Matched Artist | Matched Title | Listeners | File Artist | Classification | Notes |")
    corrected_lines.append("|------|---|---|---|---|---|---|")

    # Sort by listeners descending
    entries_sorted = sorted(entries, key=lambda x: x['listeners_num'], reverse=True)

    for entry in entries_sorted:
        line = f"| {entry['pool']} | {entry['matched_artist']} | {entry['matched_title']} | {entry['listeners']} | {entry['file_artist']} | {entry['new_classification']} | {entry['notes']} |"
        corrected_lines.append(line)

    # Write corrected file
    with open(output_file, 'w') as f:
        f.write('\n'.join(corrected_lines))

    print(f"✓ Wrote corrected analysis to {output_file}")
    print(f"  - REAL COVER: {counts.get('REAL COVER', 0)}")
    print(f"  - TITLE COINCIDENCE: {counts.get('TITLE COINCIDENCE', 0)}")
    print(f"  - PARSING ERROR: {counts.get('PARSING ERROR', 0)}")
    print(f"  - LOW LISTENER CORRECT: {counts.get('LOW LISTENER CORRECT', 0)}")

    # Build gold hits list (REAL COVER with 100K+ listeners)
    gold_hits = [e for e in entries_sorted
                 if e['new_classification'] == 'REAL COVER' and e['listeners_num'] >= 100_000]

    gold_lines = []
    gold_lines.append("# Gold Hits to Recheck")
    gold_lines.append(f"REAL COVER entries with 100K+ listeners")
    gold_lines.append(f"Total entries: {len(gold_hits)}")
    gold_lines.append(f"Generated: 2026-03-17")
    gold_lines.append("")
    gold_lines.append("| Listeners | File Artist | Matched Artist | Matched Title | Pool | Notes |")
    gold_lines.append("|---|---|---|---|---|---|")

    for entry in gold_hits:
        line = f"| {entry['listeners']} | {entry['file_artist']} | {entry['matched_artist']} | {entry['matched_title']} | {entry['pool']} | {entry['notes']} |"
        gold_lines.append(line)

    # Write gold file
    with open(gold_file, 'w') as f:
        f.write('\n'.join(gold_lines))

    print(f"✓ Wrote gold hits to {gold_file}")
    print(f"  - {len(gold_hits)} high-value entries to check")


if __name__ == '__main__':
    main()
