# ALL IN 365 V2 — Completed Activity must preserve the V1 standard

**Status:** Founder-approved UX requirement (2026-11-11); implementation still depends on ALL-243 canonical Completed Activity owner.
**Do not infer that V2 storage, metrics or Coach analysis are deployed from this document.**

## Source authority

V1 `allinproject/ALL-IN`, branch `integration/native-watch-v301`:
- `docs/decisions/2026-10-29-sport-specific-completed-activity-screens.md` (locked sport-specific layouts)
- `docs/decisions/2026-10-29-completed-activity-import-landing.md` (imported activity / review)
- `Native/src/app/training/workout/[id].tsx` (actual Overview / Details / Coach implementation)
- `Native/src/data/completedActivityPresentation.ts` (sport-aware metric priorities)

V2 ownership remains `ALL-243` (one completed activity/metric registry), with Training `ALL-246` and Coach `ALL-231` as consumers/producers of their own domains.

## Visible navigation: no reduced screen

**Overview | Details | Coach** — these are the founder-approved tab labels. Do not use the V2 interim UX labels **Advanced Stats** and **Analysis**, although deep metrics and analysis capabilities are preserved. Only eligible verified Indoor Trainer/Stair challenges add **Leaderboard**.

- **Overview** — actual activity title, sport, completion date/time, source; short sport-priority statistics; route/map where privacy permits; interval or structured execution summary where available; shoes/bike/context and allowed edits. Do not force the user to fill fields before entering.
- **Details** — all genuinely available, supported metrics for that sport, including sourced zones/time series, split/lap/interval structure, terrain/elevation, cadence, power, stroke, recorded sets/reps/load, indoor-machine measurements and provenance. Hide absent metrics; missing is not zero.
- **Coach** — an evidence-based activity analysis: purpose, exact planned-vs-actual comparison when matched, meaningful execution and source limitations, comparable history, recovery/training interpretation and actionable next steps. Provide an exact-activity-context follow-up conversation. Coach does not directly mutate Training plans; proposed changes require review and approval.
- **Post-completion editing** — start and finish workouts without mandatory gear/terrain prompts. Edit road/trail metadata, assign/change/clear shoes or bike, effort and notes at leisure from the completed activity. Preserve source measurements and provenance. Mileage reconciliation depends on one canonical activity-gear assignment ledger, including imported duplicate/edit/delete behavior. No second gear mileage truth.
- **Sharing** — Community reuse only the allowed public subset with route/privacy controls; never leak private Coach analysis, medical data, recovery readiness or hidden location.

### Sport-priority hierarchy (representative)

| Sport | Overview first | Details |
| --- | --- | --- |
| Outdoor run | route, distance, duration, pace, HR/elevation when present, shoes | splits/laps, pace, HR zones, cadence/dynamics/elevation if sourced |
| Trail run | running measurements with real terrain/elevation context; confirmed trail classification | elevation profile, ascent/descent, route and recorded pace/HR |
| Outdoor ride | route, distance/time, speed, power/HR/cadence where measured, bike | power/HR/cadence/speed trends, elevation, segments |
| Indoor trainer | interval execution, duration, power/cadence/HR when present | target-versus-actual interval graphs and verified equipment context; no GPS map |
| Strength | exercises, sets, reps/load/volume and validated achievements | individual completed sets and corrections, substitutions/RIR/RPE when entered |
| Hike / ruck | route, duration, elevation, distance and confirmed pack weight for ruck | vertical profile, explicit pack load, navigation and sourced physiology |
| Pool swim | distance, duration, pace/100, pool length/laps | lengths/sets, rest, stroke/SWOLF where actually recorded |
| Yoga/mobility | duration and recorded blocks/notes | no fabricated pace or competitive performance score |
| Multisport | overall time and ordered sport legs | each leg and transition independently |

Additional sports follow the full V1 locked configuration, not this abbreviated table. User display customization is sport-specific and presentation-only.

## Implementation gates

1. ALL-243 canonical schema/metric registry/source merge and least-privilege user reads approved and deployed.
2. Athlete-owned, account-switch-safe Completed Activity query exposed; use real data only.
3. Overview/Details/Coach rendering respects sport capability and provenance.
4. Coach context binds exact canonical activity and matched plan revision, with historical evidence and non-diagnostic scope.
5. Post-finish gear assignment/terrain edits integrated with existing Personal Gear defaults and single mileage ledger; no mandatory pre-workout gear UI.
6. Validate imported/manual/Watch, duplicate sources, offline/error, two accounts, accessibility and real device.

**Product principle:** Get the athlete moving first; Completed Activity answers what happened; Coach explains what it means; Progress describes change over time.
