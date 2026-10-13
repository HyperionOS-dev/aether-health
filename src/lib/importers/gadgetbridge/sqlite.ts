// Reading a Gadgetbridge export into tables, whichever shape it arrives in.
//
// Gadgetbridge hands its data out two ways: a zip of one CSV per table, or the SQLite
// database itself. Both carry the same tables, so both end up as the same map of CSV text
// that the day and workout readers already consume. That keeps one definition of what a
// table looks like, and lets the database path borrow the zip path's reader untouched.
//
// The database is opened by sql.js, SQLite compiled to WebAssembly, so it stays in the
// browser. The loader is injected rather than imported: this module keeps no dependency on
// a bundler-resolved wasm asset, which is what lets it run under plain node --test.

import { readZip, readZipEntryBytes, MAX_ZIP_EXPANDED_BYTES, type ZipEntry } from "./tables.ts";

const SQLITE_MAGIC = "SQLite format 3\0";

// A file gets renamed between a phone and a laptop, so the shape is read from the bytes:
// SQLite stamps its own name into the first sixteen bytes of every database it writes.
export function isSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export type GadgetbridgeShape = "database" | "zip";

// Null means neither shape, which is a single loose table file the caller reads itself.
export function detectGadgetbridgeSource(bytes: Uint8Array): GadgetbridgeShape | null {
  if (isSqlite(bytes)) return "database";
  return isZip(bytes) ? "zip" : null;
}

// Only the corner of sql.js this module touches: the exec that answers a query and the
// close that releases the WebAssembly heap.
export type SqlTable = { columns: string[]; values: unknown[][] };
type SqlDatabase = { exec: (sql: string) => SqlTable[]; close: () => void };
export type SqlModule = { Database: new (data: Uint8Array) => SqlDatabase };
export type LoadSql = (config: { locateFile: (file: string) => string }) => Promise<SqlModule>;

let loaded: Promise<SqlModule> | null = null;

// One WebAssembly instance per page — a second copy only makes the import slower. A failed
// load is not cached, so retrying after a hiccup can still succeed.
export function loadSql(load: LoadSql, wasmUrl: string): Promise<SqlModule> {
  if (!loaded) {
    loaded = load({ locateFile: () => wasmUrl }).catch((error) => {
      loaded = null;
      throw error;
    });
  }
  return loaded;
}

// One value as the CSV cell the table readers expect. The table-file export writes a blob
// as its decimal bytes, a NULL as an empty cell and a boolean as 1/0, so the database
// reader does the same and the two shapes stay interchangeable downstream.
export function csvCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Uint8Array) return Array.from(value).join(",");
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

// RFC 4180: a cell is quoted only when it has to be, and a quote inside a quoted cell is
// doubled. Quoting unconditionally would also read back correctly but would inflate every
// timestamp cell of a multi-megabyte export.
function csvRow(cells: string[]): string {
  return cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",");
}

export function tableToCsv(table: SqlTable): string {
  const lines = [csvRow(table.columns), ...table.values.map((row) => csvRow(row.map(csvCell)))];
  return lines.join("\n") + "\n";
}

const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

// Every table that holds rows, rendered to CSV. An empty table is left out so the caller
// sees exactly the tables the export carries, the way a zip only holds the files it holds.
// Gadgetbridge's per-table CSVs are named in upper case, so the key is uppercased here too
// and tableOf()'s prefix match behaves the same on both shapes.
export function dbToTables(db: SqlDatabase): Record<string, string> {
  const listing = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const out: Record<string, string> = {};
  for (const row of listing[0]?.values ?? []) {
    const name = String(row[0] ?? "");
    // SQLite's own bookkeeping tables are not part of the export.
    if (!name || name.startsWith("sqlite_")) continue;
    const table = db.exec(`SELECT * FROM ${quoteIdentifier(name)}`)[0];
    if (!table || !table.values.length) continue;
    out[name.toUpperCase()] = tableToCsv(table);
  }
  return out;
}

async function tablesFromDatabase(bytes: Uint8Array, load: LoadSql, wasmUrl: string): Promise<Record<string, string>> {
  const SQL = await loadSql(load, wasmUrl);
  const db = new SQL.Database(bytes);
  try {
    return dbToTables(db);
  } finally {
    db.close();
  }
}

export type ReadTablesOptions = {
  /** sql.js's own loader, passed in so this module never pulls a bundler asset into its graph. */
  load: LoadSql;
  /** Where the sql.js WebAssembly binary is served from. */
  wasmUrl: string;
  maxExpandedBytes?: number;
};

export type GadgetbridgeTables = {
  tables: Record<string, string>;
  expandedBytes: number;
  /** Which shape the tables came from — a plain zip, or a database read out of one. */
  shape: GadgetbridgeShape;
};

// An archive ships the database as the whole point of the export, and names the file after
// the database — with the extension when it was zipped on a computer, without it when
// Gadgetbridge wrote the archive itself. Either spelling wins over the table-file layout.
function isDatabaseEntry(entry: ZipEntry): boolean {
  const name = (entry.name.split("/").pop() || "").toLowerCase();
  return name === "gadgetbridge" || name.endsWith(".db");
}

export async function readTables(bytes: Uint8Array, options: ReadTablesOptions): Promise<GadgetbridgeTables> {
  const { load, wasmUrl, maxExpandedBytes = MAX_ZIP_EXPANDED_BYTES } = options;
  const shape = detectGadgetbridgeSource(bytes);
  if (shape === "database") {
    return { tables: await tablesFromDatabase(bytes, load, wasmUrl), expandedBytes: bytes.byteLength, shape };
  }
  if (shape === "zip") {
    const nested = await readZipEntryBytes(bytes, isDatabaseEntry, maxExpandedBytes);
    if (nested) {
      const tables = await tablesFromDatabase(nested, load, wasmUrl);
      return { tables, expandedBytes: nested.byteLength, shape: "database" };
    }
    const { tables, expandedBytes } = await readZip(bytes, maxExpandedBytes);
    return { tables, expandedBytes, shape };
  }
  throw new Error("That file is neither a Gadgetbridge zip nor a Gadgetbridge database");
}