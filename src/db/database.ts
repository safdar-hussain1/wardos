/// <reference types="node" />
import initSqlJs from 'sql.js'
import type { BindParams, Database as SqlJsDb, SqlJsStatic } from 'sql.js'
import schemaSql from './schema.sql?raw'

let sqlJsPromise: Promise<SqlJsStatic> | undefined

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const wasmUrl = await resolveWasmUrl()
      return initSqlJs({ locateFile: () => wasmUrl })
    })()
  }
  return sqlJsPromise
}

async function resolveWasmUrl(): Promise<string> {
  if (isBrowser()) {
    const base =
      typeof import.meta.env !== 'undefined' && import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : '/'
    return `${base}sql-wasm.wasm`
  }
  // Node/Vitest: resolve the wasm asset shipped inside sql.js itself. The
  // `/* @vite-ignore */` keeps Rollup from trying to statically resolve
  // 'node:module' when bundling the browser build.
  const { createRequire } = await import(/* @vite-ignore */ 'node:module')
  const require_ = createRequire(import.meta.url)
  return require_.resolve('sql.js/dist/sql-wasm.wasm')
}

/**
 * `Db.run`/`all`/`get` accept `unknown[]` per the interface; sql.js's own
 * types are narrower (`SqlValue[]`). Callers are expected to only pass
 * SQLite-representable values (numbers, strings, Uint8Array, null) here —
 * this cast just bridges the two type surfaces.
 */
function toBindParams(params: unknown[] | undefined): BindParams | undefined {
  return params as BindParams | undefined
}

export class Db {
  private readonly sqlDb: SqlJsDb
  private txDepth = 0

  private constructor(sqlDb: SqlJsDb) {
    this.sqlDb = sqlDb
  }

  static async fresh(): Promise<Db> {
    const SQL = await loadSqlJs()
    const sqlDb = new SQL.Database()
    const db = new Db(sqlDb)
    db.enableForeignKeys()
    db.sqlDb.run(schemaSql)
    return db
  }

  static async restore(bytes: Uint8Array): Promise<Db> {
    const SQL = await loadSqlJs()
    const sqlDb = new SQL.Database(bytes)
    const db = new Db(sqlDb)
    db.enableForeignKeys()
    return db
  }

  private enableForeignKeys(): void {
    this.sqlDb.run('PRAGMA foreign_keys = ON')
  }

  run(sql: string, params?: unknown[]): void {
    const stmt = this.sqlDb.prepare(sql)
    try {
      stmt.run(toBindParams(params))
    } finally {
      stmt.free()
    }
  }

  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
    const stmt = this.sqlDb.prepare(sql)
    try {
      if (params) stmt.bind(toBindParams(params))
      const rows: T[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
      }
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined {
    const rows = this.all<T>(sql, params)
    return rows[0]
  }

  lastId(): number {
    const row = this.get<{ id: number }>('SELECT last_insert_rowid() AS id')
    return row ? row.id : 0
  }

  inTransaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      throw new Error('inTransaction: nested transactions are not supported')
    }
    this.txDepth++
    this.sqlDb.run('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.sqlDb.run('COMMIT')
      return result
    } catch (err) {
      this.sqlDb.run('ROLLBACK')
      throw err
    } finally {
      this.txDepth--
    }
  }

  serialize(): Uint8Array {
    return this.sqlDb.export()
  }

  close(): void {
    this.sqlDb.close()
  }
}
