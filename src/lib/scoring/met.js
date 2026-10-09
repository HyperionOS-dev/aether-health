// MET values from the Compendium of Physical Activities.
export const METS = {
  "Walking": 3.5, "Hiking": 6.0, "Running": 9.8, "Cycling": 7.5, "Swimming": 8.0,
  "Rowing": 7.0, "Elliptical": 5.0, "Stair Climbing": 8.8, "Strength Training": 5.0,
  "HIIT": 8.0, "CrossFit": 8.0, "Yoga": 2.5, "Pilates": 3.0, "Stretching": 2.3,
  "Dancing": 5.0, "Boxing": 7.8, "Martial Arts": 10.3, "Football": 7.0, "Basketball": 6.5,
  "Tennis": 7.3, "Badminton": 5.5, "Squash": 7.3, "Table Tennis": 4.0, "Climbing": 8.0,
  "Skiing": 7.0, "Ice Skating": 7.0, "Golf": 4.8, "Jump Rope": 11.0, "Other": 5.0,
};

// kcal = MET x 3.5 x body weight (kg) / 200, per minute of activity.
export function kcalBurn(met, minutes, weightKg) {
  return Math.round(((met * 3.5 * weightKg) / 200) * minutes);
}