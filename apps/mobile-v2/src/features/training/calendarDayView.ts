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
