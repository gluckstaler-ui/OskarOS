/**
 * E2E Test: Aperol Bar Ready
 *
 * A rooftop bar in Zurich that serves ONLY Aperol Spritz.
 * Tests the full flow with proper CD copywriting → WebDev implementation.
 */

import * as fs from 'fs'
import * as path from 'path'

const SESSION_ID = '2026-01-26-aperol-bar-ready'
const SESSION_DIR = path.join(process.cwd(), 'public', SESSION_ID)

// ============================================================
// PHASE 1: DISCOVERY (COO answers, logged to SESSION.md)
// ============================================================

const DISCOVERY = {
  businessName: 'Aperol Bar Ready',

  // Identity
  location: 'Rooftop terrace, Seefeld, Zurich. View of the lake and Alps.',
  hours: 'May-September: 5pm-midnight. Weather permitting. If it rains, we close.',

  // Concept
  oneSentence: 'A rooftop bar that serves one thing: Aperol Spritz. That\'s it.',
  whatPeopleDo: 'Drink Aperol Spritz. Watch the sunset. Talk to strangers. Stay too late.',

  // Signature
  onlyYouOffer: 'We don\'t have a menu. You get an Aperol Spritz. If you want something else, go somewhere else.',
  tellAFriend: 'The view. The vibe. The fact that everyone\'s drinking the same thing so you\'re automatically friends.',
  momentRemember: 'When the sun hits the Alps and everyone goes quiet for a second.',

  // Audience
  specificPerson: 'Lena, 34, works in marketing at a Zurich agency. She\'s tired of craft cocktail bars where the bartender lectures you. She wants a drink that tastes like summer and people who don\'t take themselves seriously.',
  culturalContext: 'Zurich professionals who\'ve spent time in Italy. They get it.',
  notFor: 'Cocktail snobs. People who need 47 menu options. Anyone who says "I don\'t really like Aperol."',

  // Tone
  partyPerson: 'The Italian friend who\'s always slightly late, always overdressed for the weather, and always makes the evening better.',
  attitude: 'Unapologetically single-minded. A little bit ridiculous. Completely confident.',
  culturalRef: 'That one bar in Milan everyone knows. The feeling of aperitivo hour.',

  // Visual
  aesthetic: 'Warm sunset orange. Clean and modern but not cold. Like an Italian terrace, not a Swiss bank.',
  similarFeels: 'Soho House but less exclusive. Eataly but just the bar.',
  luxuryOrAccessible: 'Accessible luxury. Premium price (CHF 18) but not pretentious.',

  // Menu (there is only one thing)
  menu: {
    drink: {
      name: 'Aperol Spritz',
      description: 'Aperol, prosecco, soda, orange. The way it\'s supposed to be made.',
      price: 'CHF 18',
    },
    snack: {
      name: 'Olives',
      description: 'Just olives. Castelvetrano. In a little bowl.',
      price: 'CHF 6',
    },
    bottle: {
      name: 'Prosecco (whole bottle)',
      description: 'If you\'re staying. And you should be.',
      price: 'CHF 45',
    }
  },

  // Booking
  bookingType: 'Table reservation for sunset. 90-minute slots. First come, first served for walk-ins at bar.',

  // Enemy
  enemy: 'Cocktail bars with 200-item menus and bartenders who make you feel stupid for ordering something simple.',
}

// ============================================================
// PHASE 2: CD WRITES COMPLETE COPY FOR EACH VIBE
// ============================================================

