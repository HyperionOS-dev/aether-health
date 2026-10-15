// Decides which importer a dropped file belongs to, so one picker can take both exports.
//
// Certain from the bytes: a SQLite database and a FIT activity. Certain from the name: any
// file with "gadgetbridge" in it, a .db, or a .fit. A zip is decided from its entry names,
// read from the central directory without decompressing anything: Gadgetbridge tables are
// upper-case (HUAWEI_ACTIVITY_SAMPLE.csv) or a nested .db. A CSV uses the same upper-case
// rule on its name. The UI shows the guess and lets the user switch it.

export const HUAWEI = "huawei";
export const GADGETBRIDGE = "gadgetbridge";

const SQLITE_MAGIC = "SQLite format 3\0";
const HEAD_BYTES = 16;

export const HEAD_LENGTH = HEAD_BYTES;

function startsWithText(head, text) {
  if (head.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (head[i] !== text.charCodeAt(i)) return false;
  return true;
}

// The FIT signature ".FIT" sits at bytes 8 to 11 of every FIT file.
function isFitHead(head) {
  return head.length >= 12 && head[8] === 0x2e && head[9] === 0x46 && head[10] === 0x49 && head[11] === 0x54;
}

// The file name without its folders and extension.
function baseName(name) {
  return String(name || "").split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
}

// A name made only of capitals, digits and underscores, with at least one capital: a table name.
const isUpperTableName = (base) => /[A-Z]/.test(base) && base === base.toUpperCase();

// One zip entry is Gadgetbridge when it is a nested database or a Gadgetbridge table name.
function isGadgetbridgeEntry(entryName) {
  const lower = String(entryName).toLowerCase();
  if (lower.endsWith(".db") || lower.endsWith(".sqlite")) return true;
  return isUpperTableName(baseName(entryName));
}

// Reads the entry names from a zip's central directory. readRange(start, end) returns the
// bytes in [start, end). Zip64 archives and damaged directories give an empty list.
export async function zipEntryNames(size, readRange) {
  const tailStart = Math.max(0, size - 65557);
  const tail = await readRange(tailStart, size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirStart = view.getUint32(eocd + 16, true);
  if (dirStart + dirSize > size) return [];
  const dir = await readRange(dirStart, dirStart + dirSize);
  const dirView = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const names = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= dir.byteLength; i++) {
    if (dirView.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dirView.getUint16(p + 28, true);
    const extraLen = dirView.getUint16(p + 30, true);
    const commentLen = dirView.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(dir.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// name: the file's name; head: its first HEAD_LENGTH bytes (may be shorter for a tiny file);
// entryNames: a zip's entry names (empty for other files).
// Returns HUAWEI, GADGETBRIDGE, or null when the file is not an export this app reads.
export function guessSource(name, head, entryNames = []) {
  if (startsWithText(head, SQLITE_MAGIC) || isFitHead(head)) return GADGETBRIDGE;
  const lower = String(name || "").toLowerCase();
  const base = baseName(name).toLowerCase();
  if (base.includes("gadgetbridge") || lower.endsWith(".db") || lower.endsWith(".fit")) return GADGETBRIDGE;
  if (lower.endsWith(".json")) return HUAWEI;
  if (lower.endsWith(".zip")) return entryNames.some(isGadgetbridgeEntry) ? GADGETBRIDGE : HUAWEI;
  if (lower.endsWith(".csv")) return isUpperTableName(baseName(name)) ? GADGETBRIDGE : HUAWEI;
  return null;
}
