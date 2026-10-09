// Sport labels for the dump's workout TYPE codes.
//
// A lookup table, not a switch: a type this app has never seen resolves to a generic
// label instead of crashing, rendering blank, or putting a raw number in front of the
// user. Codes are added here as exports are cross-referenced against known sessions —
// never inferred from which rows happen to carry which columns.
//
// Confirmed against real export data:
//   2    Walking            1.7-3.9 km/h, near-zero load
//   1    Outdoor running    short ad-hoc bursts under 5 min, variable pace
//   5    Indoor running     treadmill; higher load and aerobic/anaerobic effect
//   -127 Badminton          no distance or step count, real heart rate and effect data

const UNKNOWN = "Workout";

const TYPES: Record<string, string> = {
  "2": "Walking",
  "1": "Outdoor running",
  "5": "Indoor running",
  "-127": "Badminton",
};

export function activityLabel(type: number | null): string {
  if (type == null) return UNKNOWN;
  return TYPES[String(Math.trunc(type))] || UNKNOWN;
}

// Where a session happened comes from data, not from the sport: a type mapping says
// what the sport was, the GPS file location says whether the watch recorded a track.
// They disagree often enough — a type 1 run with no GPS fix is still outdoors — that
// anything location-dependent (route maps, trusting GPS distance) reads this instead.
export function isOutdoor(row: { gpx: string | null; rawGps: string | null }): boolean {
  return Boolean((row.gpx && row.gpx.trim()) || (row.rawGps && row.rawGps.trim()));
}