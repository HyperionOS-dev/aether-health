export const SHOW_RECOVERY_DETAILS = false;

// BRS version label. Display only: it must never feed a score, and it is not the stored
// `algorithmVersion` stamp below, which stays put so existing records are not re-scored.
export const BRS_VERSION = "1.2";

export const SCORING_CONFIG = Object.freeze({
  algorithmVersion: "aether-scores-v6",
  strain: {
    maxHr: 190,
    zoneEdges: [0.25, 0.45, 0.6, 0.75, 0.88],
    zoneMultipliers: [0.4, 1, 1.8, 2.8, 4],
    loadDivisor: 120,
    defaultRhr: 62,
  },
  recoveryV5: {
    baselineWindow: 30,
    shrinkageK: 10,
    defaultHrv: 45,
    defaultRhr: 62,
    hrvPriorSdFraction: 0.2,
    rhrPriorSd: 4,
    minRhrSd: 2.5,
    minHrvSamples: 15,
    minRhrSamples: 30,
    minRhr: 30,
    maxRhr: 120,
    minHrv: 5,
    maxHrv: 300,
    zLimit: 3,
    weights: { hrv: 0.5, rhr: 0.3, sleep: 0.2 },
    sleepNeutral: 85,
    sleepRange: 15,
  },
  recoveryV6: {
    fallbackMinutesPerLoadPoint: 20,
    debtPointsPerHour: 3.5,
    maxDebtPerWorkout: 70,
    maxWorkoutDebt: 85,
    physioPenaltyPerNegativeZ: 15,
    maxPhysioPenalty: 40,
    physioDecayHours: 16,
    recoveryMin: 1,
    recoveryMax: 100,
    fullyRecoveredAt: 98,
    simulationMaxHours: 72,
    simulationStepHours: 1,
    snapshotHour: 8,
    personalWindowDays: 60,
    personalSpeedDefault: 1,
    personalSpeedMin: 0.7,
    personalSpeedMax: 1.5,
    personalSpeedImpact: 0.25,
    personalSpeedShrinkN: 10,
    personalSpeedMinWorkoutDays: 5,
    personalizedAtWorkoutDays: 10,
    stillAccruingMinutes: 30,
    greenAt: 85,
    yellowAt: 60,
    ratingMin: 1,
    ratingMax: 5,
    correlationMinRatings: 14,
  },
  sleep: {
    consistencyK: 0.25,
    consistencyNights: 7,
    // untuned guess: shorter sleep is treated as a nap, not a night
    minNightMinutes: 180,
    // Minutes of sleep need one nap minute pays down. WHOOP describes need as
    // baseline + strain + sleep debt - naps but does not publish the exchange rate, so
    // 1:1 is a named, untuned guess.
    napNeedCredit: 1.0, // untuned guess
    // The adjusted need never falls below this share of the unadjusted need.
    napNeedFloor: 0.5,
  },
});
