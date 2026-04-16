/**
 * End-to-End Session Test
 * Creates a complete Whiskers & Wookies session with 4 vibes
 * A Star Wars themed cat café where cats are named after Wookies
 */

import {
  createSession,
  appendToSessionLog,
  updateWorkflowState,
  updateSessionPhase,
  saveVibeHtml,
  updateImagesMd,
  updateBuildMd,
  updateCreativeBriefMd,
  getSession
} from './lib/session'
import { copyFileSync, existsSync, writeFileSync } from 'fs'
import path from 'path'

const IMAGES_DIR = path.join(process.cwd(), '..', 'images')

async function main() {
  console.log('='.repeat(60))
  console.log('END-TO-END SESSION TEST: Whiskers & Wookies')
  console.log('='.repeat(60))

  // 1. CREATE SESSION
  console.log('\n📁 STEP 1: Creating session...')
  const session = await createSession('Whiskers and Wookies')
  const sessionId = session.id
  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  console.log(`   Session ID: ${sessionId}`)
  console.log(`   Path: ${sessionPath}`)

  // 2. COPY SOURCE IMAGES (repurposing available images)
  console.log('\n🖼️  STEP 2: Copying source images...')
  const imagesToCopy = [
    { src: 'hero.jpg', dst: 'hero.jpg' },  // Repurpose as cozy café setting
    { src: 'shams.jpg', dst: 'chewie.jpg' },  // Orange cat = Chewie
    { src: 'qamar.jpg', dst: 'lumpy.jpg' },   // Gray cat = Lumpy
    { src: 'sultan.jpg', dst: 'malla.jpg' },  // Falcon becomes Malla (the boss)
    { src: 'haboob.jpg', dst: 'itchy.jpg' },  // Camel = Itchy (gentle giant)
  ]

  for (const img of imagesToCopy) {
    const srcPath = path.join(IMAGES_DIR, img.src)
    const dstPath = path.join(sessionPath, img.dst)
    if (existsSync(srcPath)) {
      copyFileSync(srcPath, dstPath)
      console.log(`   ✓ ${img.dst}`)
    } else {
      console.log(`   ✗ ${img.src} not found`)
    }
  }

  await updateWorkflowState(sessionId, { imagesUploaded: true })

  // 3. LOG DISCOVERY CONVERSATION
  console.log('\n💬 STEP 3: Logging discovery conversation...')

  await appendToSessionLog(sessionId, 'COO',
    `**Action:** FILE_PLACED (workaround: test script)
**Files:** hero.jpg, chewie.jpg, lumpy.jpg, malla.jpg, itchy.jpg
**Method:** Direct copy from /images/`)

  await appendToSessionLog(sessionId, 'CD → User',
    `Q1: What's the name of your business?
Q2: In one sentence that another business couldn't use, what is this place?
Q3: If this place were a person at a party, who would they be talking to?`)

  await appendToSessionLog(sessionId, 'User → CD',
    `A1: Whiskers & Wookies
A2: A cat café in Austin where every cat is named after a Wookie from Star Wars, and the baristas will debate you on whether Han shot first.
A3: The person wearing a vintage band tee who just made a deep-cut Expanded Universe reference and is waiting to see if anyone gets it.`)

  await appendToSessionLog(sessionId, 'CD → User',
    `Q4: Who is this place for? Give me a specific person, not a demographic.
Q5: What's the one thing you want every guest to feel when they leave?
Q6: What do you hate about other cat cafés?`)

  await appendToSessionLog(sessionId, 'User → CD',
    `A4: Marcus, 32, software dev who works remote. He's seen every Star Wars thing ever made (including the Holiday Special, unironically). He wants a third place that isn't his apartment or a coffee chain.
A5: Like they found their people. And maybe that they need to rewatch the Original Trilogy.
A6: The precious "uwu look at the kitties" energy. We're not precious. We're nerds. There's a difference.`)

  await appendToSessionLog(sessionId, 'CD → User',
    `Q7: Tell me about the cats.
Q8: What's on the menu? Real items, real prices.`)

  await appendToSessionLog(sessionId, 'User → CD',
    `A7:
- Chewie (Chewbacca): Orange tabby. Huge. Loyal. Will sit on your laptop until you give him attention. Makes weird noises.
- Lumpy (Lumpawaroo): Gray longhair. Chewie's son. Dramatic. Thinks he's royalty.
- Malla (Mallatobuck): Calico. The matriarch. Runs the café. Judges your life choices.
- Itchy (Attichitcuk): Old ginger. Chewie's dad. Sleeps 23 hours a day. When he's awake, chaos.

A8:
DRINKS:
- The Falcon (espresso, cold foam) — $6
- Kashyyyk Cold Brew — $5
- Wookie Cookie Latte (hazelnut, oat milk) — $7
- Parsec Pour-Over (yes we know it's a unit of distance) — $5

FOOD:
- Chewie's Chonk Cookie (chocolate chunk) — $4
- Lumpy's Leftovers (day-old pastry, deeply discounted) — $2
- The Cantina Board (cheese, crackers, olives) — $12

CAT TIME:
- 30 minutes — $10
- 1 hour — $15
- "I live here now" day pass — $25`)

  await updateWorkflowState(sessionId, { discoveryComplete: true })

  // 4. UPDATE IMAGES.MD
  console.log('\n📸 STEP 4: Updating IMAGES.md with analysis...')

  const imagesMd = `# Image Registry

## Uploaded Images

### hero.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Cozy café interior. Warm lighting, exposed brick vibes. Traditional middle-eastern aesthetic
that we'll reimagine as a cantina vibe with the right copy.

**Suggested uses:** Hero, atmospheric background
**Suggested vibes:** All (with proper overlay/treatment)

---

### chewie.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Orange tabby. Absolute unit. Perfect for Chewbacca namesake — same energy.

**Suggested uses:** Portrait, hero feature
**Suggested vibes:** Chewie-centric vibes

---

### lumpy.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Gray cat with dramatic presence. Regal. Perfect for Lumpy's dramatic prince energy.

**Suggested uses:** Portrait
**Suggested vibes:** All

---

### malla.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Commanding presence. Perfect matriarch energy. The one in charge.

**Suggested uses:** Portrait, "Meet the Boss" section
**Suggested vibes:** All

---

### itchy.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Old soul energy. Sleepy. Perfect for Itchy the elder.

**Suggested uses:** Portrait
**Suggested vibes:** Cozy/chill vibes

---

## Image Prompts + Generated

*No generated images yet — using uploaded assets*

---

## Manipulations

*No manipulations yet*
`

  await updateImagesMd(sessionId, imagesMd)
  await updateWorkflowState(sessionId, { imagesAnalyzed: true })

  // 5. CREATE CREATIVE BRIEF
  console.log('\n📋 STEP 5: Creating CREATIVE-BRIEF.md...')

  const creativeBrief = `# Creative Brief: Whiskers & Wookies

**Status:** APPROVED

---

## Business Identity

**One-sentence:** A cat café in Austin where every cat is named after a Wookie from Star Wars, and the baristas will debate you on whether Han shot first.

**The Customer:** Marcus, 32, software dev. Seen everything Star Wars. Wants his people.

**The Weird Detail:** They have strong opinions about the Holiday Special.

**The Enemy:** "uwu look at the kitties" precious cat café energy.

**The Promise:** You found your people.

---

## The Wookies

| Name | Species | Personality |
|------|---------|-------------|
| Chewie | Orange tabby | Huge. Loyal. Makes weird noises. |
| Lumpy | Gray longhair | Dramatic. Thinks he's royalty. |
| Malla | Calico | The matriarch. Runs the café. |
| Itchy | Old ginger | Sleeps 23 hours. Chaos when awake. |

---

## Menu

### Drinks
- The Falcon (espresso, cold foam) — $6
- Kashyyyk Cold Brew — $5
- Wookie Cookie Latte (hazelnut, oat milk) — $7
- Parsec Pour-Over — $5

### Food
- Chewie's Chonk Cookie — $4
- Lumpy's Leftovers (discounted pastry) — $2
- The Cantina Board — $12

### Cat Time
- 30 minutes — $10
- 1 hour — $15
- Day pass — $25

---

## Voice & Tone

**If this place were a person at a party:** The one in the vintage tee making Expanded Universe references.

**Banned phrases:**
- "Adorable"
- "Purrfect"
- "Meow"
- "Fur babies"
- Any cat puns (we're better than that)

**The Benchmark:** "Look, we're not going to explain why we named a cat Lumpawaroo. If you know, you know. If you don't, the coffee's still good."

---

## The Four Vibes

### Vibe 1: CANTINA
**One-liner:** A wretched hive of scum, villainy, and really good coffee.
**Voice:** Dry. Self-aware. The vibe of someone who knows the Kessel Run thing is a plot hole but loves it anyway.
**Colors:** #1a1a1a (space black), #FFE81F (Star Wars yellow), #8B0000 (cantina red), #333
**For:** Someone who gets the references without explanation.

### Vibe 2: HOLIDAY SPECIAL
**One-liner:** Yes, we've seen it. Yes, unironically. No, we won't explain.
**Voice:** Chaotic. Weird. Proud of it. The vibe of people who own their niche interests.
**Colors:** #2d5a27 (Life Day green), #c41e3a (festive red), #ffd700 (garland gold), #1a1a1a
**For:** Someone who appreciates the deep cuts.

### Vibe 3: KASHYYYK
**One-liner:** Come for the coffee. Stay because Chewie's on your laptop.
**Voice:** Warm, woodsy, inviting but not precious. Treehouse energy.
**Colors:** #4a3728 (bark brown), #6b8e23 (forest green), #f4a460 (sunset), #2d2d2d
**For:** Someone who wants cozy without cute.

### Vibe 4: REBEL BASE
**One-liner:** Where the resistance gets their caffeine.
**Voice:** Mission-focused. Functional. Like the briefing room before the Death Star run.
**Colors:** #ff4500 (rebel orange), #1a1a1a (tactical black), #f5f5f5 (hologram white), #4169e1 (R2 blue)
**For:** Someone who drinks coffee like it's fuel for the mission.

---

## WebDev Instructions

1. Build each vibe as self-contained HTML
2. Use relative paths for images: \`<img src="chewie.jpg" data-slot="chewie">\`
3. Include data-editable attributes for text
4. Full menu with prices in each vibe
5. Location section (Austin, TX)
6. Booking CTA that sounds like the brand, not like "Book Meow" (banned)
7. Footer with the Wookies

---

## Booking Archetype

**Atomic Unit:** Time slot with the cats
**Specific Selection:** No (any available spot)
**Concurrent:** Yes (multiple people same time)
**Duration:** Rigid (30 min / 1 hour / day pass)
**Pricing:** Per session

**Closest Archetype:** Fitness Class
`

  await updateCreativeBriefMd(sessionId, creativeBrief)

  // 6. CREATE 4 VIBE HTML FILES
  console.log('\n🎨 STEP 6: Creating 4 vibe HTML files...')
  await updateSessionPhase(sessionId, 'PHASE_3_BUILD')

  // VIBE 1: CANTINA
  const vibeCantina = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiskers & Wookies — Cantina</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Inter:wght@300;400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #1a1a1a; color: #f5f5f5; }

    .hero {
      height: 100vh;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .hero img {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
      filter: brightness(0.3) sepia(0.3);
    }
    .hero-content {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 2rem;
    }
    .hero h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 3.5rem;
      font-weight: 700;
      color: #FFE81F;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 1rem;
    }
    .hero p {
      font-size: 1.3rem;
      color: #ccc;
      font-style: italic;
    }

    .crawl-text {
      background: #0a0a0a;
      padding: 3rem 2rem;
      text-align: center;
      border-top: 2px solid #FFE81F;
      border-bottom: 2px solid #FFE81F;
    }
    .crawl-text p {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.1rem;
      color: #FFE81F;
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.8;
    }

    .menu {
      padding: 5rem 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    .menu h2 {
      font-family: 'Orbitron', sans-serif;
      font-size: 2rem;
      color: #FFE81F;
      text-align: center;
      margin-bottom: 3rem;
    }
    .menu-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 3rem;
    }
    .menu-category h3 {
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: #8B0000;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #333;
    }
    .menu-item {
      display: flex;
      justify-content: space-between;
      padding: 0.6rem 0;
      font-size: 1rem;
    }
    .menu-item .price { color: #FFE81F; }
    .menu-item .note { font-size: 0.85rem; color: #666; display: block; }

    .wookies {
      background: #0a0a0a;
      padding: 5rem 2rem;
    }
    .wookies h2 {
      font-family: 'Orbitron', sans-serif;
      text-align: center;
      font-size: 2rem;
      color: #FFE81F;
      margin-bottom: 3rem;
    }
    .wookies-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .wookie {
      text-align: center;
    }
    .wookie img {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #FFE81F;
    }
    .wookie h4 {
      margin-top: 1rem;
      font-family: 'Orbitron', sans-serif;
      font-size: 1rem;
    }
    .wookie p {
      font-size: 0.85rem;
      color: #888;
      margin-top: 0.3rem;
    }

    .cta-section {
      padding: 5rem 2rem;
      text-align: center;
    }
    .cta-section h2 {
      font-family: 'Orbitron', sans-serif;
      font-size: 2rem;
      color: #FFE81F;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.1rem;
      color: #888;
      margin-bottom: 2rem;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: #FFE81F;
      color: #1a1a1a;
      text-decoration: none;
      font-family: 'Orbitron', sans-serif;
      font-size: 1rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      transition: all 0.2s;
    }
    .cta-button:hover {
      background: #fff;
      transform: scale(1.05);
    }

    footer {
      background: #0a0a0a;
      padding: 3rem 2rem;
      text-align: center;
      border-top: 1px solid #333;
    }
    footer p { color: #666; margin-bottom: 0.5rem; }
    footer strong { color: #FFE81F; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="Whiskers & Wookies">
    <div class="hero-content">
      <h1 data-editable="headline">Whiskers & Wookies</h1>
      <p data-editable="subline">A wretched hive of scum, villainy, and really good coffee.</p>
    </div>
  </section>

  <div class="crawl-text">
    <p data-editable="crawl">Look, we're not going to explain why we named a cat Lumpawaroo. If you know, you know. If you don't, the coffee's still good.</p>
  </div>

  <section class="menu">
    <h2 data-editable="menu-title">Transmissions from the Bar</h2>
    <div class="menu-grid">
      <div class="menu-category">
        <h3>Drinks</h3>
        <div class="menu-item">
          <span>The Falcon <span class="note">espresso, cold foam</span></span>
          <span class="price">$6</span>
        </div>
        <div class="menu-item">
          <span>Kashyyyk Cold Brew</span>
          <span class="price">$5</span>
        </div>
        <div class="menu-item">
          <span>Wookie Cookie Latte <span class="note">hazelnut, oat milk</span></span>
          <span class="price">$7</span>
        </div>
        <div class="menu-item">
          <span>Parsec Pour-Over <span class="note">yes we know</span></span>
          <span class="price">$5</span>
        </div>
      </div>
      <div class="menu-category">
        <h3>Fuel</h3>
        <div class="menu-item">
          <span>Chewie's Chonk Cookie</span>
          <span class="price">$4</span>
        </div>
        <div class="menu-item">
          <span>Lumpy's Leftovers <span class="note">discounted, still good</span></span>
          <span class="price">$2</span>
        </div>
        <div class="menu-item">
          <span>The Cantina Board</span>
          <span class="price">$12</span>
        </div>
      </div>
      <div class="menu-category">
        <h3>Cat Time</h3>
        <div class="menu-item">
          <span>30 Minutes</span>
          <span class="price">$10</span>
        </div>
        <div class="menu-item">
          <span>1 Hour</span>
          <span class="price">$15</span>
        </div>
        <div class="menu-item">
          <span>"I Live Here Now"</span>
          <span class="price">$25</span>
        </div>
      </div>
    </div>
  </section>

  <section class="wookies">
    <h2 data-editable="wookies-title">The Wookies</h2>
    <div class="wookies-grid">
      <div class="wookie">
        <img src="chewie.jpg" data-slot="chewie" alt="Chewie">
        <h4>Chewie</h4>
        <p>Makes weird noises</p>
      </div>
      <div class="wookie">
        <img src="lumpy.jpg" data-slot="lumpy" alt="Lumpy">
        <h4>Lumpy</h4>
        <p>Thinks he's royalty</p>
      </div>
      <div class="wookie">
        <img src="malla.jpg" data-slot="malla" alt="Malla">
        <h4>Malla</h4>
        <p>The real boss</p>
      </div>
      <div class="wookie">
        <img src="itchy.jpg" data-slot="itchy" alt="Itchy">
        <h4>Itchy</h4>
        <p>23 hours of sleep</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">Han shot first.</h2>
    <p data-editable="cta-subline">If you disagree, come argue about it over coffee. Chewie will judge you either way.</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Enter the Cantina</a>
  </section>

  <footer>
    <p><strong>Whiskers & Wookies</strong></p>
    <p>Austin, TX · Where nerds drink coffee</p>
    <p>Open daily: 7am - 9pm · Debates encouraged</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 1, 'Cantina', 'landing', vibeCantina)
  console.log('   ✓ vibe-1-cantina-landing.html')

  // VIBE 2: HOLIDAY SPECIAL
  const vibeHoliday = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiskers & Wookies — Holiday Special</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@300;400&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #1a1a1a; color: #f5f5f5; }

    .hero {
      height: 100vh;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: linear-gradient(135deg, #2d5a27 0%, #1a3a17 100%);
    }
    .hero img {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
      opacity: 0.2;
      mix-blend-mode: overlay;
    }
    .hero-content {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 2rem;
    }
    .hero h1 {
      font-family: 'Playfair Display', serif;
      font-size: 4rem;
      font-weight: 700;
      color: #ffd700;
      margin-bottom: 1rem;
    }
    .hero p {
      font-size: 1.3rem;
      color: #c41e3a;
      font-weight: 600;
    }

    .chaos-banner {
      background: #c41e3a;
      padding: 2rem;
      text-align: center;
    }
    .chaos-banner p {
      font-family: 'Playfair Display', serif;
      font-size: 1.2rem;
      color: #fff;
    }

    .menu {
      padding: 5rem 2rem;
      max-width: 900px;
      margin: 0 auto;
      background: repeating-linear-gradient(
        45deg,
        #1a1a1a,
        #1a1a1a 10px,
        #1f1f1f 10px,
        #1f1f1f 20px
      );
    }
    .menu h2 {
      font-family: 'Playfair Display', serif;
      font-size: 2.5rem;
      color: #ffd700;
      text-align: center;
      margin-bottom: 3rem;
    }
    .menu-section {
      margin-bottom: 2rem;
    }
    .menu-section h3 {
      color: #c41e3a;
      font-family: 'Playfair Display', serif;
      font-size: 1.3rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px dashed #2d5a27;
    }
    .menu-item {
      display: flex;
      justify-content: space-between;
      padding: 0.8rem 0;
    }
    .menu-item .price { color: #ffd700; font-weight: 600; }

    .wookies {
      padding: 5rem 2rem;
      background: linear-gradient(180deg, #2d5a27 0%, #1a3a17 100%);
    }
    .wookies h2 {
      font-family: 'Playfair Display', serif;
      text-align: center;
      font-size: 2.5rem;
      color: #ffd700;
      margin-bottom: 1rem;
    }
    .wookies .subtitle {
      text-align: center;
      color: #c41e3a;
      margin-bottom: 3rem;
      font-style: italic;
    }
    .wookies-grid {
      display: flex;
      justify-content: center;
      gap: 3rem;
      flex-wrap: wrap;
    }
    .wookie {
      text-align: center;
      max-width: 150px;
    }
    .wookie img {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      object-fit: cover;
      border: 4px solid #ffd700;
    }
    .wookie h4 {
      margin-top: 1rem;
      font-family: 'Playfair Display', serif;
      color: #ffd700;
    }
    .wookie p {
      font-size: 0.85rem;
      color: #aaa;
    }

    .cta-section {
      padding: 5rem 2rem;
      text-align: center;
      background: #c41e3a;
    }
    .cta-section h2 {
      font-family: 'Playfair Display', serif;
      font-size: 2.5rem;
      color: #ffd700;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.2rem;
      color: #fff;
      margin-bottom: 2rem;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: #ffd700;
      color: #1a1a1a;
      text-decoration: none;
      font-family: 'Playfair Display', serif;
      font-size: 1.1rem;
      font-weight: 700;
      transition: transform 0.2s;
    }
    .cta-button:hover {
      transform: scale(1.05) rotate(-2deg);
    }

    footer {
      background: #1a1a1a;
      padding: 3rem 2rem;
      text-align: center;
    }
    footer p { color: #666; margin-bottom: 0.5rem; }
    footer strong { color: #ffd700; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="Whiskers & Wookies">
    <div class="hero-content">
      <h1 data-editable="headline">Happy Life Day</h1>
      <p data-editable="subline">Yes, we've seen it. Yes, unironically. No, we won't explain.</p>
    </div>
  </section>

  <div class="chaos-banner">
    <p data-editable="banner">This café is brought to you by people who own the Holiday Special on VHS. We know what we are.</p>
  </div>

  <section class="menu">
    <h2 data-editable="menu-title">The Life Day Menu</h2>

    <div class="menu-section">
      <h3>Ceremonial Beverages</h3>
      <div class="menu-item"><span>The Falcon (espresso, cold foam)</span><span class="price">$6</span></div>
      <div class="menu-item"><span>Kashyyyk Cold Brew</span><span class="price">$5</span></div>
      <div class="menu-item"><span>Wookie Cookie Latte</span><span class="price">$7</span></div>
      <div class="menu-item"><span>Parsec Pour-Over</span><span class="price">$5</span></div>
    </div>

    <div class="menu-section">
      <h3>Festive Offerings</h3>
      <div class="menu-item"><span>Chewie's Chonk Cookie</span><span class="price">$4</span></div>
      <div class="menu-item"><span>Lumpy's Leftovers</span><span class="price">$2</span></div>
      <div class="menu-item"><span>The Cantina Board</span><span class="price">$12</span></div>
    </div>

    <div class="menu-section">
      <h3>Quality Time with the Wookies</h3>
      <div class="menu-item"><span>30 Minutes</span><span class="price">$10</span></div>
      <div class="menu-item"><span>1 Hour</span><span class="price">$15</span></div>
      <div class="menu-item"><span>Full Day Pass</span><span class="price">$25</span></div>
    </div>
  </section>

  <section class="wookies">
    <h2 data-editable="wookies-title">The Extended Family</h2>
    <p class="subtitle">(Yes, like the Extended Universe. We know.)</p>
    <div class="wookies-grid">
      <div class="wookie">
        <img src="chewie.jpg" data-slot="chewie" alt="Chewie">
        <h4>Chewie</h4>
        <p>The patriarch</p>
      </div>
      <div class="wookie">
        <img src="lumpy.jpg" data-slot="lumpy" alt="Lumpy">
        <h4>Lumpy</h4>
        <p>Drama prince</p>
      </div>
      <div class="wookie">
        <img src="malla.jpg" data-slot="malla" alt="Malla">
        <h4>Malla</h4>
        <p>Runs everything</p>
      </div>
      <div class="wookie">
        <img src="itchy.jpg" data-slot="itchy" alt="Itchy">
        <h4>Itchy</h4>
        <p>Elder statesman</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">We celebrate Life Day year-round.</h2>
    <p data-editable="cta-subline">Because if you're going to be weird, commit to it.</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Join the Celebration</a>
  </section>

  <footer>
    <p><strong>Whiskers & Wookies</strong></p>
    <p>Austin, TX · A café for people of refined taste (in bad TV)</p>
    <p>Open daily: 7am - 9pm</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 2, 'Holiday Special', 'landing', vibeHoliday)
  console.log('   ✓ vibe-2-holiday-special-landing.html')

  // VIBE 3: KASHYYYK
  const vibeKashyyyk = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiskers & Wookies — Kashyyyk</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bitter:wght@400;700&family=Source+Sans+3:wght@300;400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Source Sans 3', sans-serif; background: #2d2d2d; color: #f4f4f4; }

    .hero {
      height: 100vh;
      position: relative;
      display: flex;
      align-items: flex-end;
      padding: 4rem;
    }
    .hero img {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
      filter: brightness(0.5) sepia(0.2) saturate(1.3);
    }
    .hero-content {
      position: relative;
      z-index: 1;
      max-width: 600px;
    }
    .hero h1 {
      font-family: 'Bitter', serif;
      font-size: 3.5rem;
      font-weight: 700;
      color: #f4a460;
      margin-bottom: 1rem;
    }
    .hero p {
      font-size: 1.4rem;
      color: #ddd;
    }

    .bark-strip {
      height: 8px;
      background: linear-gradient(90deg, #4a3728, #6b8e23, #4a3728);
    }

    .menu {
      padding: 5rem 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .menu h2 {
      font-family: 'Bitter', serif;
      font-size: 2rem;
      color: #f4a460;
      text-align: center;
      margin-bottom: 3rem;
    }
    .menu-columns {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3rem;
    }
    .menu-category h3 {
      font-family: 'Bitter', serif;
      font-size: 1.1rem;
      color: #6b8e23;
      margin-bottom: 1.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #4a3728;
    }
    .menu-item {
      margin-bottom: 1rem;
    }
    .menu-item .name {
      display: block;
      font-weight: 600;
    }
    .menu-item .price {
      color: #f4a460;
    }

    .wookies {
      padding: 5rem 2rem;
      background: #4a3728;
    }
    .wookies h2 {
      font-family: 'Bitter', serif;
      text-align: center;
      font-size: 2rem;
      color: #f4a460;
      margin-bottom: 3rem;
    }
    .wookies-flex {
      display: flex;
      justify-content: center;
      gap: 4rem;
      flex-wrap: wrap;
    }
    .wookie {
      text-align: center;
    }
    .wookie img {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #6b8e23;
    }
    .wookie h4 {
      margin-top: 1rem;
      font-family: 'Bitter', serif;
      color: #f4a460;
    }
    .wookie p {
      font-size: 0.9rem;
      color: #ccc;
    }

    .cta-section {
      padding: 5rem 2rem;
      text-align: center;
      background: #2d2d2d;
    }
    .cta-section h2 {
      font-family: 'Bitter', serif;
      font-size: 2.5rem;
      color: #f4a460;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.1rem;
      color: #aaa;
      margin-bottom: 2rem;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: #6b8e23;
      color: #fff;
      text-decoration: none;
      font-family: 'Bitter', serif;
      font-size: 1.1rem;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .cta-button:hover {
      background: #7ba428;
      transform: translateY(-2px);
    }

    footer {
      background: #1a1a1a;
      padding: 3rem 2rem;
      text-align: center;
    }
    footer p { color: #666; margin-bottom: 0.5rem; }
    footer strong { color: #f4a460; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="Whiskers & Wookies">
    <div class="hero-content">
      <h1 data-editable="headline">Welcome to Kashyyyk</h1>
      <p data-editable="subline">Come for the coffee. Stay because Chewie's on your laptop.</p>
    </div>
  </section>

  <div class="bark-strip"></div>

  <section class="menu">
    <h2 data-editable="menu-title">From the Treehouse</h2>
    <div class="menu-columns">
      <div class="menu-category">
        <h3>Brews</h3>
        <div class="menu-item">
          <span class="name">The Falcon</span>
          <span class="price">$6</span>
        </div>
        <div class="menu-item">
          <span class="name">Kashyyyk Cold Brew</span>
          <span class="price">$5</span>
        </div>
        <div class="menu-item">
          <span class="name">Wookie Cookie Latte</span>
          <span class="price">$7</span>
        </div>
        <div class="menu-item">
          <span class="name">Parsec Pour-Over</span>
          <span class="price">$5</span>
        </div>
      </div>
      <div class="menu-category">
        <h3>Bites</h3>
        <div class="menu-item">
          <span class="name">Chewie's Cookie</span>
          <span class="price">$4</span>
        </div>
        <div class="menu-item">
          <span class="name">Lumpy's Leftovers</span>
          <span class="price">$2</span>
        </div>
        <div class="menu-item">
          <span class="name">Cantina Board</span>
          <span class="price">$12</span>
        </div>
      </div>
      <div class="menu-category">
        <h3>Hang Time</h3>
        <div class="menu-item">
          <span class="name">30 Minutes</span>
          <span class="price">$10</span>
        </div>
        <div class="menu-item">
          <span class="name">1 Hour</span>
          <span class="price">$15</span>
        </div>
        <div class="menu-item">
          <span class="name">Day Pass</span>
          <span class="price">$25</span>
        </div>
      </div>
    </div>
  </section>

  <section class="wookies">
    <h2 data-editable="wookies-title">The Locals</h2>
    <div class="wookies-flex">
      <div class="wookie">
        <img src="chewie.jpg" data-slot="chewie" alt="Chewie">
        <h4>Chewie</h4>
        <p>Laptop warmer</p>
      </div>
      <div class="wookie">
        <img src="lumpy.jpg" data-slot="lumpy" alt="Lumpy">
        <h4>Lumpy</h4>
        <p>Attention seeker</p>
      </div>
      <div class="wookie">
        <img src="malla.jpg" data-slot="malla" alt="Malla">
        <h4>Malla</h4>
        <p>The manager</p>
      </div>
      <div class="wookie">
        <img src="itchy.jpg" data-slot="itchy" alt="Itchy">
        <h4>Itchy</h4>
        <p>The ancient one</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">Find your spot in the treehouse.</h2>
    <p data-editable="cta-subline">Bring your laptop. Bring your book. Chewie will find you either way.</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Climb Up</a>
  </section>

  <footer>
    <p><strong>Whiskers & Wookies</strong></p>
    <p>Austin, TX · Cozy without the cute</p>
    <p>Open daily: 7am - 9pm</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 3, 'Kashyyyk', 'landing', vibeKashyyyk)
  console.log('   ✓ vibe-3-kashyyyk-landing.html')

  // VIBE 4: REBEL BASE
  const vibeRebel = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whiskers & Wookies — Rebel Base</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #1a1a1a; color: #f5f5f5; }

    .hero {
      height: 100vh;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #1a1a1a;
    }
    .hero img {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
      opacity: 0.15;
      filter: grayscale(1);
    }
    .hero-content {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 2rem;
    }
    .hero h1 {
      font-family: 'Space Mono', monospace;
      font-size: 3rem;
      font-weight: 700;
      color: #ff4500;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      margin-bottom: 1rem;
    }
    .hero p {
      font-family: 'Space Mono', monospace;
      font-size: 1.1rem;
      color: #888;
    }

    .status-bar {
      background: #ff4500;
      padding: 1rem 2rem;
      display: flex;
      justify-content: center;
      gap: 3rem;
      font-family: 'Space Mono', monospace;
      font-size: 0.9rem;
      color: #1a1a1a;
    }
    .status-item { text-transform: uppercase; }

    .menu {
      padding: 4rem 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    .menu h2 {
      font-family: 'Space Mono', monospace;
      font-size: 1.5rem;
      color: #ff4500;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #333;
    }
    .menu-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2rem;
    }
    .menu-category h3 {
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: #4169e1;
      margin-bottom: 1rem;
    }
    .menu-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      font-size: 0.95rem;
      border-bottom: 1px solid #222;
    }
    .menu-item .price {
      font-family: 'Space Mono', monospace;
      color: #ff4500;
    }

    .wookies {
      padding: 4rem 2rem;
      background: #0f0f0f;
    }
    .wookies h2 {
      font-family: 'Space Mono', monospace;
      text-align: center;
      font-size: 1.5rem;
      color: #ff4500;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 2rem;
    }
    .wookies-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.5rem;
      max-width: 800px;
      margin: 0 auto;
    }
    .wookie {
      text-align: center;
      padding: 1rem;
      background: #1a1a1a;
      border: 1px solid #333;
    }
    .wookie img {
      width: 80px;
      height: 80px;
      border-radius: 4px;
      object-fit: cover;
      filter: grayscale(0.3);
    }
    .wookie h4 {
      margin-top: 0.8rem;
      font-family: 'Space Mono', monospace;
      font-size: 0.9rem;
      color: #ff4500;
    }
    .wookie p {
      font-size: 0.75rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .cta-section {
      padding: 4rem 2rem;
      text-align: center;
      border-top: 2px solid #ff4500;
    }
    .cta-section h2 {
      font-family: 'Space Mono', monospace;
      font-size: 1.5rem;
      color: #f5f5f5;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1rem;
      color: #666;
      margin-bottom: 2rem;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: #ff4500;
      color: #1a1a1a;
      text-decoration: none;
      font-family: 'Space Mono', monospace;
      font-size: 0.9rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      transition: all 0.2s;
    }
    .cta-button:hover {
      background: #ff6a33;
    }

    footer {
      background: #0f0f0f;
      padding: 2rem;
      text-align: center;
      font-family: 'Space Mono', monospace;
      font-size: 0.8rem;
    }
    footer p { color: #444; margin-bottom: 0.3rem; }
    footer strong { color: #ff4500; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="Rebel Base">
    <div class="hero-content">
      <h1 data-editable="headline">Rebel Base</h1>
      <p data-editable="subline">// WHERE THE RESISTANCE GETS THEIR CAFFEINE</p>
    </div>
  </section>

  <div class="status-bar">
    <span class="status-item">Status: Operational</span>
    <span class="status-item">Cats: 4 Active</span>
    <span class="status-item">Coffee: Hot</span>
  </div>

  <section class="menu">
    <h2 data-editable="menu-title">Supply Manifest</h2>
    <div class="menu-grid">
      <div class="menu-category">
        <h3>Fuel</h3>
        <div class="menu-item"><span>The Falcon</span><span class="price">$6</span></div>
        <div class="menu-item"><span>Kashyyyk Cold Brew</span><span class="price">$5</span></div>
        <div class="menu-item"><span>Wookie Cookie Latte</span><span class="price">$7</span></div>
        <div class="menu-item"><span>Parsec Pour-Over</span><span class="price">$5</span></div>
      </div>
      <div class="menu-category">
        <h3>Rations</h3>
        <div class="menu-item"><span>Chewie's Cookie</span><span class="price">$4</span></div>
        <div class="menu-item"><span>Lumpy's Leftovers</span><span class="price">$2</span></div>
        <div class="menu-item"><span>Cantina Board</span><span class="price">$12</span></div>
      </div>
      <div class="menu-category">
        <h3>Recon Time</h3>
        <div class="menu-item"><span>30 Min Mission</span><span class="price">$10</span></div>
        <div class="menu-item"><span>1 Hour Op</span><span class="price">$15</span></div>
        <div class="menu-item"><span>Full Day Deploy</span><span class="price">$25</span></div>
      </div>
    </div>
  </section>

  <section class="wookies">
    <h2 data-editable="wookies-title">Field Operatives</h2>
    <div class="wookies-grid">
      <div class="wookie">
        <img src="chewie.jpg" data-slot="chewie" alt="Chewie">
        <h4>Chewie</h4>
        <p>Heavy Support</p>
      </div>
      <div class="wookie">
        <img src="lumpy.jpg" data-slot="lumpy" alt="Lumpy">
        <h4>Lumpy</h4>
        <p>Intel</p>
      </div>
      <div class="wookie">
        <img src="malla.jpg" data-slot="malla" alt="Malla">
        <h4>Malla</h4>
        <p>Command</p>
      </div>
      <div class="wookie">
        <img src="itchy.jpg" data-slot="itchy" alt="Itchy">
        <h4>Itchy</h4>
        <p>Veteran</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">Mission Briefing at 0700</h2>
    <p data-editable="cta-subline">The Empire doesn't take coffee breaks. Neither do we. (Actually we do. That's the whole point.)</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Report for Duty</a>
  </section>

  <footer>
    <p><strong>Whiskers & Wookies</strong></p>
    <p>Austin, TX · Coordinates Classified</p>
    <p>0700 - 2100 Daily</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 4, 'Rebel Base', 'landing', vibeRebel)
  console.log('   ✓ vibe-4-rebel-base-landing.html')

  await updateWorkflowState(sessionId, { vibesDeveloped: 4 })

  // 7. UPDATE BUILD.MD
  console.log('\n🔨 STEP 7: Updating BUILD.md...')

  const buildMd = `# Build Log

## Status
**Current Phase:** PHASE_3_BUILD
**Vibes Requested:** 4
**Vibes Complete:** 4
**Vibes Building:** 0
**Vibes Pending:** 0

---

## Vibe Queue

| # | Name | Status | Started | Completed |
|---|------|--------|---------|-----------|
| 1 | Cantina | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |
| 2 | Holiday Special | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |
| 3 | Kashyyyk | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |
| 4 | Rebel Base | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |

---

## Image Slots (All Vibes)

| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |
| chewie | chewie.jpg | ✓ |
| lumpy | lumpy.jpg | ✓ |
| malla | malla.jpg | ✓ |
| itchy | itchy.jpg | ✓ |

---

## Hot-Swap Log

| Time | Vibe | Slot | Old | New |
|------|------|------|-----|-----|

---

## Brief Update Log

| Time | Change | Affected Vibes | Action |
|------|--------|----------------|--------|
`

  await updateBuildMd(sessionId, buildMd)

  // 8. FINAL VERIFICATION
  console.log('\n✅ STEP 8: Final verification...')

  const finalSession = await getSession(sessionId)
  console.log(`   Session: ${finalSession?.businessName}`)
  console.log(`   Phase: ${finalSession?.phase}`)
  console.log(`   Workflow:`)
  console.log(`     - Images uploaded: ${finalSession?.workflowState.imagesUploaded}`)
  console.log(`     - Images analyzed: ${finalSession?.workflowState.imagesAnalyzed}`)
  console.log(`     - Discovery complete: ${finalSession?.workflowState.discoveryComplete}`)
  console.log(`     - Vibes developed: ${finalSession?.workflowState.vibesDeveloped}/5`)

  const fs = await import('fs')
  const files = fs.readdirSync(sessionPath)
  console.log(`\n   Files in session folder (${files.length}):`)
  files.forEach(f => console.log(`     - ${f}`))

  console.log('\n' + '='.repeat(60))
  console.log('END-TO-END TEST COMPLETE')
  console.log('='.repeat(60))
  console.log(`\nView the vibes at:`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-1-cantina-landing.html`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-2-holiday-special-landing.html`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-3-kashyyyk-landing.html`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-4-rebel-base-landing.html`)
}

main().catch(console.error)
