// ============================================================================
// lib/sqlite.ts — synchronous SQLite for OskarOS, backed by Node's built-in
// `node:sqlite` (stable, no flag, on Node 24).
//
// Replaces the native `better-sqlite3` addon. better-sqlite3 is a compiled
// binary and can't be built or run on our el8 production host: its published
// prebuilt needs glibc 2.29 (server has 2.28), and it can't be compiled there
// either (gcc 8.5 is too old for Node 24's C++20 V8 headers, and no newer gcc
// is installable without root). `node:sqlite` ships inside Node itself, so
// there is no native module to compile or carry per-platform — ever.
//
// This exposes exactly the better-sqlite3 surface OskarOS uses:
//   new Database(path[, opts]); db.prepare / exec / pragma / transaction /
//   function / close ; stmt.run / get / all / iterate
// supporting both positional `?` params and bare-key `@named` params.
//
// The default export is the `Database` class, so callers keep
// `import Database from './sqlite'` and annotate handles as `Database`.
// ============================================================================

import type { DatabaseSync as DatabaseSyncT, StatementSync } from 'node:sqlite'

// `node:sqlite` is a Node builtin. A normal `import … from 'node:sqlite'` makes
// Turbopack treat it as an external and emit `require("node:sqlite")` inside an
// ESM chunk — where `require` is undefined. That throws at module-eval time
// ("Failed to load external module node:sqlite: ReferenceError: require is not
// defined") and 500s every CRM route through lib/crm-boot. `process.getBuiltinModule`
// (Node ≥22.3) returns the builtin directly at runtime, with zero bundler
// involvement — the string is a plain argument, never a module reference.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')

type Params = unknown[]

/** A single plain object means named parameters; anything else is positional. */
function normalize(args: Params): Params {
  if (args.length === 1 && args[0] != null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return [args[0]]
  }
  return args
}

export class Statement {
  private readonly _stmt: StatementSync
  readonly source: string

  constructor(stmt: StatementSync, sql: string) {
    this._stmt = stmt
    this.source = sql
    // better-sqlite3 binds `{ name: v }` to `@name` (bare key); node:sqlite
    // requires opting in. Unknown-key tolerance keeps a stray field from
    // throwing — OskarOS passes exact-match objects, so this never fires.
    try { stmt.setAllowBareNamedParameters(true) } catch { /* older node */ }
    try { stmt.setAllowUnknownNamedParameters(true) } catch { /* older node */ }
  }

  // Returns are `unknown` so callers cast freely, matching better-sqlite3's
  // ergonomics (node:sqlite types `.all()` as Record<string, …>[], which won't
  // accept the codebase's `as SomeRow[]` casts directly).
  run(...args: Params) { return this._stmt.run(...(normalize(args) as never[])) }
  get(...args: Params): unknown { return this._stmt.get(...(normalize(args) as never[])) }
  all(...args: Params): unknown[] { return this._stmt.all(...(normalize(args) as never[])) }
  iterate(...args: Params) { return this._stmt.iterate(...(normalize(args) as never[])) }
  pluck() { return this } // unused by OskarOS; present for surface-compat
  raw() { return this }

  /** better-sqlite3 flag: true when the statement returns rows (SELECT / WITH / PRAGMA). */
  get reader(): boolean {
    try { return this._stmt.columns().length > 0 } catch { return false }
  }
}

export default class Database {
  private readonly _db: DatabaseSyncT
  private _txDepth = 0
  readonly name: string
  open = true

  constructor(path: string, opts?: { readonly?: boolean }) {
    // node:sqlite rejects `undefined` for options — always pass an object.
    this._db = new DatabaseSync(path, opts?.readonly ? { readOnly: true } : {})
    this.name = path
  }

  prepare(sql: string): Statement {
    return new Statement(this._db.prepare(sql), sql)
  }

  exec(sql: string): this {
    this._db.exec(sql)
    return this
  }

  /** better-sqlite3 returns rows for read-pragmas; OskarOS only sets WAL / FK. */
  pragma(source: string): unknown {
    try { return this._db.prepare(`PRAGMA ${source}`).all() }
    catch { this._db.exec(`PRAGMA ${source}`); return [] }
  }

  /** Returns a function that runs `fn` inside a transaction (nestable via savepoints). */
  transaction<F extends (...args: never[]) => unknown>(fn: F): F {
    const self = this
    const wrapped = function (this: unknown, ...args: never[]): unknown {
      const sp = `_sp${self._txDepth}`
      self._db.exec(self._txDepth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`)
      self._txDepth++
      try {
        const r = fn.apply(this, args)
        self._txDepth--
        self._db.exec(self._txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
        return r
      } catch (e) {
        self._txDepth--
        try { self._db.exec(self._txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`) } catch { /* ignore */ }
        throw e
      }
    } as unknown as F & { deferred: F; immediate: F; exclusive: F }
    wrapped.deferred = wrapped
    wrapped.immediate = wrapped
    wrapped.exclusive = wrapped
    return wrapped
  }

  function(name: string, fn: (...args: never[]) => unknown): this {
    try {
      ;(this._db as unknown as { function: (n: string, f: unknown) => void }).function(name, fn)
    } catch { /* custom functions unused / unsupported */ }
    return this
  }

  get inTransaction(): boolean { return this._txDepth > 0 }

  close(): this {
    try { this._db.close() } catch { /* already closed */ }
    this.open = false
    return this
  }
}