const VIBE_1_COPY = {
  name: 'Spritz Season',
  oneLiner: 'One drink. One view. One vibe.',
  voice: 'Confident, minimal, slightly smug. Knows exactly what it is.',
  whoItsFor: 'Lena who doesn\'t want to think about what to order.',

  colors: {
    primary: '#FF6B35', // Aperol orange
    secondary: '#FFF8F0', // Warm cream
    accent: '#1A1A1A', // Clean black
    text: '#2D2D2D',
  },
  fonts: {
    headline: 'DM Serif Display',
    body: 'DM Sans',
  },

  // COMPLETE COPY
  hero: {
    tagline: 'Zurich · Rooftop · Seefeld',
    headline: 'We serve **one thing**.',
    subtitle: 'Aperol Spritz. That\'s the menu. That\'s the whole menu. If you wanted options, you came to the wrong place.',
  },

  hook: {
    headline: 'You already know what you\'re ordering. **Why pretend otherwise?**',
    body: 'You\'ve been to those bars. The ones with 47 pages of cocktails and a bartender who judges your choice. You\'ve squinted at menus in bad lighting. You\'ve ordered something safe. You\'ve wondered if you should have been more adventurous. Forget all of that. Here, you sit down. We bring you a Spritz. The sun sets. The Alps turn pink. You\'re welcome.',
  },

  location: {
    sectionLabel: 'Find us',
    sectionTitle: 'The Rooftop',
    intro: 'We\'re on top of a building in Seefeld. You\'ll see the lake. You\'ll see the Alps. You\'ll see people who look like they\'re having a better time than you. Join them.',
    details: {
      address: 'Seefeldstrasse 123, 8008 Zürich',
      hours: 'May-September · 5pm-midnight',
      weather: 'If it rains, we close. Check Instagram.',
      parking: 'Don\'t drive. Take the tram. You\'ll be drinking.',
    }
  },

  menu: {
    sectionLabel: 'The menu',
    sectionTitle: 'That\'s It. That\'s The Menu.',
    intro: 'We believe in doing one thing well. This is the one thing.',
    categories: [
      {
        name: 'Drinks',
        items: [
          {
            name: 'Aperol Spritz',
            description: 'Aperol, prosecco, soda, orange slice. Cold glass. Perfect ratio. No questions asked.',
            price: 'CHF 18'
          },
          {
            name: 'Prosecco',
            description: 'The whole bottle. For the table. Because you\'re staying.',
            price: 'CHF 45'
          },
        ]
      },
      {
        name: 'Snacks (If You Must)',
        items: [
          {
            name: 'Olives',
            description: 'Castelvetrano. Green. Buttery. In a small bowl.',
            price: 'CHF 6'
          },
        ]
      }
    ]
  },

  booking: {
    sectionLabel: 'Reserve',
    headline: 'The sunset won\'t wait.',
    body: 'Tables are 90 minutes. The bar is first-come. Either way, arrive before 7pm or watch the sunset from somewhere worse.',
    button: 'Grab a Table',
  },

  footer: {
    tagline: 'One drink. Done right.',
  }
}

const VIBE_2_COPY = {
  name: 'Aperitivo Hour',
  oneLiner: 'The golden hour, every hour.',
  voice: 'Warm, Italian-inflected, leisurely. Like your friend who moved to Milan.',
  whoItsFor: 'People who\'ve been to Italy and want to feel that way again.',

  colors: {
    primary: '#E85D04', // Deeper orange
    secondary: '#FFFBF5', // Warm white
    accent: '#6B4226', // Warm brown
    text: '#3D3D3D',
  },
  fonts: {
    headline: 'Playfair Display',
    body: 'Lato',
  },

  // COMPLETE COPY
  hero: {
    tagline: 'Aperitivo · Zurich',
    headline: 'La dolce vita, **auf dem Dach**.',
    subtitle: 'Every evening at 5pm, we pour. Every evening at sunset, we watch. Every evening, we remember why we love summer.',
  },

  hook: {
    headline: 'In Italy, this is just called **Tuesday**.',
    body: 'Aperitivo isn\'t a drink. It\'s a time of day. It\'s the hour when work ends and the evening begins. When the light turns gold and strangers become friends. When one drink turns into two because why not, the night is young. We brought that feeling to Zurich. The Spritz is the same. The view might be better.',
  },

  location: {
    sectionLabel: 'Dove siamo',
    sectionTitle: 'The Terrace',
    intro: 'Perched above Seefeld with the lake on one side and the Alps on the other. On a clear evening, you can see all the way to Italy. Almost.',
    details: {
      address: 'Seefeldstrasse 123, 8008 Zürich',
      hours: 'Maggio-Settembre · 17:00-24:00',
      weather: 'We close when it rains. Italians understand.',
      transit: 'Tram 2 or 4 to Feldeggstrasse. Walk 2 minutes.',
    }
  },

  menu: {
    sectionLabel: 'Il menù',
    sectionTitle: 'Simple. As It Should Be.',
    intro: 'In Milan, you don\'t need a menu. You sit, they bring you a Spritz, and the evening unfolds. Same here.',
    categories: [
      {
        name: 'Da Bere',
        items: [
          {
            name: 'Aperol Spritz',
            description: 'The classic. Aperol, prosecco, una spruzzata di soda, arancia. Perfetto.',
            price: 'CHF 18'
          },
          {
            name: 'Prosecco DOC',
            description: 'Per chi resta. Per chi vuole festeggiare. Per chi ha amici.',
            price: 'CHF 45'
          },
        ]
      },
      {
        name: 'Stuzzichini',
        items: [
          {
            name: 'Olive di Castelvetrano',
            description: 'Verdi, dolci, siciliane. Come nonna le serviva.',
            price: 'CHF 6'
          },
        ]
      }
    ]
  },

  booking: {
    sectionLabel: 'Prenotare',
    headline: 'Un tavolo al tramonto.',
    body: 'The best tables go fast. The sunset doesn\'t wait. Reserve, or take your chances at the bar.',
    button: 'Prenota Adesso',
  },

  footer: {
    tagline: 'Cin cin.',
  }
}

