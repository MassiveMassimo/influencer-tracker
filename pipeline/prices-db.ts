import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config";
import type { OhlcBar } from "../src/lib/types";

const DB_PATH = join(ROOT, "data", "prices.db");

let _db: Database | null = null;

function db(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { create: true });
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS prices (
      symbol TEXT NOT NULL,
      date   TEXT NOT NULL,
      o      REAL,
      h      REAL,
      l      REAL,
      c      REAL,
      PRIMARY KEY (symbol, date)
    )
  `);
  return _db;
}

// Read all bars for a symbol, sorted ascending by date. Returns [] if none.
export function readPricesDb(symbol: string): OhlcBar[] {
  const rows = db()
    .query("SELECT date, o, h, l, c FROM prices WHERE symbol = ? ORDER BY date ASC")
    .all(symbol) as { date: string; o: number; h: number; l: number; c: number }[];
  return rows as unknown as OhlcBar[];
}

// Insert bars for a symbol — insert-only (existing rows are never overwritten,
// matching mergePrices existing-wins semantics and the DB onConflictDoNothing).
// Returns the count of genuinely-new rows inserted.
export function writePricesDb(symbol: string, bars: OhlcBar[]): number {
  if (!bars.length) return 0;
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO prices (symbol, date, o, h, l, c) VALUES (?, ?, ?, ?, ?, ?)",
  );
  let inserted = 0;
  for (const b of bars) {
    const r = stmt.run(symbol, b.date, b.o, b.h, b.l, b.c);
    if (r.changes > 0) inserted++;
  }
  return inserted;
}

// Merge incoming bars into the DB — equivalent to the old mergePrices(existing, incoming)
// + writeFile flow, but atomic and without loading the whole series into memory. Insert-only:
// an existing (symbol, date) row keeps its OHLC; only genuinely-new dates are appended.
// detectBasisShift is checked before merging to catch stock-split restatements.
export function mergePricesDb(
  symbol: string,
  incoming: OhlcBar[],
  onShift?: (factor: number) => void,
): void {
  if (!incoming.length) return;
  const existing = readPricesDb(symbol);
  if (existing.length >= 2) {
    // Inline basis-shift check — same logic as detectBasisShift in prices-merge.ts.
    const inc = new Map(incoming.map((b) => [b.date, b.c]));
    const ratios: number[] = [];
    for (const b of existing) {
      const c = inc.get(b.date);
      if (c != null && b.c !== 0) ratios.push(c / b.c);
    }
    if (ratios.length >= 2) {
      const avg = ratios.reduce((s, r) => s + r, 0) / ratios.length;
      if (Math.abs(avg - 1) >= 0.01 && ratios.every((r) => Math.abs(r - avg) <= 0.02 * avg)) {
        onShift?.(avg);
        return;
      }
    }
  }
  writePricesDb(symbol, incoming);
}

// List all symbols in the DB. Used by prebuild to emit public/prices/*.json.
export function listSymbolsDb(): string[] {
  return db()
    .query("SELECT DISTINCT symbol FROM prices ORDER BY symbol ASC")
    .all()
    .map((r) => (r as { symbol: string }).symbol);
}

// Close the DB handle (only needed in long-lived processes; the CLI exits after use).
export function closePricesDb(): void {
  _db?.close();
  _db = null;
}

// Check if the DB file exists (for migration logic / fallback).
export function pricesDbExists(): boolean {
  return existsSync(DB_PATH);
}
