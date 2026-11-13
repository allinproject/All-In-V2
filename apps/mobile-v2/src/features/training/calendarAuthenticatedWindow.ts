import { certifyCalendarOwnerRead, type OwnerCalendarWindowSnapshot } from './calendarOwnerReadCertification.ts';
import { combineCalendarReads, type PlannedCalendarItem, type CompletedCalendarItem, type CombinedCalendarResult } from './trainingCalendarReadModel.ts';
import { validAthleteLocalDate } from './manualActivityDraft.ts';

/**
 * ALL-250/246/243: a shared, authenticated owner-read orchestration boundary.
 * Today and Train must use this exact service after approved canonical owner
 * endpoints are deployed. No client-owned table reads or alternate planner.
 */
export type CalendarWindowServices = {
  authenticateOwner: (expectedOwnerId: string) => Promise<void>;
  readPlanned: (request: CalendarWindowRequest) => Promise<OwnerCalendarWindowSnapshot<PlannedCalendarItem>>;
  readCompleted: (request: CalendarWindowRequest) => Promise<OwnerCalendarWindowSnapshot<CompletedCalendarItem>>;
};
export type CalendarWindowRequest = {
  expectedOwnerId: string;
  authSessionGeneration: number;
  fromDate: string;
  throughDate: string;
};
const unavailable = (ownerId:string,fromDate:string,throughDate:string) =>
  combineCalendarReads({ownerId,fromDate,throughDate,planned:{status:'unavailable'},completed:{status:'unavailable'}});

/**
 * Verify identity before and AFTER both reads. Each owner may fail
 * independently, so partial evidence stays partial. No result survives a
 * session switch, cancelled view, changed account or missing coverage.
 */
export async function readAuthenticatedCalendarWindow(
  services: CalendarWindowServices,
  request: CalendarWindowRequest,
  isCurrent: () => boolean = () => true,
): Promise<CombinedCalendarResult> {
  const {expectedOwnerId,authSessionGeneration,fromDate,throughDate}=request;
  const empty=()=>unavailable(expectedOwnerId,fromDate,throughDate);
  if (!expectedOwnerId || !Number.isSafeInteger(authSessionGeneration) || authSessionGeneration<0 ||
      !validAthleteLocalDate(fromDate) || !validAthleteLocalDate(throughDate) ||
      fromDate>throughDate || !isCurrent()) return empty();
  try {
    await services.authenticateOwner(expectedOwnerId);
    if(!isCurrent())return empty();
  }catch{return empty();}
  const [plannedResult,completedResult]=await Promise.allSettled([
    services.readPlanned(request),services.readCompleted(request),
  ]);
  if(!isCurrent())return empty();
  try{
    await services.authenticateOwner(expectedOwnerId);
    if(!isCurrent())return empty();
  }catch{return empty();}
  const shared={
    expectedOwnerId,authenticatedOwnerId:expectedOwnerId,
    activeSessionGeneration:authSessionGeneration,accessGateReady:true,
    requestedFromDate:fromDate,requestedThroughDate:throughDate,
  };
  const planned=certifyCalendarOwnerRead({...shared,
    snapshot:plannedResult.status==='fulfilled'?plannedResult.value:null});
  const completed=certifyCalendarOwnerRead({...shared,
    snapshot:completedResult.status==='fulfilled'?completedResult.value:null});
  return combineCalendarReads({ownerId:expectedOwnerId,fromDate,throughDate,planned,completed});
}