const VIBE_3_COPY = {
  name: 'No Menu Needed',
  oneLiner: 'Decision fatigue ends here.',
  voice: 'Direct, slightly irreverent, anti-pretension. For people tired of choices.',
  whoItsFor: 'Lena after a long day who just wants to not think.',

  colors: {
    primary: '#FF5722', // Bright orange
    secondary: '#FAFAFA', // Clean white
    accent: '#212121', // Pure black
    text: '#424242',
  },
  fonts: {
    headline: 'Space Grotesk',
    body: 'Inter',
  },

  // COMPLETE COPY
  hero: {
    tagline: 'Zurich\'s Simplest Bar',
    headline: '**No menu.** No decisions. No regrets.',
    subtitle: 'You sit. We bring you an Aperol Spritz. The sun sets. You realize this is all you ever wanted.',
  },

  hook: {
    headline: 'The average cocktail bar has 127 options. **We have one.**',
    body: 'Think about every time you\'ve stared at a menu. Compared prices. Worried you ordered wrong. Asked your friend what they\'re getting. Watched someone else\'s drink arrive and felt jealous. Now forget all of that forever. We have one drink. It\'s perfect. It\'s orange. It arrives cold. Your evening starts now.',
  },

  location: {
    sectionLabel: 'Location',
    sectionTitle: 'Seefeld Rooftop',
    intro: 'We\'re on a roof in Seefeld. There\'s a view. It\'s good. You don\'t need more information than that.',
    details: {
      address: 'Seefeldstrasse 123, Zürich',
      hours: 'Summer only · Sunset hours',
      weather: 'Rain = closed. Sun = open. Simple.',
      access: 'Tram to Seefeld. Elevator to roof.',
    }
  },

  menu: {
    sectionLabel: 'Menu',
    sectionTitle: 'You\'re Looking At It.',
    intro: 'We eliminated choice so you could eliminate stress.',
    categories: [
      {
        name: 'The Drink',
        items: [
          {
            name: 'Aperol Spritz',
            description: 'It\'s an Aperol Spritz. You know what\'s in it. We make it properly.',
            price: 'CHF 18'
          },
        ]
      },
      {
        name: 'The Extras',
        items: [
          {
            name: 'Prosecco Bottle',
            description: 'If one round isn\'t enough. It usually isn\'t.',
            price: 'CHF 45'
          },
          {
            name: 'Olives',
            description: 'Something to eat so you can drink more.',
            price: 'CHF 6'
          },
        ]
      }
    ]
  },

  booking: {
    sectionLabel: 'Tables',
    headline: 'Skip the decision. Book the table.',
    body: '90 minutes. Sunset views. Zero menu anxiety. First-come bar seating also available for the spontaneous.',
    button: 'Reserve a Spot',
  },

  footer: {
    tagline: 'Less is more. Especially when it\'s orange.',
  }
}

