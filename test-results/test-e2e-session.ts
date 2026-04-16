/**
 * End-to-End Session Test
 * Creates a complete FalCaMel Cafe session with 4 vibes
 */

import {
  createSession,
  appendToSessionLog,
  updateWorkflowState,
  updateSessionPhase,
  saveVibeHtml,
  updateSessionMd,
  updateImagesMd,
  updateBuildMd,
  updateCreativeBriefMd,
  getSession
} from './lib/session'
import { hotSwap } from './lib/hot-swap'
import { copyFileSync, existsSync } from 'fs'
import path from 'path'

const IMAGES_DIR = path.join(process.cwd(), '..', 'images')

async function main() {
  console.log('='.repeat(60))
  console.log('END-TO-END SESSION TEST: FalCaMel Cafe')
  console.log('='.repeat(60))

  // 1. CREATE SESSION
  console.log('\n📁 STEP 1: Creating session...')
  const session = await createSession('FalCaMel Cafe')
  const sessionId = session.id
  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  console.log(`   Session ID: ${sessionId}`)
  console.log(`   Path: ${sessionPath}`)

  // 2. COPY SOURCE IMAGES
  console.log('\n🖼️  STEP 2: Copying source images...')
  const imagesToCopy = [
    { src: 'hero.jpg', dst: 'hero.jpg' },
    { src: 'hero-night.jpeg', dst: 'hero-night.jpg' },
    { src: 'sultan.jpg', dst: 'sultan.jpg' },
    { src: 'haboob.jpg', dst: 'haboob.jpg' },
    { src: 'qamar.jpg', dst: 'qamar.jpg' },
    { src: 'shams.jpg', dst: 'shams.jpg' },
    { src: 'dallah.jpg', dst: 'dallah.jpg' },
    { src: 'luqaimat.jpg', dst: 'luqaimat.jpg' },
    { src: 'falcon-diving.jpg', dst: 'falcon-diving.jpg' },
    { src: 'asir-highlands.jpg', dst: 'asir-highlands.jpg' },
    { src: 'falcamel-logo.jpg', dst: 'logo.jpg' },
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
**Files:** hero.jpg, hero-night.jpg, sultan.jpg, haboob.jpg, qamar.jpg, shams.jpg, dallah.jpg, luqaimat.jpg, falcon-diving.jpg, asir-highlands.jpg, logo.jpg
**Method:** Direct copy from /images/`)

  await appendToSessionLog(sessionId, 'CD → User',
    `Q1: What's the name of your business?
Q2: In one sentence that another business couldn't use, what is this place?
Q3: If this place were a person at a party, who would they be talking to?`)

  await appendToSessionLog(sessionId, 'User → CD',
    `A1: FalCaMel Café
A2: A cat café on the Tuwaiq Escarpment with a falcon, a camel named Haboob, and rescue cats — overlooking Six Flags Qiddiya.
A3: The person who just got back from abroad and is trying to explain why they're not ready to settle down yet.`)

  await appendToSessionLog(sessionId, 'CD → User',
    `Q4: Who is this place for? Give me a specific person, not a demographic.
Q5: What's the one thing you want every guest to feel when they leave?
Q6: What do you hate about generic cafés?`)

  await appendToSessionLog(sessionId, 'User → CD',
    `A4: Noura, 28, product designer at a Riyadh startup. She's tired of hotel lobbies and wants somewhere with personality where she can work, but also pet a cat.
A5: That they found somewhere that actually gets them. Like finding your weird friend.
A6: "Welcome to our café. We serve quality coffee in a professional environment." — Nobody talks like that. Nobody.`)

  await appendToSessionLog(sessionId, 'CD → User',
    `Q7: Tell me about the residents — the cats, the falcon, the camel.
Q8: What's on the menu? Real items, real prices.`)

  await appendToSessionLog(sessionId, 'User → CD',
    `A7:
- Sultan: The falcon. Imperious. Judges everyone. Has his own perch by the window.
- Haboob: The camel. Named after the sandstorm. Surprisingly gentle. Lives outside but visits.
- Qamar (Moon): Gray Persian. Sleeps 20 hours a day. The chill one.
- Shams (Sun): Orange tabby. Chaos incarnate. Knocks things over.

A8:
DRINKS:
- Qahwa (Arabic Coffee) — 15 SAR
- Karak Chai — 18 SAR
- Spanish Latte — 22 SAR
- Sunset Americano — 20 SAR

SWEETS:
- Luqaimat (honey dumplings) — 25 SAR
- Date Cake — 30 SAR
- Kunafa Cheesecake — 35 SAR

CAT TIME:
- 30 min session — 50 SAR
- 1 hour session — 80 SAR
- Adopt don't shop — Free (application required)`)

  await updateWorkflowState(sessionId, { discoveryComplete: true })

  // 4. UPDATE IMAGES.MD
  console.log('\n📸 STEP 4: Updating IMAGES.md with analysis...')

  const imagesMd = `# Image Registry

## Uploaded Images

### hero.jpg
**Uploaded:** ${new Date().toISOString()}
**Size:** 924KB
**Dimensions:** 2752 x 1536

**CD Analysis:**
The money shot. Man in white thobe sitting on traditional majlis cushions at golden hour.
Falcon (Sultan) on his arm. Orange cat (Shams) sleeping on the couch. Black cat (Qamar) on the other side.
Traditional brass dallah on low wooden table. Background: Tuwaiq Escarpment cliffs with Six Flags Qiddiya roller coasters visible in the distance.
Camel (Haboob) standing behind the majlis. Logo watermark in top-left.

**Suggested uses:** Hero, atmospheric background
**Suggested vibes:** Qahwa, Majlis, Haboob

---

### hero-night.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Same composition as hero.jpg but at dusk/night. The theme park lights are glowing.
More dramatic, mysterious mood. Good for a moodier vibe.

**Suggested uses:** Hero (night vibe)
**Suggested vibes:** Shams (sunset/night theme)

---

### sultan.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Close-up portrait of Sultan the falcon. Intense gaze. Regal posture.
Perfect for a "meet the residents" section.

**Suggested uses:** Portrait, gallery
**Suggested vibes:** All

---

### haboob.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Haboob the camel. Soft eyes, gentle expression.
Good for the "meet the residents" or a warmer, friendlier vibe.

**Suggested uses:** Portrait, gallery
**Suggested vibes:** Haboob

---

### falcon-diving.jpg
**Uploaded:** ${new Date().toISOString()}

**CD Analysis:**
Dramatic shot of a falcon mid-dive. Wings spread, talons extended.
Dynamic, powerful. Good for a hero if we want drama over coziness.

**Suggested uses:** Hero (dramatic), background
**Suggested vibes:** Sultan

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

  const creativeBrief = `# Creative Brief: FalCaMel Café

**Status:** APPROVED

---

## Business Identity

**One-sentence:** A cat café on the Tuwaiq Escarpment with a falcon, a camel named Haboob, and rescue cats — overlooking Six Flags Qiddiya.

**The Customer:** Noura, 28, product designer. Tired of hotel lobbies. Wants personality.

**The Weird Detail:** The camel is named Haboob (after the sandstorm).

**The Enemy:** "Welcome to our café. We serve quality coffee in a professional environment."

**The Promise:** You found somewhere that actually gets you.

---

## The Residents

| Name | Species | Personality |
|------|---------|-------------|
| Sultan | Falcon | Imperious. Judges everyone. |
| Haboob | Camel | Named after the sandstorm. Surprisingly gentle. |
| Qamar | Gray Persian | Sleeps 20 hours. The chill one. |
| Shams | Orange Tabby | Chaos incarnate. |

---

## Menu

### Drinks
- Qahwa (Arabic Coffee) — 15 SAR
- Karak Chai — 18 SAR
- Spanish Latte — 22 SAR
- Sunset Americano — 20 SAR

### Sweets
- Luqaimat (honey dumplings) — 25 SAR
- Date Cake — 30 SAR
- Kunafa Cheesecake — 35 SAR

### Cat Time
- 30 min session — 50 SAR
- 1 hour session — 80 SAR
- Adopt don't shop — Free (application required)

---

## Voice & Tone

**If this place were a person at a party:** The one who just got back from abroad and is trying to explain why they're not ready to settle down yet.

**Banned phrases:**
- "Book Now"
- "Welcome to..."
- "Experience the..."
- "Quality"
- "Professional"

**The Benchmark:** "Grandma's Waiting. She's already made too much food. Don't be late."

---

## The Four Vibes

### Vibe 1: QAHWA
**One-liner:** Where heritage meets the horizon.
**Voice:** Warm, grounded, inviting. Like being welcomed into someone's home.
**Colors:** #8B4513 (saddle brown), #F5E6D3 (cream), #D4A574 (sand), #2C1810 (coffee)
**For:** Someone seeking refuge from the generic.

### Vibe 2: MAJLIS
**One-liner:** Pull up a cushion. Stay a while.
**Voice:** Relaxed, conversational, a little irreverent.
**Colors:** #722F37 (wine), #F0E68C (khaki), #DEB887 (burlywood), #1a1a1a (charcoal)
**For:** Someone who wants to feel like a local, not a tourist.

### Vibe 3: HABOOB
**One-liner:** Sometimes the best things come with a little chaos.
**Voice:** Playful, slightly wild, unapologetic.
**Colors:** #E07020 (burnt orange), #F4A460 (sandy brown), #2F2F2F (dark gray), #FAEBD7 (antique white)
**For:** Someone who's tired of playing it safe.

### Vibe 4: SHAMS
**One-liner:** Chase the sunset. Pet a cat. Repeat.
**Voice:** Golden, dreamy, a touch of magic.
**Colors:** #FFB347 (pastel orange), #FF6B35 (orange red), #1a0a2e (deep purple), #FFFACD (lemon chiffon)
**For:** Someone chasing golden hour, always.

---

## WebDev Instructions

1. Build each vibe as self-contained HTML
2. Use relative paths for images: \`<img src="hero.jpg" data-slot="hero">\`
3. Include data-editable attributes for text
4. Full menu with prices in each vibe
5. Location section (Tuwaiq Escarpment, overlooking Qiddiya)
6. Booking CTA that sounds like the brand, not like "Book Now"
7. Footer with residents

---

## Booking Archetype

**Atomic Unit:** 30-minute cat session
**Specific Selection:** No (any available spot)
**Concurrent:** Yes (multiple people can book same time)
**Duration:** Rigid (30 min or 1 hour slots)
**Pricing:** Per session

**Closest Archetype:** Fitness Class (spot in a session)
`

  await updateCreativeBriefMd(sessionId, creativeBrief)

  // 6. CREATE 4 VIBE HTML FILES
  console.log('\n🎨 STEP 6: Creating 4 vibe HTML files...')
  await updateSessionPhase(sessionId, 'PHASE_3_BUILD')

  // VIBE 1: QAHWA
  const vibeQahwa = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FalCaMel Café — Qahwa</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Georgia', serif; background: #F5E6D3; color: #2C1810; }

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
    }
    .hero-content {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
      text-shadow: 0 2px 20px rgba(0,0,0,0.5);
      padding: 2rem;
    }
    .hero h1 {
      font-size: 4rem;
      font-weight: 300;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    .hero p {
      font-size: 1.5rem;
      font-style: italic;
      opacity: 0.9;
    }

    .section {
      padding: 5rem 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .menu {
      background: #2C1810;
      color: #F5E6D3;
    }
    .menu h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      font-weight: 300;
    }
    .menu-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 2rem;
    }
    .menu-category h3 {
      font-size: 1.3rem;
      margin-bottom: 1rem;
      color: #D4A574;
      border-bottom: 1px solid #D4A574;
      padding-bottom: 0.5rem;
    }
    .menu-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.8rem;
      font-size: 1.1rem;
    }
    .menu-item .price { color: #D4A574; }

    .residents {
      background: #F5E6D3;
    }
    .residents h2 {
      font-size: 2.5rem;
      text-align: center;
      margin-bottom: 3rem;
      color: #2C1810;
    }
    .residents-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 2rem;
      text-align: center;
    }
    .resident img {
      width: 150px;
      height: 150px;
      border-radius: 50%;
      object-fit: cover;
      border: 4px solid #8B4513;
    }
    .resident h4 { margin-top: 1rem; font-size: 1.3rem; }
    .resident p { color: #666; font-style: italic; }

    .cta-section {
      background: #8B4513;
      color: white;
      text-align: center;
      padding: 4rem 2rem;
    }
    .cta-section h2 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.2rem;
      margin-bottom: 2rem;
      opacity: 0.9;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: #F5E6D3;
      color: #2C1810;
      text-decoration: none;
      font-size: 1.2rem;
      border-radius: 4px;
      transition: transform 0.2s;
    }
    .cta-button:hover { transform: scale(1.05); }

    footer {
      background: #2C1810;
      color: #F5E6D3;
      padding: 3rem 2rem;
      text-align: center;
    }
    footer p { margin-bottom: 0.5rem; }
    .location { font-size: 1.1rem; opacity: 0.8; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="FalCaMel Café">
    <div class="hero-content">
      <h1 data-editable="headline">Still not ready to go home?</h1>
      <p data-editable="subline">Neither are we.</p>
    </div>
  </section>

  <section class="section menu">
    <h2 data-editable="menu-title">What We're Pouring</h2>
    <div class="menu-grid">
      <div class="menu-category">
        <h3>Drinks</h3>
        <div class="menu-item"><span>Qahwa (Arabic Coffee)</span><span class="price">15 SAR</span></div>
        <div class="menu-item"><span>Karak Chai</span><span class="price">18 SAR</span></div>
        <div class="menu-item"><span>Spanish Latte</span><span class="price">22 SAR</span></div>
        <div class="menu-item"><span>Sunset Americano</span><span class="price">20 SAR</span></div>
      </div>
      <div class="menu-category">
        <h3>Sweets</h3>
        <div class="menu-item"><span>Luqaimat</span><span class="price">25 SAR</span></div>
        <div class="menu-item"><span>Date Cake</span><span class="price">30 SAR</span></div>
        <div class="menu-item"><span>Kunafa Cheesecake</span><span class="price">35 SAR</span></div>
      </div>
      <div class="menu-category">
        <h3>Cat Time</h3>
        <div class="menu-item"><span>30 Minutes</span><span class="price">50 SAR</span></div>
        <div class="menu-item"><span>1 Hour</span><span class="price">80 SAR</span></div>
        <div class="menu-item"><span>Adopt Don't Shop</span><span class="price">Free</span></div>
      </div>
    </div>
  </section>

  <section class="section residents">
    <h2 data-editable="residents-title">Meet the Residents</h2>
    <div class="residents-grid">
      <div class="resident">
        <img src="sultan.jpg" data-slot="sultan" alt="Sultan">
        <h4>Sultan</h4>
        <p>The falcon. Judges everyone.</p>
      </div>
      <div class="resident">
        <img src="haboob.jpg" data-slot="haboob" alt="Haboob">
        <h4>Haboob</h4>
        <p>The camel. Surprisingly gentle.</p>
      </div>
      <div class="resident">
        <img src="qamar.jpg" data-slot="qamar" alt="Qamar">
        <h4>Qamar</h4>
        <p>Gray Persian. The chill one.</p>
      </div>
      <div class="resident">
        <img src="shams.jpg" data-slot="shams" alt="Shams">
        <h4>Shams</h4>
        <p>Orange tabby. Chaos incarnate.</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">Haboob's getting impatient.</h2>
    <p data-editable="cta-subline">He's been waiting all day. Don't make him wait any longer.</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Come say hello</a>
  </section>

  <footer>
    <p><strong>FalCaMel Café</strong></p>
    <p class="location">Tuwaiq Escarpment · Overlooking Six Flags Qiddiya</p>
    <p>Open daily: 4pm - midnight</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 1, 'Qahwa', 'landing', vibeQahwa)
  console.log('   ✓ vibe-1-qahwa-landing.html')

  // VIBE 2: MAJLIS
  const vibeMajlis = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FalCaMel Café — Majlis</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Palatino', serif; background: #1a1a1a; color: #F0E68C; }

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
      filter: brightness(0.7);
    }
    .hero-content {
      position: relative;
      z-index: 1;
      max-width: 600px;
    }
    .hero h1 {
      font-size: 3.5rem;
      font-weight: 400;
      line-height: 1.2;
      margin-bottom: 1rem;
      color: #F0E68C;
    }
    .hero p {
      font-size: 1.3rem;
      color: #DEB887;
    }

    .pull-quote {
      background: #722F37;
      padding: 4rem 2rem;
      text-align: center;
    }
    .pull-quote blockquote {
      font-size: 2rem;
      font-style: italic;
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .menu {
      padding: 5rem 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .menu h2 {
      font-size: 2rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid #722F37;
      padding-bottom: 1rem;
    }
    .menu-section { margin-bottom: 3rem; }
    .menu-section h3 {
      color: #722F37;
      font-size: 1.2rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 1rem;
    }
    .menu-item {
      display: flex;
      justify-content: space-between;
      padding: 0.8rem 0;
      border-bottom: 1px solid #333;
    }
    .menu-item span:last-child { color: #DEB887; }

    .residents {
      background: #722F37;
      padding: 5rem 2rem;
    }
    .residents h2 {
      text-align: center;
      font-size: 2rem;
      margin-bottom: 3rem;
    }
    .residents-flex {
      display: flex;
      justify-content: center;
      gap: 3rem;
      flex-wrap: wrap;
    }
    .resident {
      text-align: center;
      max-width: 180px;
    }
    .resident img {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #F0E68C;
    }
    .resident h4 { margin-top: 1rem; }
    .resident p { font-size: 0.9rem; opacity: 0.8; }

    .cta-section {
      padding: 5rem 2rem;
      text-align: center;
      background: #1a1a1a;
    }
    .cta-section h2 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.2rem;
      color: #DEB887;
      margin-bottom: 2rem;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: #722F37;
      color: #F0E68C;
      text-decoration: none;
      font-size: 1.1rem;
      letter-spacing: 0.05em;
      transition: all 0.2s;
    }
    .cta-button:hover {
      background: #8B3A42;
      transform: translateY(-2px);
    }

    footer {
      background: #0d0d0d;
      padding: 3rem 2rem;
      text-align: center;
      color: #666;
    }
    footer strong { color: #F0E68C; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="FalCaMel Café Majlis">
    <div class="hero-content">
      <h1 data-editable="headline">Pull up a cushion.<br>Stay a while.</h1>
      <p data-editable="subline">Where strangers become regulars.</p>
    </div>
  </section>

  <section class="pull-quote">
    <blockquote data-editable="quote">
      "I came for the coffee. I stayed because Shams knocked my laptop off the table and I had to wait for it to reboot."
    </blockquote>
  </section>

  <section class="menu">
    <h2 data-editable="menu-title">The Menu</h2>

    <div class="menu-section">
      <h3>To Drink</h3>
      <div class="menu-item"><span>Qahwa (Arabic Coffee)</span><span>15 SAR</span></div>
      <div class="menu-item"><span>Karak Chai</span><span>18 SAR</span></div>
      <div class="menu-item"><span>Spanish Latte</span><span>22 SAR</span></div>
      <div class="menu-item"><span>Sunset Americano</span><span>20 SAR</span></div>
    </div>

    <div class="menu-section">
      <h3>To Eat</h3>
      <div class="menu-item"><span>Luqaimat (honey dumplings)</span><span>25 SAR</span></div>
      <div class="menu-item"><span>Date Cake</span><span>30 SAR</span></div>
      <div class="menu-item"><span>Kunafa Cheesecake</span><span>35 SAR</span></div>
    </div>

    <div class="menu-section">
      <h3>Cat Time</h3>
      <div class="menu-item"><span>30 Minutes with the Crew</span><span>50 SAR</span></div>
      <div class="menu-item"><span>Full Hour of Chaos</span><span>80 SAR</span></div>
      <div class="menu-item"><span>Adopt Don't Shop</span><span>Priceless</span></div>
    </div>
  </section>

  <section class="residents">
    <h2 data-editable="residents-title">The Crew</h2>
    <div class="residents-flex">
      <div class="resident">
        <img src="sultan.jpg" data-slot="sultan" alt="Sultan">
        <h4>Sultan</h4>
        <p>Will judge your order</p>
      </div>
      <div class="resident">
        <img src="haboob.jpg" data-slot="haboob" alt="Haboob">
        <h4>Haboob</h4>
        <p>The gentle giant</p>
      </div>
      <div class="resident">
        <img src="qamar.jpg" data-slot="qamar" alt="Qamar">
        <h4>Qamar</h4>
        <p>Professional napper</p>
      </div>
      <div class="resident">
        <img src="shams.jpg" data-slot="shams" alt="Shams">
        <h4>Shams</h4>
        <p>Will knock things over</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">The cushion's getting cold.</h2>
    <p data-editable="cta-subline">And Qamar's hogging the best spot. Better hurry.</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Claim Your Spot</a>
  </section>

  <footer>
    <p><strong>FalCaMel Café</strong></p>
    <p>Tuwaiq Escarpment · Overlooking Six Flags Qiddiya</p>
    <p>Daily: 4pm - midnight · When the sunset hits, you'll understand.</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 2, 'Majlis', 'landing', vibeMajlis)
  console.log('   ✓ vibe-2-majlis-landing.html')

  // VIBE 3: HABOOB
  const vibeHaboob = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FalCaMel Café — Haboob</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', sans-serif; background: #2F2F2F; color: #FAEBD7; }

    .hero {
      height: 100vh;
      position: relative;
      overflow: hidden;
    }
    .hero img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: contrast(1.1) saturate(1.2);
    }
    .hero-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 4rem;
      background: linear-gradient(transparent, rgba(47,47,47,0.95));
    }
    .hero h1 {
      font-size: 4rem;
      font-weight: 800;
      color: #E07020;
      text-transform: uppercase;
      letter-spacing: -0.02em;
    }
    .hero p {
      font-size: 1.5rem;
      margin-top: 1rem;
    }

    .chaos-banner {
      background: #E07020;
      color: #2F2F2F;
      padding: 2rem;
      text-align: center;
      font-size: 1.3rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .menu {
      padding: 5rem 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    .menu h2 {
      font-size: 2.5rem;
      font-weight: 800;
      color: #E07020;
      margin-bottom: 2rem;
    }
    .menu-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 3rem;
    }
    .menu-category h3 {
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: #F4A460;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #E07020;
    }
    .menu-item {
      display: flex;
      justify-content: space-between;
      padding: 0.6rem 0;
      font-size: 1.1rem;
    }
    .menu-item .price {
      color: #E07020;
      font-weight: 600;
    }

    .residents {
      background: #E07020;
      color: #2F2F2F;
      padding: 5rem 2rem;
    }
    .residents h2 {
      text-align: center;
      font-size: 2.5rem;
      font-weight: 800;
      margin-bottom: 3rem;
    }
    .residents-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .resident {
      text-align: center;
    }
    .resident img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border: 4px solid #2F2F2F;
    }
    .resident h4 {
      margin-top: 1rem;
      font-size: 1.2rem;
      font-weight: 800;
    }
    .resident p {
      font-size: 0.9rem;
      opacity: 0.8;
    }

    .cta-section {
      padding: 5rem 2rem;
      text-align: center;
    }
    .cta-section h2 {
      font-size: 3rem;
      font-weight: 800;
      color: #E07020;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.3rem;
      margin-bottom: 2rem;
      color: #F4A460;
    }
    .cta-button {
      display: inline-block;
      padding: 1.2rem 3rem;
      background: #E07020;
      color: #2F2F2F;
      text-decoration: none;
      font-size: 1.2rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      transition: transform 0.2s;
    }
    .cta-button:hover {
      transform: scale(1.05) rotate(-1deg);
    }

    footer {
      background: #1a1a1a;
      padding: 3rem 2rem;
      text-align: center;
    }
    footer strong { color: #E07020; }
    footer p { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero.jpg" data-slot="hero" alt="FalCaMel Café">
    <div class="hero-overlay">
      <h1 data-editable="headline">Chaos.<br>Caffeine.<br>Cats.</h1>
      <p data-editable="subline">Not necessarily in that order.</p>
    </div>
  </section>

  <div class="chaos-banner" data-editable="banner">
    Warning: Shams will knock your drink over. We're not sorry.
  </div>

  <section class="menu">
    <h2 data-editable="menu-title">Fuel for the Storm</h2>
    <div class="menu-grid">
      <div class="menu-category">
        <h3>Liquid Courage</h3>
        <div class="menu-item"><span>Qahwa</span><span class="price">15 SAR</span></div>
        <div class="menu-item"><span>Karak Chai</span><span class="price">18 SAR</span></div>
        <div class="menu-item"><span>Spanish Latte</span><span class="price">22 SAR</span></div>
        <div class="menu-item"><span>Sunset Americano</span><span class="price">20 SAR</span></div>
      </div>
      <div class="menu-category">
        <h3>Sugar Rush</h3>
        <div class="menu-item"><span>Luqaimat</span><span class="price">25 SAR</span></div>
        <div class="menu-item"><span>Date Cake</span><span class="price">30 SAR</span></div>
        <div class="menu-item"><span>Kunafa Cheesecake</span><span class="price">35 SAR</span></div>
      </div>
      <div class="menu-category">
        <h3>Cat Chaos</h3>
        <div class="menu-item"><span>30 Min of Mayhem</span><span class="price">50 SAR</span></div>
        <div class="menu-item"><span>Full Hour Frenzy</span><span class="price">80 SAR</span></div>
        <div class="menu-item"><span>Take One Home</span><span class="price">Your Heart</span></div>
      </div>
    </div>
  </section>

  <section class="residents">
    <h2 data-editable="residents-title">THE TROUBLEMAKERS</h2>
    <div class="residents-grid">
      <div class="resident">
        <img src="sultan.jpg" data-slot="sultan" alt="Sultan">
        <h4>SULTAN</h4>
        <p>Security detail</p>
      </div>
      <div class="resident">
        <img src="haboob.jpg" data-slot="haboob" alt="Haboob">
        <h4>HABOOB</h4>
        <p>The big one</p>
      </div>
      <div class="resident">
        <img src="qamar.jpg" data-slot="qamar" alt="Qamar">
        <h4>QAMAR</h4>
        <p>Sleeping on the job</p>
      </div>
      <div class="resident">
        <img src="shams.jpg" data-slot="shams" alt="Shams">
        <h4>SHAMS</h4>
        <p>The one who started this</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">READY FOR THE STORM?</h2>
    <p data-editable="cta-subline">Haboob didn't get his name by being predictable.</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Bring It On</a>
  </section>

  <footer>
    <p><strong>FalCaMel Café</strong></p>
    <p>Tuwaiq Escarpment · Overlooking Six Flags Qiddiya</p>
    <p>4pm - midnight · Best viewed at sunset (or after)</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 3, 'Haboob', 'landing', vibeHaboob)
  console.log('   ✓ vibe-3-haboob-landing.html')

  // VIBE 4: SHAMS
  const vibeShams = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FalCaMel Café — Shams</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Avenir', 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 100%);
      color: #FFFACD;
      min-height: 100vh;
    }

    .hero {
      height: 100vh;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero img {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
      opacity: 0.6;
    }
    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(180deg, transparent 50%, #1a0a2e);
      z-index: 1;
    }
    .hero-content {
      position: relative;
      z-index: 2;
      text-align: center;
      padding: 2rem;
    }
    .hero h1 {
      font-size: 4.5rem;
      font-weight: 200;
      letter-spacing: 0.1em;
      color: #FFB347;
      margin-bottom: 1rem;
    }
    .hero p {
      font-size: 1.5rem;
      color: #FFFACD;
      font-weight: 300;
    }

    .golden-strip {
      height: 4px;
      background: linear-gradient(90deg, #FF6B35, #FFB347, #FF6B35);
    }

    .menu {
      padding: 5rem 2rem;
      max-width: 900px;
      margin: 0 auto;
    }
    .menu h2 {
      font-size: 2rem;
      font-weight: 300;
      text-align: center;
      color: #FFB347;
      margin-bottom: 3rem;
      letter-spacing: 0.1em;
    }
    .menu-columns {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 3rem;
    }
    .menu-category h3 {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: #FF6B35;
      margin-bottom: 1.5rem;
      text-align: center;
    }
    .menu-item {
      text-align: center;
      margin-bottom: 1rem;
    }
    .menu-item .name {
      display: block;
      font-size: 1.1rem;
      margin-bottom: 0.3rem;
    }
    .menu-item .price {
      color: #FFB347;
      font-size: 0.9rem;
    }

    .residents {
      padding: 5rem 2rem;
      background: rgba(255,179,71,0.1);
    }
    .residents h2 {
      text-align: center;
      font-size: 2rem;
      font-weight: 300;
      color: #FFB347;
      margin-bottom: 3rem;
      letter-spacing: 0.1em;
    }
    .residents-row {
      display: flex;
      justify-content: center;
      gap: 3rem;
      flex-wrap: wrap;
    }
    .resident {
      text-align: center;
      max-width: 150px;
    }
    .resident img {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #FFB347;
      box-shadow: 0 0 30px rgba(255,179,71,0.3);
    }
    .resident h4 {
      margin-top: 1rem;
      font-weight: 400;
      letter-spacing: 0.05em;
    }
    .resident p {
      font-size: 0.85rem;
      opacity: 0.7;
      font-style: italic;
    }

    .cta-section {
      padding: 6rem 2rem;
      text-align: center;
    }
    .cta-section h2 {
      font-size: 2.5rem;
      font-weight: 200;
      color: #FFB347;
      margin-bottom: 1rem;
    }
    .cta-section p {
      font-size: 1.2rem;
      margin-bottom: 2rem;
      opacity: 0.8;
    }
    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: linear-gradient(135deg, #FF6B35, #FFB347);
      color: #1a0a2e;
      text-decoration: none;
      font-size: 1rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-radius: 30px;
      transition: all 0.3s;
    }
    .cta-button:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 30px rgba(255,107,53,0.4);
    }

    footer {
      padding: 3rem 2rem;
      text-align: center;
      border-top: 1px solid rgba(255,179,71,0.2);
    }
    footer p {
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
    }
    footer strong { color: #FFB347; }
  </style>
</head>
<body>
  <section class="hero">
    <img src="hero-night.jpg" data-slot="hero" alt="FalCaMel at Golden Hour">
    <div class="hero-content">
      <h1 data-editable="headline">Golden Hour</h1>
      <p data-editable="subline">Chase the sunset. Pet a cat. Repeat.</p>
    </div>
  </section>

  <div class="golden-strip"></div>

  <section class="menu">
    <h2 data-editable="menu-title">The Ritual</h2>
    <div class="menu-columns">
      <div class="menu-category">
        <h3>Sip</h3>
        <div class="menu-item">
          <span class="name">Qahwa</span>
          <span class="price">15 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">Karak Chai</span>
          <span class="price">18 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">Spanish Latte</span>
          <span class="price">22 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">Sunset Americano</span>
          <span class="price">20 SAR</span>
        </div>
      </div>
      <div class="menu-category">
        <h3>Savor</h3>
        <div class="menu-item">
          <span class="name">Luqaimat</span>
          <span class="price">25 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">Date Cake</span>
          <span class="price">30 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">Kunafa Cheesecake</span>
          <span class="price">35 SAR</span>
        </div>
      </div>
      <div class="menu-category">
        <h3>Stay</h3>
        <div class="menu-item">
          <span class="name">30 Minutes</span>
          <span class="price">50 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">1 Hour</span>
          <span class="price">80 SAR</span>
        </div>
        <div class="menu-item">
          <span class="name">Forever</span>
          <span class="price">Adopt</span>
        </div>
      </div>
    </div>
  </section>

  <section class="residents">
    <h2 data-editable="residents-title">The Magic Makers</h2>
    <div class="residents-row">
      <div class="resident">
        <img src="sultan.jpg" data-slot="sultan" alt="Sultan">
        <h4>Sultan</h4>
        <p>Guardian of dusk</p>
      </div>
      <div class="resident">
        <img src="haboob.jpg" data-slot="haboob" alt="Haboob">
        <h4>Haboob</h4>
        <p>Gentle soul</p>
      </div>
      <div class="resident">
        <img src="qamar.jpg" data-slot="qamar" alt="Qamar">
        <h4>Qamar</h4>
        <p>Moon child</p>
      </div>
      <div class="resident">
        <img src="shams.jpg" data-slot="shams" alt="Shams">
        <h4>Shams</h4>
        <p>Ray of light</p>
      </div>
    </div>
  </section>

  <section class="cta-section">
    <h2 data-editable="cta-headline">The sun's setting.</h2>
    <p data-editable="cta-subline">And Shams is chasing the last light across the floor. Join her?</p>
    <a href="#book" class="cta-button" data-editable="cta-button">Catch the Light</a>
  </section>

  <footer>
    <p><strong>FalCaMel Café</strong></p>
    <p>Tuwaiq Escarpment · Overlooking Six Flags Qiddiya</p>
    <p>4pm - midnight · Best experienced at golden hour</p>
  </footer>
</body>
</html>`

  await saveVibeHtml(sessionId, 4, 'Shams', 'landing', vibeShams)
  console.log('   ✓ vibe-4-shams-landing.html')

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
| 1 | Qahwa | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |
| 2 | Majlis | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |
| 3 | Haboob | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |
| 4 | Shams | COMPLETE | ${new Date().toISOString()} | ${new Date().toISOString()} |

---

## Vibe 1: Qahwa

### Files
- vibe-1-qahwa-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |
| sultan | sultan.jpg | ✓ |
| haboob | haboob.jpg | ✓ |
| qamar | qamar.jpg | ✓ |
| shams | shams.jpg | ✓ |

---

## Vibe 2: Majlis

### Files
- vibe-2-majlis-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |
| sultan | sultan.jpg | ✓ |
| haboob | haboob.jpg | ✓ |
| qamar | qamar.jpg | ✓ |
| shams | shams.jpg | ✓ |

---

## Vibe 3: Haboob

### Files
- vibe-3-haboob-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |
| sultan | sultan.jpg | ✓ |
| haboob | haboob.jpg | ✓ |
| qamar | qamar.jpg | ✓ |
| shams | shams.jpg | ✓ |

---

## Vibe 4: Shams

### Files
- vibe-4-shams-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero-night.jpg | ✓ |
| sultan | sultan.jpg | ✓ |
| haboob | haboob.jpg | ✓ |
| qamar | qamar.jpg | ✓ |
| shams | shams.jpg | ✓ |

---

## Hot-Swap Log

| Time | Vibe | Slot | Old | New |
|------|------|------|-----|-----|
| ${new Date().toLocaleTimeString()} | All vibes | All | (initial) | Source images |

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
  console.log(`  http://localhost:3000/${sessionId}/vibe-1-qahwa-landing.html`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-2-majlis-landing.html`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-3-haboob-landing.html`)
  console.log(`  http://localhost:3000/${sessionId}/vibe-4-shams-landing.html`)
}

main().catch(console.error)
