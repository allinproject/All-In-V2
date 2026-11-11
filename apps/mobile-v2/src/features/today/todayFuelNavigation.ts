import { validAthleteLocalDate } from '../training/manualActivityDraft.ts';

/** ALL-250: Carry the exact athlete-local Today date to Fuel, not UTC time.
 * These links express navigation intent only. Fuel remains the canonical owner.
 */
export type TodayFuelSection = 'daily' | 'food-log';
export type FuelDayContext = { date: string; section: TodayFuelSection };
export function todayFuelDestination(day: string | null, section: TodayFuelSection): {
  pathname: '/fuel'; params: { date: string; section: TodayFuelSection };
} | null {
  if (!day || !validAthleteLocalDate(day) || (section !== 'daily' && section !== 'food-log')) return null;
  return { pathname: '/fuel', params: { date: day, section } };
}

export function parseFuelDayContext(
  rawDate: string | string[] | undefined,
  rawSection: string | string[] | undefined,
): FuelDayContext | null {
  if (typeof rawDate !== 'string' || !validAthleteLocalDate(rawDate)
    || (rawSection !== 'daily' && rawSection !== 'food-log')) return null;
  return { date: rawDate, section: rawSection };
}

export function fuelContextDescription(context: FuelDayContext | null): string | null {
  if (!context) return null;
  return context.section === 'daily'
    ? `Daily Extended · ${context.date}. Verified Fuel and activity totals are not connected yet.`
    : `Food Log · ${context.date}. Verified food entries and photos are not connected yet.`;
}