const VIBE_4_COPY = {
  name: 'Rooftop Ritual',
  oneLiner: 'Where Zurich watches the sun go down.',
  voice: 'Premium but not pretentious. Confident. The best-kept secret that isn\'t.',
  whoItsFor: 'People who want a beautiful evening without the effort of finding it.',

  colors: {
    primary: '#F4511E', // Sunset orange
    secondary: '#FBE9E7', // Soft coral cream
    accent: '#BF360C', // Deep orange
    text: '#3E2723',
  },
  fonts: {
    headline: 'Cormorant Garamond',
    body: 'Source Sans Pro',
  },

  // COMPLETE COPY
  hero: {
    tagline: 'Seefeld · Rooftop · Summer',
    headline: 'The view everyone\'s **talking about**.',
    subtitle: 'Lake Zurich on one side. The Alps on the other. An Aperol Spritz in your hand. This is what summer evenings are for.',
  },

  hook: {
    headline: 'Some people watch the sunset. **Some people become part of it.**',
    body: 'There\'s a moment every evening when the light turns gold. The Alps catch fire. The lake goes still. Everyone on the rooftop looks up from their conversations at exactly the same time. It lasts about ninety seconds. Then someone raises their glass, someone laughs, and the evening continues. You should be there for that moment.',
  },

  location: {
    sectionLabel: 'The Rooftop',
    sectionTitle: 'Above It All',
    intro: 'We picked this building for the view. Seefeld below, the lake stretching to the mountains, and nothing but sky above. Find the unmarked door. Take the elevator. Join us.',
    details: {
      address: 'Seefeldstrasse 123, 8008 Zürich',
      hours: 'May through September · 5pm until midnight',
      weather: 'Clear skies only. Check @aperolbarready',
      access: 'Elevator to the top floor. Follow the orange.',
    }
  },

  menu: {
    sectionLabel: 'What We Serve',
    sectionTitle: 'One Perfect Drink.',
    intro: 'We spent two years perfecting our Spritz. The ratio. The ice. The glass. The orange slice. Then we stopped. One thing, done right.',
    categories: [
      {
        name: 'The Spritz',
        items: [
          {
            name: 'Aperol Spritz',
            description: 'Three parts prosecco, two parts Aperol, one part soda. Served in a proper wine glass with a slice of orange and more ice than you expect. Crisp, bitter, perfect.',
            price: 'CHF 18'
          },
        ]
      },
      {
        name: 'For The Table',
        items: [
          {
            name: 'Prosecco',
            description: 'A full bottle of what goes in your Spritz. For groups. For celebrations. For staying.',
            price: 'CHF 45'
          },
          {
            name: 'Castelvetrano Olives',
            description: 'Bright green, buttery, from Sicily. The only food item we serve because it\'s the only one that matters.',
            price: 'CHF 6'
          },
        ]
      }
    ]
  },

  booking: {
    sectionLabel: 'Reserve',
    headline: 'Good evenings don\'t happen by accident.',
    body: 'Tables for 90 minutes with guaranteed sunset views. Walk-ins welcome at the bar if there\'s space. There usually isn\'t.',
    button: 'Book Your Evening',
  },

  footer: {
    tagline: 'See you on the rooftop.',
  }
}

// ============================================================
// WEBDEV: BUILD HTML FROM CD'S COPY
// ============================================================

