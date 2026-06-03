#!/usr/bin/env node
/**
 * Regenerates docs/crm-feature/prospects.xlsx with 19 seed leads.
 * Run: node docs/crm-feature/generate-seed.mjs
 *
 * Idempotent — overwrites the file. Seed data is Filippo's LED-services
 * sales pipeline mock. Replace with real prospects via the CRM UI once live.
 */

import { utils, writeFile } from 'xlsx'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'prospects.xlsx')

const HEADERS = [
  'id',
  'company',
  'contact_name',
  'phone',
  'email',
  'website',
  'stage',
  'status',
  'amount_chf',
  'confidence_pct',
  'next_action_date',
  'next_action_label',
  'tags',
  'starred',
  'owner',
  'notes',
  'created_at',
  'standby_plan',     // WP-CRM-A4: free-text plan when status=Standby (empty by default)
  'lost_reason',      // Captured at terminal status (Lost / Cancelled). Empty otherwise.
  'needs_analysis',   // Pre-demo analysis of customer gaps / latent needs (free-text multi-line).
  'solutions_bought', // Post-demo itemized record of what the customer ordered (free-text multi-line).
  'sub_stage',        // F8 · Free-text sub-stage within current sales stage (e.g. "contract sent", "invoiced").
]

// Today is 2026-05-22; "next_action_date" set relative to that.
const D = (offset) => {
  const d = new Date('2026-05-22T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const C = (daysAgo) => {
  const d = new Date('2026-05-22T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString()
}

const ROWS = [
  // INCOMING (5)
  ['P001', "Caffè Sant'Ambrogio", 'Marco Brunetti', '+41 76 234 56 78', 'marco@santambrogio.ch', 'santambrogio.ch', 'Incoming', 'To do', 12400, 45, D(3), '3d upcoming', 'Cold-call, Tessin', false, 'Filippo', 'Espresso bar in Lugano centro. Owner answered, said send WhatsApp first.', C(2), '', ''],
  ['P002', 'Studio Dentistico Bianchi', 'Dr. Laura Bianchi', '+41 79 345 67 89', 'info@bianchi-dental.ch', 'bianchi-dental.ch', 'Incoming', 'To do', 8200, 40, D(5), '5d upcoming', 'LinkedIn, Zürich', false, 'Filippo', 'Dental clinic, two locations. Found via LinkedIn outreach to office manager.', C(4), '', ''],
  ['P003', 'Bar Olimpia', 'Giuseppe Conti', '+41 78 456 78 90', 'giuseppe@barolimpia.ch', '', 'Incoming', 'To do', 3600, 35, D(2), '2d upcoming', 'Walk-in, Lugano', false, 'Filippo', 'Small neighborhood bar near Piazza Riforma. Walked in, took the card.', C(1), '', ''],
  ['P004', 'Garage Rossi', 'Antonio Rossi', '+41 76 567 89 01', 'a.rossi@garagerossi.ch', 'garagerossi.ch', 'Incoming', 'To do', 22100, 50, D(-1), '1d overdue', 'Referral', false, 'Filippo', 'Auto repair shop, 3 bays. Referral from Hotel Splendid manager.', C(6), '', ''],
  ['P005', 'Hotel Splendid', 'Frau Sabine Müller', '+41 79 678 90 12', 'direktion@hotelsplendid.ch', 'hotelsplendid.ch', 'Incoming', 'To do', 47800, 55, D(4), '4d upcoming', 'Trade Show, Bern', true, 'Filippo', 'Met at Swiss Hospitality Forum 2026. Interested in lobby + façade LED.', C(7), '', ''],

  // CONTACTED (5)
  ['P006', 'Pizzeria Da Mario', 'Mario Esposito', '+41 78 789 01 23', 'mario@damario.ch', '', 'Contacted', 'To do', 6400, 65, D(2), '2d upcoming', 'Cold-call', false, 'Filippo', "Owner liked the demo video on WhatsApp. Wants to talk after we send pricing.", C(8), ''],
  ['P007', 'Boutique Aurora', 'Giulia Ferrari', '+41 76 890 12 34', 'giulia@aurora-boutique.ch', 'aurora-boutique.ch', 'Contacted', 'To do', 18500, 70, D(3), '3d upcoming', 'LinkedIn, Lugano', true, 'Filippo', "Fashion boutique, wants tunable-white for window display. Budget confirmed CHF 15-20k.", C(10), '', ''],
  ['P008', 'Ristorante La Pergola', 'Carlo Bianchi', '+41 79 901 23 45', 'carlo@lapergola.ch', '', 'Contacted', 'Standby', 14200, 60, D(-1), '1d overdue', 'Referral', false, 'Filippo', "Said decision was 'next week' four weeks ago. Following up Monday.", C(35), 'Follow up Monday — if no answer by Wed, mark Lost.', ''],
  ['P009', 'Café Hofmann', 'Hans Hofmann', '+41 78 012 34 56', 'hofmann@cafe-hofmann.ch', '', 'Contacted', 'To do', 9800, 65, D(4), '4d upcoming', 'Trade Show, Zürich', false, 'Filippo', "Met at Café & Bar Expo 2026. Wants the terrace strip-light retrofit by July.", C(12), '', ''],
  ['P010', 'Hairsalon Capelli', 'Sofia Romano', '+41 76 123 45 67', 'sofia@capelli.ch', '', 'Contacted', 'To do', 5200, 55, D(2), '2d upcoming', 'Walk-in', false, 'Filippo', "Small salon, ambitious aesthetics. Wants mirror-edge lights + ceiling cove.", C(9), '', ''],

  // DEMO DONE (4)
  ['P011', 'Hotel Bellevue Lugano', 'Andrea Conti', '+41 91 234 56 78', 'a.conti@bellevue-lugano.ch', 'bellevue-lugano.ch', 'Demo done', 'To do', 32600, 75, D(2), '2d upcoming', 'Hotel, Tessin', true, 'Filippo', "Loved the heritage angle in the discovery session. CHF 30-40k budget confirmed, decision-maker engaged.", C(17), '', ''],
  ['P012', 'Restaurant Du Pont', 'Pierre Dubois', '+41 22 345 67 89', 'pierre@dupont-restaurant.ch', 'dupont-restaurant.ch', 'Demo done', 'To do', 19800, 80, D(1), '1d upcoming', 'Referral, Genève', false, 'Filippo', "Asked for a second walkthrough with the head chef. Wants kitchen-pass + dining-room dim curves.", C(14), '', ''],
  ['P013', 'Garage Schneider', 'Klaus Schneider', '+41 31 456 78 90', 'k.schneider@garage-schneider.ch', '', 'Demo done', 'To do', 28900, 70, D(4), '4d upcoming', 'LinkedIn, Bern', false, 'Filippo', "BMW-certified shop, 6 bays. Asked for spec sheet + reference customer list.", C(20), '', ''],
  ['P014', 'Atelier Bellucci', 'Marta Bellucci', '+41 91 567 89 01', 'marta@atelier-bellucci.ch', 'atelier-bellucci.ch', 'Demo done', 'To do', 11400, 75, D(3), '3d upcoming', 'Lugano', false, 'Filippo', "Designer atelier. Wants gallery-grade CRI 95+ for the showroom. Sent spec.", C(15), ''],

  // CLOSING (5)
  ['P015', 'Pizzeria Vesuvio', 'Gianni Russo', '+41 76 678 90 12', 'gianni@vesuvio.ch', '', 'Closing', 'To do', 7800, 95, D(0), 'TODAY', 'Referral', true, 'Filippo', "Contract signed verbally. Sending Mandato firmato today by HIN.", C(22), ''],
  ['P016', 'Atelier Frau Weber', 'Lisa Weber', '+41 79 789 01 23', 'lisa@weber-atelier.ch', 'weber-atelier.ch', 'Closing', 'To do', 24500, 90, D(1), '1d upcoming', 'Zürich', true, 'Filippo', "Confirmed budget. Awaiting Versicherungsbescheinigung for installation.", C(28), ''],
  ['P017', 'Bistrot Le Petit', 'François Martin', '+41 22 890 12 34', 'francois@lepetit.ch', '', 'Closing', 'To do', 13200, 95, D(1), '1d upcoming', 'Genève', false, 'Filippo', "Final price agreed. Installation slot booked for June 8.", C(25), ''],
  ['P018', 'Sportcenter Olimpia', 'Roberto Greco', '+41 91 901 23 45', 'r.greco@sportcenter-olimpia.ch', 'sportcenter-olimpia.ch', 'Closing', 'To do', 41200, 85, D(2), '2d upcoming', 'Tessin', false, 'Filippo', "Largest deal of Q2. Waiting on Stockwerkeigentümer approval for façade install.", C(30), ''],
  ['P019', 'Trattoria Da Luigi', 'Luigi Bianchi', '+41 78 012 34 56', 'luigi@daluigi.ch', '', 'Closing', 'To do', 8600, 90, D(0), 'TODAY', 'Cold-call', false, 'Filippo', "Family trattoria. Confirmed by phone this morning. Send invoice today.", C(18), ''],
]

// Convert booleans to proper bool, write
const data = [HEADERS, ...ROWS]
const ws = utils.aoa_to_sheet(data)

// Set reasonable column widths
ws['!cols'] = [
  { wch: 6 },   // id
  { wch: 26 },  // company
  { wch: 22 },  // contact_name
  { wch: 18 },  // phone
  { wch: 32 },  // email
  { wch: 24 },  // website
  { wch: 12 },  // stage
  { wch: 12 },  // status
  { wch: 12 },  // amount_chf
  { wch: 8 },   // confidence_pct
  { wch: 14 },  // next_action_date
  { wch: 16 },  // next_action_label
  { wch: 22 },  // tags
  { wch: 8 },   // starred
  { wch: 10 },  // owner
  { wch: 60 },  // notes
  { wch: 22 },  // created_at
  { wch: 40 },  // standby_plan (WP-CRM-A4)
  { wch: 30 },  // lost_reason
  { wch: 80 },  // needs_analysis  — wide so multi-line bullets read well in Excel
  { wch: 80 },  // solutions_bought
  { wch: 30 },  // sub_stage
]

const wb = utils.book_new()
utils.book_append_sheet(wb, ws, 'Prospects')

writeFile(wb, OUT)
console.log(`✓ Wrote ${OUT} (${ROWS.length} prospects)`)
