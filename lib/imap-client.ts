// ============================================================================
// lib/imap-client.ts — EINE Stelle für die IMAP-Client-Erzeugung.
//
// Grund (2026-08-11): Der Namecheap-Shared-Host blockt ausgehend Port 993
// (implizites IMAPS), lässt aber 143 (STARTTLS) durch → der Hub läuft mit
// OSKAR_MAIL_IMAP_PORT=143, der Mac bleibt auf 993.
//
// privateemail.com auf 143 weist JEDES Kommando vor STARTTLS mit
// «Must issue a STARTTLS command first» (BAD) ab. imapflows Standard-
// startSession() schickt aber zuerst CAPABILITY + ID → BAD → Socket-Timeout.
// StarttlsFirstImapFlow zieht das TLS-Upgrade auf die ERSTE Aktion vor;
// super.startSession() ruft upgradeToSTARTTLS() danach nur noch als No-op
// (Guard `if (this.secureConnection) return true`) auf. Zertifikat wird
// weiterhin gegen den Hostnamen validiert. Auf 993 (secure:true) ist die
// Unterklasse nie im Spiel — dort gilt der normale Ablauf.
//
// VERIFIZIERT 2026-08-11 gegen mail.privateemail.com:143:
//   «LOGIN OK als FT@paradiso.dev nach 1891 ms».
// ============================================================================

import { ImapFlow, type ImapFlowOptions } from 'imapflow'

/** 993 = implizites TLS; 143 = STARTTLS-Upgrade. */
export const imapSecure = (port: number): boolean => port !== 143

// imapflows d.ts deklariert startSession/upgradeToSTARTTLS nicht öffentlich —
// beides sind reale Instanzmethoden (verifiziert am Wire). Wir überschreiben
// via Prototyp statt via `extends`, damit TypeScript die untypisierten
// Methoden nicht als Fehler wertet, und behalten das Original für den super-Call.
const StarttlsFirstImapFlow = class extends ImapFlow {} as unknown as {
  new (opts: ImapFlowOptions): ImapFlow
}
;(StarttlsFirstImapFlow.prototype as unknown as Record<string, unknown>).startSession =
  async function (this: { close(): void } & Record<string, () => Promise<unknown>>) {
    // TLS ZUERST — vor CAPABILITY/ID, die der Proxy sonst als BAD abweist.
    // Fail CLOSED: stirbt der Socket im Upgrade-Fenster (NoConnection-Flut
    // vom 2026-08-12), wird der Client abgerissen und der Fehler läuft über
    // beginSessions .catch in die normale connect()-Rejection — nie als
    // nackte Promise in den gemeinsamen Prozess.
    try {
      await this.upgradeToSTARTTLS()
    } catch (err) {
      this.close()
      throw err
    }
    return (ImapFlow.prototype as unknown as Record<string, () => Promise<unknown>>).startSession.call(this)
  }

/**
 * Baut den passenden IMAP-Client für den Port. Aufrufer übergeben ihre
 * normalen ImapFlowOptions OHNE `secure`/`doSTARTTLS` — beides wird hier aus
 * dem Port abgeleitet, damit die STARTTLS-Reihenfolge an genau einer Stelle
 * lebt (mail-eyes hat vier Verbindungsstellen, die Testroute eine).
 * `starttls` erzwingt den Pfad unabhängig vom Port (Chaos-Harness).
 */
export function makeImapClient(
  opts: Omit<ImapFlowOptions, 'secure' | 'doSTARTTLS'> & { starttls?: boolean },
): ImapFlow {
  const { starttls, ...flowOpts } = opts
  const port = flowOpts.port ?? 993
  const client = (starttls ?? !imapSecure(port))
    ? new StarttlsFirstImapFlow({ ...flowOpts, secure: false, doSTARTTLS: true })
    : new ImapFlow({ ...flowOpts, secure: true })
  // imapflow emittiert Post-Connect-Socketfehler IMMER als 'error'-Event
  // (imap-flow.js: "ALWAYS emit the error so users can handle it"). Kein
  // Aufrufer in mail-eyes subscribt — ohne Listener wird jeder abgeworfene
  // Server-Socket zum unhandled 'error' im Prozess, der auch die
  // Consular-Bridge trägt. EIN Log-Listener pro Client, an EINER Stelle.
  client.on('error', (err: Error) => {
    console.warn(`[imap-client] connection error (handled): ${err.message}`)
  })
  return client
}