function buildVibeHtml(vibeNumber: number, copy: any): string {
  const safeName = copy.name.toLowerCase().replace(/\s+/g, '-')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aperol Bar Ready — ${copy.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${copy.fonts.headline.replace(/\s+/g, '+')}:wght@400;500;600;700&family=${copy.fonts.body.replace(/\s+/g, '+')}:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: ${copy.colors.primary};
      --secondary: ${copy.colors.secondary};
      --accent: ${copy.colors.accent};
      --text: ${copy.colors.text};
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: '${copy.fonts.body}', sans-serif;
      background: var(--secondary);
      color: var(--text);
      line-height: 1.7;
    }

    h1, h2, h3 {
      font-family: '${copy.fonts.headline}', serif;
      font-weight: 500;
      line-height: 1.2;
    }

    /* Hero */
    .hero {
      min-height: 100vh;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: linear-gradient(135deg, var(--primary) 0%, #ff8a50 100%);
    }

    .hero::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url('hero.jpg') center/cover;
      opacity: 0.3;
      z-index: 0;
    }

    .hero-content {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 2rem;
      max-width: 800px;
    }

    .hero-tagline {
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: rgba(255,255,255,0.8);
      margin-bottom: 1.5rem;
    }

    .hero h1 {
      font-size: clamp(2.5rem, 6vw, 4rem);
      color: white;
      margin-bottom: 1.5rem;
    }

    .hero h1 strong {
      color: var(--secondary);
    }

    .hero-subtitle {
      font-size: 1.2rem;
      color: rgba(255,255,255,0.9);
      max-width: 600px;
      margin: 0 auto;
    }

    /* Hook */
    .hook {
      padding: 6rem 2rem;
      background: var(--secondary);
    }

    .hook-content {
      max-width: 750px;
      margin: 0 auto;
      text-align: center;
    }

    .hook h2 {
      font-size: clamp(1.5rem, 4vw, 2.2rem);
      color: var(--text);
      margin-bottom: 2rem;
      line-height: 1.4;
    }

    .hook h2 strong {
      color: var(--primary);
    }

    .hook p {
      font-size: 1.1rem;
      color: var(--text);
      opacity: 0.8;
      line-height: 1.9;
    }

    /* Menu */
    .menu {
      padding: 6rem 2rem;
      background: var(--accent);
      color: white;
    }

    .menu-header {
      text-align: center;
      max-width: 600px;
      margin: 0 auto 4rem;
    }

    .section-label {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--primary);
      margin-bottom: 0.5rem;
    }

    .menu h2 {
      font-size: 2.2rem;
      color: white;
      margin-bottom: 1rem;
    }

    .menu-intro {
      font-size: 1.05rem;
      opacity: 0.8;
    }

    .menu-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 3rem;
      max-width: 900px;
      margin: 0 auto;
    }

    .menu-category h3 {
      font-size: 1.1rem;
      color: var(--primary);
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    }

    .menu-item {
      margin-bottom: 1.5rem;
    }

    .menu-item-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.25rem;
    }

    .menu-item-name {
      font-family: '${copy.fonts.headline}', serif;
      font-size: 1.1rem;
    }

    .menu-item-price {
      color: var(--primary);
      font-weight: 500;
    }

    .menu-item-desc {
      font-size: 0.9rem;
      opacity: 0.7;
      line-height: 1.6;
    }

    /* Location */
    .location {
      padding: 6rem 2rem;
      background: var(--secondary);
    }

    .location-content {
      max-width: 700px;
      margin: 0 auto;
      text-align: center;
    }

    .location .section-label {
      color: var(--primary);
    }

    .location h2 {
      font-size: 2rem;
      color: var(--text);
      margin-bottom: 1.5rem;
    }

    .location-intro {
      font-size: 1.1rem;
      margin-bottom: 2.5rem;
      line-height: 1.8;
    }

    .location-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.5rem;
      text-align: left;
      background: white;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.05);
    }

    .location-detail strong {
      display: block;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--primary);
      margin-bottom: 0.25rem;
    }

    .location-detail span {
      font-size: 0.95rem;
      opacity: 0.8;
    }

    /* Booking CTA */
    .booking {
      padding: 6rem 2rem;
      background: var(--primary);
      text-align: center;
    }

    .booking .section-label {
      color: rgba(255,255,255,0.7);
    }

    .booking h2 {
      font-size: 2.5rem;
      color: white;
      margin-bottom: 1rem;
    }

    .booking p {
      font-size: 1.1rem;
      color: rgba(255,255,255,0.9);
      max-width: 500px;
      margin: 0 auto 2rem;
    }

    .cta-button {
      display: inline-block;
      padding: 1rem 3rem;
      background: white;
      color: var(--primary);
      text-decoration: none;
      font-size: 1rem;
      font-weight: 600;
      border-radius: 50px;
      transition: all 0.3s ease;
    }

    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }

    /* Footer */
    footer {
      padding: 3rem 2rem;
      background: var(--accent);
      color: white;
      text-align: center;
    }

    .footer-logo {
      font-family: '${copy.fonts.headline}', serif;
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .footer-tagline {
      font-size: 1rem;
      opacity: 0.7;
      font-style: italic;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .location-details {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <!-- Hero -->
  <section class="hero">
    <div class="hero-content">
      <p class="hero-tagline" data-editable="tagline">${copy.hero.tagline}</p>
      <h1 data-editable="headline">${copy.hero.headline.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</h1>
      <p class="hero-subtitle" data-editable="subtitle">${copy.hero.subtitle}</p>
    </div>
  </section>

  <!-- Hook -->
  <section class="hook">
    <div class="hook-content">
      <h2 data-editable="hook-headline">${copy.hook.headline.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</h2>
      <p data-editable="hook-body">${copy.hook.body}</p>
    </div>
  </section>

  <!-- Menu -->
  <section class="menu">
    <div class="menu-header">
      <p class="section-label">${copy.menu.sectionLabel}</p>
      <h2 data-editable="menu-title">${copy.menu.sectionTitle}</h2>
      <p class="menu-intro" data-editable="menu-intro">${copy.menu.intro}</p>
    </div>

    <div class="menu-grid">
      ${copy.menu.categories.map((cat: any) => `
      <div class="menu-category">
        <h3>${cat.name}</h3>
        ${cat.items.map((item: any) => `
        <div class="menu-item">
          <div class="menu-item-header">
            <span class="menu-item-name">${item.name}</span>
            <span class="menu-item-price">${item.price}</span>
          </div>
          <p class="menu-item-desc">${item.description}</p>
        </div>
        `).join('')}
      </div>
      `).join('')}
    </div>
  </section>

  <!-- Location -->
  <section class="location">
    <div class="location-content">
      <p class="section-label">${copy.location.sectionLabel}</p>
      <h2 data-editable="location-title">${copy.location.sectionTitle}</h2>
      <p class="location-intro" data-editable="location-intro">${copy.location.intro}</p>

      <div class="location-details">
        <div class="location-detail">
          <strong>Address</strong>
          <span>${copy.location.details.address}</span>
        </div>
        <div class="location-detail">
          <strong>Hours</strong>
          <span>${copy.location.details.hours}</span>
        </div>
        <div class="location-detail">
          <strong>Weather Policy</strong>
          <span>${copy.location.details.weather}</span>
        </div>
        <div class="location-detail">
          <strong>Getting Here</strong>
          <span>${(copy.location.details as any).parking || (copy.location.details as any).transit || (copy.location.details as any).access}</span>
        </div>
      </div>
    </div>
  </section>

  <!-- Booking CTA -->
  <section class="booking">
    <p class="section-label">${copy.booking.sectionLabel}</p>
    <h2 data-editable="booking-headline">${copy.booking.headline}</h2>
    <p data-editable="booking-body">${copy.booking.body}</p>
    <a href="#book" class="cta-button" data-editable="booking-button">${copy.booking.button}</a>
  </section>

  <!-- Footer -->
  <footer>
    <p class="footer-logo">Aperol Bar Ready</p>
    <p class="footer-tagline" data-editable="footer-tagline">${copy.footer.tagline}</p>
  </footer>
</body>
</html>`
}

// ============================================================
// CREATE SESSION FILES
// ============================================================

function createSession() {
  // Create session directory
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true })
  }

  // Copy image from images folder
  const sourceImage = path.join(process.cwd(), '..', 'images', 'aperol-bar-ready.jpeg')
  const targetImage = path.join(SESSION_DIR, 'hero.jpg')
  if (fs.existsSync(sourceImage)) {
    fs.copyFileSync(sourceImage, targetImage)
    console.log('✓ Copied hero.jpg')
  } else {
    console.log('⚠ No hero image found at', sourceImage)
  }

  // Create SESSION.md
  const sessionMd = `# Session: Aperol Bar Ready
**Created:** ${new Date().toISOString()}
**Status:** PHASE_3_BUILD
**Business:** Aperol Bar Ready

---

## Workflow State
- [x] Images uploaded
- [x] Images analyzed by CD
- [x] Discovery complete
- [x] Vibes developed (4/4)
- [ ] Image prompts approved
- [ ] CEO selection made
- [ ] Final build complete

---

## Discovery Summary
**One-sentence:** A rooftop bar that serves one thing: Aperol Spritz. That's it.
**Customer:** Lena, 34, marketing professional, tired of choice, wants summer in a glass.
**Weird detail:** They close when it rains. No exceptions.
**Enemy:** Cocktail bars with 200-item menus.

---

## Conversation Log

---
#### CD → COO | ${new Date().toTimeString().slice(0,8)}

Q1: What's the name of your business?
Q2: In one sentence, what is this place?
Q3: What do people actually DO here?

---
#### COO → CD | ${new Date().toTimeString().slice(0,8)}

A1: ${DISCOVERY.businessName}
A2: ${DISCOVERY.oneSentence}
A3: ${DISCOVERY.whatPeopleDo}

---
#### CD → COO | ${new Date().toTimeString().slice(0,8)}

Q4: What's the thing only YOU offer?
Q5: Who is this for? Describe a specific person.
Q6: What do you hate about other cocktail bars?

---
#### COO → CD | ${new Date().toTimeString().slice(0,8)}

A4: ${DISCOVERY.onlyYouOffer}
A5: ${DISCOVERY.specificPerson}
A6: ${DISCOVERY.enemy}
`

  fs.writeFileSync(path.join(SESSION_DIR, 'SESSION.md'), sessionMd)
  console.log('✓ Created SESSION.md')

  // Create IMAGES.md
  const imagesMd = `# Image Registry

## Uploaded Images

### hero.jpg
**Uploaded:** ${new Date().toISOString()}
**Size:** ~500KB
**Dimensions:** 1920 x 1080

**CD Analysis:**
Sunset rooftop scene. Orange Aperol Spritz glasses in foreground, warm golden light.
The view shows a lake and mountains in the distance. People are out of focus in background,
creating atmosphere without distraction. Perfect for hero section across all vibes.

**Suggested uses:** Hero background, mood setter
**Suggested vibes:** All four vibes can use this

---

## Image Prompts + Generated

(No additional images generated yet - the hero captures the vibe perfectly)

---

## Manipulations

(None needed)
`

  fs.writeFileSync(path.join(SESSION_DIR, 'IMAGES.md'), imagesMd)
  console.log('✓ Created IMAGES.md')

  // Create BUILD.md
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
| 1 | Spritz Season | COMPLETE | ${new Date().toTimeString().slice(0,8)} | ${new Date().toTimeString().slice(0,8)} |
| 2 | Aperitivo Hour | COMPLETE | ${new Date().toTimeString().slice(0,8)} | ${new Date().toTimeString().slice(0,8)} |
| 3 | No Menu Needed | COMPLETE | ${new Date().toTimeString().slice(0,8)} | ${new Date().toTimeString().slice(0,8)} |
| 4 | Rooftop Ritual | COMPLETE | ${new Date().toTimeString().slice(0,8)} | ${new Date().toTimeString().slice(0,8)} |

---

## Vibe 1: Spritz Season

### Files
- vibe-1-spritz-season-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |

---

## Vibe 2: Aperitivo Hour

### Files
- vibe-2-aperitivo-hour-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |

---

## Vibe 3: No Menu Needed

### Files
- vibe-3-no-menu-needed-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |

---

## Vibe 4: Rooftop Ritual

### Files
- vibe-4-rooftop-ritual-landing.html ✓

### Image Slots
| Slot | Image | Status |
|------|-------|--------|
| hero | hero.jpg | ✓ |

---

## Hot-Swap Log

| Time | Vibe | Slot | Old | New |
|------|------|------|-----|-----|
| (no swaps yet - all images placed on initial build) |

---

## Brief Update Log

| Time | Change | Affected Vibes | Action |
|------|--------|----------------|--------|
| (no updates yet) |
`

  fs.writeFileSync(path.join(SESSION_DIR, 'BUILD.md'), buildMd)
  console.log('✓ Created BUILD.md')

  // Create CREATIVE-BRIEF.md with all CD copy
  const creativeBriefMd = `# Creative Brief: Aperol Bar Ready

## Business Identity

**Name:** ${DISCOVERY.businessName}
**One-Sentence:** ${DISCOVERY.oneSentence}
**Location:** ${DISCOVERY.location}
**Hours:** ${DISCOVERY.hours}

**Target Customer:** ${DISCOVERY.specificPerson}

**NOT For:** ${DISCOVERY.notFor}

**Enemy:** ${DISCOVERY.enemy}

**Voice:** ${DISCOVERY.attitude}

---

## Vibes Developed

### Vibe 1: ${VIBE_1_COPY.name}
**One-liner:** ${VIBE_1_COPY.oneLiner}
**Voice:** ${VIBE_1_COPY.voice}
**Who it's for:** ${VIBE_1_COPY.whoItsFor}
**Colors:** Primary ${VIBE_1_COPY.colors.primary}, Secondary ${VIBE_1_COPY.colors.secondary}
**Fonts:** ${VIBE_1_COPY.fonts.headline} / ${VIBE_1_COPY.fonts.body}

### Vibe 2: ${VIBE_2_COPY.name}
**One-liner:** ${VIBE_2_COPY.oneLiner}
**Voice:** ${VIBE_2_COPY.voice}
**Who it's for:** ${VIBE_2_COPY.whoItsFor}
**Colors:** Primary ${VIBE_2_COPY.colors.primary}, Secondary ${VIBE_2_COPY.colors.secondary}
**Fonts:** ${VIBE_2_COPY.fonts.headline} / ${VIBE_2_COPY.fonts.body}

### Vibe 3: ${VIBE_3_COPY.name}
**One-liner:** ${VIBE_3_COPY.oneLiner}
**Voice:** ${VIBE_3_COPY.voice}
**Who it's for:** ${VIBE_3_COPY.whoItsFor}
**Colors:** Primary ${VIBE_3_COPY.colors.primary}, Secondary ${VIBE_3_COPY.colors.secondary}
**Fonts:** ${VIBE_3_COPY.fonts.headline} / ${VIBE_3_COPY.fonts.body}

### Vibe 4: ${VIBE_4_COPY.name}
**One-liner:** ${VIBE_4_COPY.oneLiner}
**Voice:** ${VIBE_4_COPY.voice}
**Who it's for:** ${VIBE_4_COPY.whoItsFor}
**Colors:** Primary ${VIBE_4_COPY.colors.primary}, Secondary ${VIBE_4_COPY.colors.secondary}
**Fonts:** ${VIBE_4_COPY.fonts.headline} / ${VIBE_4_COPY.fonts.body}

---

## Complete Copy (Vibe 1: ${VIBE_1_COPY.name})

### Hero
- **Tagline:** ${VIBE_1_COPY.hero.tagline}
- **Headline:** ${VIBE_1_COPY.hero.headline}
- **Subtitle:** ${VIBE_1_COPY.hero.subtitle}

### Hook
- **Headline:** ${VIBE_1_COPY.hook.headline}
- **Body:** ${VIBE_1_COPY.hook.body}

### Menu
- **Section Label:** ${VIBE_1_COPY.menu.sectionLabel}
- **Title:** ${VIBE_1_COPY.menu.sectionTitle}
- **Intro:** ${VIBE_1_COPY.menu.intro}

${VIBE_1_COPY.menu.categories.map(cat => `
#### ${cat.name}
${cat.items.map(item => `| ${item.name} | ${item.description} | ${item.price} |`).join('\n')}`).join('\n')}

### Location
- **Section Label:** ${VIBE_1_COPY.location.sectionLabel}
- **Title:** ${VIBE_1_COPY.location.sectionTitle}
- **Intro:** ${VIBE_1_COPY.location.intro}

### Booking CTA
- **Section Label:** ${VIBE_1_COPY.booking.sectionLabel}
- **Headline:** ${VIBE_1_COPY.booking.headline}
- **Body:** ${VIBE_1_COPY.booking.body}
- **Button:** ${VIBE_1_COPY.booking.button}

### Footer
- **Tagline:** ${VIBE_1_COPY.footer.tagline}

---

(Complete copy for Vibes 2-4 follows same structure - see vibe HTML files for full implementation)
`

  fs.writeFileSync(path.join(SESSION_DIR, 'CREATIVE-BRIEF.md'), creativeBriefMd)
  console.log('✓ Created CREATIVE-BRIEF.md')

  // Build all 4 vibe HTML files
  const vibes = [
    { num: 1, copy: VIBE_1_COPY },
    { num: 2, copy: VIBE_2_COPY },
    { num: 3, copy: VIBE_3_COPY },
    { num: 4, copy: VIBE_4_COPY },
  ]

  for (const vibe of vibes) {
    const safeName = vibe.copy.name.toLowerCase().replace(/\s+/g, '-')
    const filename = `vibe-${vibe.num}-${safeName}-landing.html`
    const html = buildVibeHtml(vibe.num, vibe.copy)
    fs.writeFileSync(path.join(SESSION_DIR, filename), html)
    console.log(`✓ Created ${filename}`)
  }

  console.log('\n========================================')
  console.log('E2E Test Complete: Aperol Bar Ready')
  console.log('========================================')
  console.log(`Session folder: ${SESSION_DIR}`)
  console.log('\nVibes created:')
  vibes.forEach(v => {
    console.log(`  ${v.num}. ${v.copy.name}: "${v.copy.oneLiner}"`)
  })
  console.log('\nOpen in browser:')
  console.log(`  http://localhost:3000/${SESSION_ID}/vibe-1-spritz-season-landing.html`)
  console.log(`  http://localhost:3000/${SESSION_ID}/vibe-2-aperitivo-hour-landing.html`)
  console.log(`  http://localhost:3000/${SESSION_ID}/vibe-3-no-menu-needed-landing.html`)
  console.log(`  http://localhost:3000/${SESSION_ID}/vibe-4-rooftop-ritual-landing.html`)
}

// Run the test
createSession()
