import { buildDays } from "@/lib/importers/gadgetbridge/days";
import { readZip, singleTable } from "@/lib/importers/gadgetbridge/tables";
import { buildWorkouts, sessionSpans } from "@/lib/importers/gadgetbridge/workouts";
import {
  finalizeDay,
  finalizeHealthDetailDay,
  mergeHuaweiDays,
  parseHealthDetailRecords,
  parseMetricsCsv,
  parseHuaweiMotionPathRecords,
  sessionWindows,
} from "@/lib/importers/huawei/parse";
import { entities } from "@/lib/firebase/entities";
import { recomputeScores } from "@/lib/scoring/recompute";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;
const MAX_HUAWEI_FILES = 60;
const MAX_GADGETBRIDGE_FILES = 4;
const MAX_FILE_BYTES = 120_000_000;

const clean = (record) => Object.fromEntries(
  Object.entries(record).filter(([key, value]) => !key.startsWith("_") && value !== null && value !== undefined && value !== "")
);

function validateFiles(files) {
  for (const file of files) {
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is empty or larger than 120 MB`);
  }
}

async function saveImport({ label, days, workouts, message, extraLog = {} }) {
  const existingDays = await entities.DailyMetric.filter({}, "-date", 2000);
  const knownDays = new Map(existingDays.map((day) => [day.date, day]));
  const createDays = [];
  const updateDays = [];
  for (const day of days) {
    if (!DATE.test(String(day.date))) continue;
    const data = clean(day);
    const previous = knownDays.get(day.date);
    if (previous) {
      updateDays.push({ id: previous.id, ...data, ...(data.sources ? { sources: { ...previous.sources, ...data.sources } } : {}) });
    } else {
      createDays.push(data);
    }
  }

  const existingWorkouts = await entities.Workout.filter({}, "-date", 2000);
  const workoutKey = (workout) => `${workout.date}|${workout.start_time || ""}|${String(workout.activity || "").toLowerCase()}`;
  const seenWorkouts = new Set(existingWorkouts.map(workoutKey));
  const createWorkouts = [];
  for (const workout of workouts) {
    if (!DATE.test(String(workout.date)) || !workout.activity || seenWorkouts.has(workoutKey(workout))) continue;
    seenWorkouts.add(workoutKey(workout));
    createWorkouts.push(clean(workout));
  }

  if (createDays.length) await entities.DailyMetric.bulkCreate(createDays);
  if (updateDays.length) await entities.DailyMetric.bulkUpdate(updateDays);
  if (createWorkouts.length) await entities.Workout.bulkCreate(createWorkouts);
  const touchedDates = [...days.map((day) => day.date), ...workouts.map((workout) => workout.date)]
    .filter((date) => DATE.test(String(date)));
  await recomputeScores({ entities }, touchedDates);
  await entities.ImportLog.create({
    file_name: label,
    status: "success",
    days_count: createDays.length + updateDays.length,
    workouts_count: createWorkouts.length,
    message,
    ...extraLog,
  });
  return { days: createDays.length + updateDays.length, workouts: createWorkouts.length, updated: updateDays.length };
}

async function readHuaweiFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".json")) {
    const parsed = JSON.parse(await file.text());
    if (Array.isArray(parsed)) {
      const detailData = parseHealthDetailRecords(parsed);
      if (detailData) return detailData;
      const workouts = parseHuaweiMotionPathRecords(parsed);
      if (workouts) return { days: [], workouts };
      return { days: [], workouts: [] };
    }
    if (parsed && Array.isArray(parsed.days)) {
      return { days: parsed.days, workouts: Array.isArray(parsed.workouts) ? parsed.workouts : [] };
    }
    return { days: [], workouts: [] };
  }
  if (lowerName.endsWith(".zip")) {
    const tables = await readZip(new Uint8Array(await file.arrayBuffer()));
    const days = [];
    const workouts = [];
    for (const content of Object.values(tables)) {
      const trimmed = content.trimStart();
      if (trimmed.startsWith("[")) {
        const records = JSON.parse(content);
        const detail = parseHealthDetailRecords(records);
        const motion = parseHuaweiMotionPathRecords(records);
        if (detail) days.push(...detail.days);
        if (motion) workouts.push(...motion);
      } else if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.days)) days.push(...parsed.days);
        if (Array.isArray(parsed.workouts)) workouts.push(...parsed.workouts);
      } else {
        const parsed = parseMetricsCsv(content);
        if (parsed) { days.push(...parsed.days); workouts.push(...parsed.workouts); }
      }
    }
    return { days, workouts };
  }
  if (!lowerName.endsWith(".csv")) throw new Error(`${file.name}: upload CSV, JSON, or ZIP files`);
  return parseMetricsCsv(await file.text()) || { days: [], workouts: [] };
}

export async function importHuaweiFiles(files) {
  if (!files.length || files.length > MAX_HUAWEI_FILES) throw new Error(`Choose between 1 and ${MAX_HUAWEI_FILES} files at a time`);
  validateFiles(files);
  const byDate = new Map();
  const rawWorkouts = [];
  const perFile = [];
  for (const file of files) {
    const parsed = await readHuaweiFile(file);
    let accepted = 0;
    for (const day of parsed.days || []) {
      if (!day || !DATE.test(String(day.date))) continue;
      accepted++;
      const previous = byDate.get(day.date);
      byDate.set(day.date, previous ? mergeHuaweiDays(previous, day) : day);
    }
    rawWorkouts.push(...(parsed.workouts || []));
    perFile.push({ name: file.name, days: accepted, workouts: (parsed.workouts || []).length });
  }
  const spans = sessionWindows(rawWorkouts);
  const incoming = [...byDate.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-MAX_DAYS)
    .map(finalizeHealthDetailDay)
    .map((day) => finalizeDay(day, spans.get(day.date) || []))
    .filter(Boolean);
  if (!incoming.length && !rawWorkouts.length) throw new Error("No supported health records were found in these Huawei files.");
  const result = await saveImport({
    label: files.map((file) => file.name).join(", ").slice(0, 120),
    days: incoming,
    workouts: rawWorkouts,
    message: "Imported from Huawei Health",
  });
  return { ...result, files: perFile };
}

export async function importGadgetbridgeFiles(files, timezone, offsetMinutes) {
  if (files.length > MAX_GADGETBRIDGE_FILES) throw new Error(`Choose no more than ${MAX_GADGETBRIDGE_FILES} files at a time`);
  if (!files.length) throw new Error("Choose at least one export file");
  validateFiles(files);
  const tables = {};
  const perFile = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const found = zipped ? await readZip(bytes) : singleTable(file.name, new TextDecoder().decode(bytes));
    Object.assign(tables, found);
    perFile.push({ name: file.name, tables: Object.keys(found).length });
  }
  const spans = sessionSpans(tables, timezone, offsetMinutes);
  const days = buildDays(tables, timezone, offsetMinutes, spans).slice(-MAX_DAYS);
  const restingByDate = Object.fromEntries(days.filter((day) => day.resting_hr != null).map((day) => [day.date, day.resting_hr]));
  const built = buildWorkouts(tables, timezone, offsetMinutes, restingByDate);
  if (!days.length && !built.records.length) throw new Error("No readable Gadgetbridge tables were found in these files");
  const cross = built.crossCheck ? ` · zone load vs device load ${built.crossCheck.medianRatio}x over ${built.crossCheck.pairs} sessions` : "";
  const result = await saveImport({
    label: files.map((file) => file.name).join(", ").slice(0, 120),
    days,
    workouts: built.records,
    message: `${timezone} · ${days.length} days, ${built.records.length} workouts${cross}`.slice(0, 200),
    extraLog: { timezone, cross_check: built.crossCheck || null },
  });
  return { ...result, files: perFile, crossCheck: built.crossCheck };
}