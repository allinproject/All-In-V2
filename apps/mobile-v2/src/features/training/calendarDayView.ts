import { validAthleteLocalDate } from './manualActivityDraft.ts';

/** Pure athlete-local calendar date arithmetic. Date values are not UTC timestamps. */
export function shiftCalendarDate(isoDay: string, days: number): string | null {
  if (!validAthleteLocalDate(isoDay) || !Number.isSafeInteger(days) || Math.abs(days) > 3660) return null;
  const [y,m,d]=isoDay.split('-').map(Number);
  const value=new Date(Date.UTC(y,m-1,d+days));
  const result=[value.getUTCFullYear(),String(value.getUTCMonth()+1).padStart(2,'0'),String(value.getUTCDate()).padStart(2,'0')].join('-');
  return validAthleteLocalDate(result)?result:null;
}
export function weekDaysForDate(day: string): string[] {
  if (!validAthleteLocalDate(day)) return [];
  const [y,m,d]=day.split('-').map(Number);
  const weekday=new Date(Date.UTC(y,m-1,d)).getUTCDay();
  const offset=(weekday+6)%7;
  const monday=shiftCalendarDate(day,-offset);
  return monday===null?[]:Array.from({length:7},(_,i)=>shiftCalendarDate(monday,i)!).filter(Boolean);
}
export function formatCalendarDay(day: string): string {
  if (!validAthleteLocalDate(day)) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));
}
/** No fake records. Null means canonical reads unavailable, [] means verified empty. */
export type CalendarEvidence<T>={status:'unavailable'|'loading';records?:never}|{status:'ready';records:readonly T[]};
export function calendarRecordsForDay<T extends {athleteLocalDate:string}>(data:CalendarEvidence<T>,day:string):T[]|null{
  return data.status==='ready'?data.records.filter(r=>r.athleteLocalDate===day):null;
}

/** Month/Week navigation is date-only; no timezone conversion or scheduled-workout mutation. */
export function firstOfMonth(day: string): string | null {
  return validAthleteLocalDate(day) ? day.slice(0, 7) + '-01' : null;
}
export function shiftCalendarMonth(day: string, offset: number): string | null {
  if (!validAthleteLocalDate(day) || !Number.isSafeInteger(offset) || Math.abs(offset) > 120) return null;
  const [year, month] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));
  const result = next.getUTCFullYear() + '-' + String(next.getUTCMonth() + 1).padStart(2, '0') + '-01';
  return validAthleteLocalDate(result) ? result : null;
}
export function monthCalendarWeeks(day: string): string[][] {
  const start = firstOfMonth(day);
  if (!start) return [];
  const [year, month] = start.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');
  const firstWeek = weekDaysForDate(start);
  const lastWeek = weekDaysForDate(last);
  if (firstWeek.length !== 7 || lastWeek.length !== 7) return [];
  const weeks: string[][] = [];
  let cursor = firstWeek[0];
  while (cursor <= lastWeek[0]) {
    weeks.push(weekDaysForDate(cursor));
    const next = shiftCalendarDate(cursor, 7);
    if (!next) break;
    cursor = next;
  }
  return weeks;
}
export function formatCalendarMonth(day: string): string {
  const first = firstOfMonth(day);
  return first ? new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(first + 'T12:00:00Z')) : 'Invalid month';
}
