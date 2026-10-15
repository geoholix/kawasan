/**
 * Normalised diurnal activity profiles for Jakarta (local hour 0–23). Shared
 * by the synthetic data generator and the emission model.
 */

/** Road traffic: morning and evening rush hours, quiet nights. */
export function trafficProfile(hour: number): number {
  const morning = Math.exp(-((hour - 7.5) ** 2) / 3);
  const evening = Math.exp(-((hour - 19) ** 2) / 4);
  const night = hour < 5 || hour > 22 ? 0.35 : 0;
  return 0.45 + 0.6 * morning + 0.5 * evening + night;
}

/** Electricity load: daytime commercial plateau, evening residential peak. */
export function electricityProfile(hour: number): number {
  const day = hour >= 8 && hour <= 17 ? 0.25 : 0;
  const evening = Math.exp(-((hour - 19.5) ** 2) / 5) * 0.35;
  return 0.75 + day + evening;
}

/** Household cooking (LPG): breakfast, lunch and dinner peaks. */
export function cookingProfile(hour: number): number {
  return 0.2 + [5.5, 11.5, 17.5].reduce((sum, peak) => sum + Math.exp(-((hour - peak) ** 2) / 1.2), 0);
}

export function flatProfile(): number {
  return 1;
}

/** Mean of a profile over 24 hours, used to keep annual totals unchanged. */
export function profileMean(profile: (hour: number) => number): number {
  let sum = 0;
  for (let h = 0; h < 24; h++) sum += profile(h);
  return sum / 24;
}
