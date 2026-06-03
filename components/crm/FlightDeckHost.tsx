'use client'

// ============================================================================
// FlightDeckHost — render the Consular's Flight Deck by LOADING the agent-
// editable renderer at public/__crm__/flight-deck.jsx and calling its
// window.FlightDeck.render(mount, props). flight-deck.jsx is the source of
// truth for what shapes/archetypes exist — if the agent (or Ralph) registers
// a new shape there, this host picks it up automatically. NO hardcoded shape
// set, NO whitelist, NO React port that goes stale. Same React as /crm —
// exposed via window globals so the in-app-compiled JSX shares one reconciler.
// ============================================================================

import { useEffect, useRef } from 'react'
import React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

declare global {
  interface Window {
    React?: unknown
    ReactDOM?: unknown
    Babel?: { transform: (code: string, opts: { presets: string[] }) => { code: string } }
    FlightDeck?: { render: (mount: HTMLElement | string, props: Record<string, unknown>) => void }
  }
}

const BABEL_SRC = 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js'
const FLIGHT_DECK_SRC = '/__crm__/flight-deck.jsx'
const MOUNT_ID = 'crm-flight-deck-mount'

// One-time loaders — module-level promises so React StrictMode double-mount,
// theme/deck re-renders, and parallel host instances all share one fetch.
let babelP: Promise<void> | null = null
function ensureBabel(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.Babel) return Promise.resolve()
  if (babelP) return babelP
  babelP = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = BABEL_SRC
    s.crossOrigin = 'anonymous'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Babel standalone failed to load'))
    document.head.appendChild(s)
  })
  return babelP
}

let deckP: Promise<void> | null = null
function ensureFlightDeck(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.FlightDeck) return Promise.resolve()
  if (deckP) return deckP
  deckP = (async () => {
    // Expose the app's React/ReactDOM as globals — flight-deck.jsx is written
    // for a Babel-in-browser host (live-deck.html style), which uses global
    // React.createElement + ReactDOM. Pointing those at OUR instance keeps it
    // a single reconciler (no "two Reacts" warning) and works with both the
    // legacy `ReactDOM.render` and the React-18 `ReactDOM.createRoot`.
    window.React = React
    window.ReactDOM = { ...ReactDOM, createRoot: ReactDOMClient.createRoot }
    await ensureBabel()
    const src = await fetch(FLIGHT_DECK_SRC, { cache: 'no-store' }).then((r) => r.text())
    const out = window.Babel!.transform(src, { presets: ['react'] }).code
    // The compiled IIFE registers window.FlightDeck. Eval inside a Function so
    // it doesn't leak local module bindings.
    new Function(out)()
  })()
  return deckP
}

interface Props {
  theme: 'onyx' | 'polar'
  pushed: unknown[]
  queueCount: number
  onExecute?: (a: { leadId?: string; verb?: string; company?: string }) => void
  onOpenLead?: (id?: string) => void
  onShowQueue?: () => void
}

export function FlightDeckHost({ theme, pushed, queueCount, onExecute, onOpenLead, onShowQueue }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    ensureFlightDeck()
      .then(() => {
        if (cancelled || !ref.current || !window.FlightDeck) return
        // flight-deck.jsx's render accepts a selector OR an element; pass our
        // ref so we don't depend on a globally-unique selector.
        window.FlightDeck.render(ref.current, {
          theme,
          pushed,
          queueCount,
          onExecute,
          onOpenLead,
          onShowQueue,
        })
      })
      .catch((e) => console.error('[FlightDeckHost] load/render failed:', e))
    return () => { cancelled = true }
  }, [theme, pushed, queueCount, onExecute, onOpenLead, onShowQueue])
  return <div id={MOUNT_ID} ref={ref} />
}
