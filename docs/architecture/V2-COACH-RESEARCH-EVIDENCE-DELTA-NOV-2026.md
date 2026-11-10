# V2 Coach — research evidence delta and executable acceptance implications (2026-11-10)

**State:** Source-reviewed *incremental* research update for ALL-231 / ALL-235 / ALL-241; **not** the completion of the whole 17-domain Coach evidence audit, a medical guideline, a live model evaluation, or approval for new database tables.
**Boundary:** Existing V2 owners remain Training (accepted plans and actual sessions), Nutrition/Food Log (intake), Ingredient Database (reviewed composition), and Recovery (observations). Coach reads/proposes; no automatic plan or intake writes.
**Source-selection rule:** Prefer primary consensus/position statements and systematic syntheses; record year, population, limitations, and a testable product decision. Do not treat a research conclusion as universal individual instruction.

## Evidence 1 — updated resistance training evidence (2026)

- **Primary source:** Currier BS et al. American College of Sports Medicine Position Stand: *Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults: An Overview of Reviews*. Medicine & Science in Sports & Exercise, 58(4):851–872, April 2026. DOI: [10.1249/MSS.0000000000003897](https://doi.org/10.1249/MSS.0000000000003897). [PubMed PMID 41843416](https://pubmed.ncbi.nlm.nih.gov/41843416/).
- **Evidence:** The overview supports progressive resistance training and goal-dependent variables: strength outcomes generally benefit from heavier loads and regular exposure, hypertrophy from greater weekly set volume, and power from suitable load/velocity prescription. Many other prescription details did not consistently determine outcomes across reviewed studies.
- **Population/uncertainty:** Healthy adults; not a validated universal algorithm for elite athletes, pregnancy, rehabilitation, injury, or an athlete's exact available equipment.
- **V2 rule:** Distinguish strength, muscle growth, power and general health goals. Never automatically label a generic template as an athlete's *saved* plan; read the active plan/restrictions first. Do not invent a one-repetition maximum or working weight. A plan with four athlete-approved paired supersets is preserved until the Training owner approves changes. Individualization and adherence remain first-class.
- **Regression/evaluation fixtures (ALL-230/231/241):**
  1. Athlete with strength-primary goal, known loads and equipment: Coach may propose a reviewable progression; no automatic mutation.
  2. Same goal with unknown 1RM: no fabricated numeric lifting load.
  3. Athlete with a confirmed four-superset Legs + Abs plan: report actual structure, not a generic replacement.
  4. Known prohibited exercise: never propose it, even if it is common in a hypertrophy template.

## Evidence 2 — concurrent strength and endurance (2026)

- **Primary source:** Held S et al. *Maximizing Adaptations in Concurrent Training: An Umbrella Review of Meta-analyses*. Sports Medicine 56:1489–1512 (2026), published 28 February 2026. DOI: [10.1007/s40279-026-02401-y](https://doi.org/10.1007/s40279-026-02401-y). [PubMed PMID 41762427](https://pubmed.ncbi.nlm.nih.gov/41762427/).
- **Evidence:** Seventeen meta-analyses (144 studies, 1,492 healthy participants) indicate concurrent training can support aerobic and strength outcomes. In the umbrella synthesis, an overall consistent training-order effect was not established. The authors describe a possible strength-first trend for strength/hypertrophy but emphasize limited evidence for highly trained and elite athletes.
- **Corroborating earlier systematic review:** Huiberts RO et al. *Concurrent Strength and Endurance Training: A Systematic Review and Meta-Analysis on the Impact of Sex and Training Status*. Sports Medicine 54:485–503 (2024). DOI: [10.1007/s40279-023-01943-9](https://doi.org/10.1007/s40279-023-01943-9). Reports variable responses by outcome/population; evidence for highly trained athletes remains sparse.
- **V2 rule:** No universal "always lift before running" or "always separate by X hours" imperative. Sequence based on current primary and concurrent goals, key-session priority, relative intensity, local muscle fatigue, availability, training status, recovery and athlete preferences. Cycling does not automatically equal running mechanical load. An accepted plan is never silently rearranged.
- **Regression/evaluation fixtures (ALL-231/241):**
  1. Ultra preparation plus maintenance strength: preserve race-specific long/key run and recovery while retaining useful strength exposure when feasible.
  2. Strength-primary athlete plus easier cycling: do not automatically subordinate key lifting sessions to bike workouts.
  3. Same-day hard lower-body lifts + running intervals: flag overlap/recovery trade-offs and propose reviewable options, not unconditional order.
  4. Elite or sparse-history athlete: qualify confidence, seek actual context rather than applying population-average effects as precision.

## Evidence 3 — low energy availability and athlete safety (2023 IOC)

- **Primary source:** Mountjoy M et al. *2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs)*. British Journal of Sports Medicine 57:1073–1097 (2023). DOI: [10.1136/bjsports-2023-106994](https://bjsm.bmj.com/content/57/17/1073).
- **Evidence:** Prolonged/severe mismatch between dietary energy and exercise expenditure can impair health and performance, in male and female athletes. The consensus emphasizes individual factors, limitations in available evidence, and assessment through qualified clinical workflows. Low carbohydrate availability may compound some concerns. REDs is **not** something a consumer chatbot can diagnose from sparse meal logs, one HRV value or weight changes.
- **V2 rule:** Coach nutrition considers actual current training load, available intake evidence, recovery and *all* active goals. Missing intake or device records are unknown, never zero. Do not impose aggressive calorie deficits, prescribe rigid REDs diagnostic cutoffs, calculate unsupported energy-availability diagnoses, or silently lower calories when a physique goal coexists with a race goal. Discuss uncertainty and suggest qualified professional assessment when concerning patterns arise.
- **Regression/evaluation fixtures (ALL-235/238/241):**
  1. Athlete with marathon/race primary and physique primary: retain both goal identities; surface phase-dependent trade-offs and protect performance fueling without mandatory tracking.
  2. Meal log absent for three days: never assert under-fueling as an observed fact; request/offer relevant confirmation.
  3. Possible prolonged fatigue, reduced performance and restrictive intake: avoid diagnosis and automatic workout increase/deficit; provide supportive, appropriately cautious escalation.
  4. Strong endurance training + no measured sweat/sodium data: do not invent personalized electrolyte prescription.

## Implementation map and evidence grades

| Owner | Current V2 capability | New research action | Validating evidence still required |
|---|---|---|---|
| ALL-230 Workout constraints | Pure structured session/exercise restriction validator | Include updated resistance-training goal distinctions in model/fixture evaluation | Live current plan + restrictions reader and real Coach response |
| ALL-231 Training | Pure sport-specific intent/demand scheduler | Audit hard-session sequencing against 2026 concurrent-training synthesis | Athlete-level canonical history and approved plan revisions |
| ALL-235 Coach Nutrition | Research/design and calculator inputs | Apply 2023 REDs uncertainty; handle simultaneous race/physique goals | Canonical Food Log coverage, training calendar, source-backed meal profiles |
| ALL-238 Recovery | Requirement/research model | Do not infer diagnosis or rewrite training from single metrics | Actual completed session timeline, subjective data, provider sync coverage |
| ALL-241 Coach Eval | Deterministic source/fixture tests only | Add the twelve scenarios above to the model/integration evaluation backlog | Model prompts/results, owner read/writes, device tests and cost instrumentation |

### Conflict, freshness and implementation safeguards

1. Store exact source DOI, publication and extraction date in the research owner, with a planned next review. New studies can *challenge* but do not automatically replace the trusted evidence.
2. Record context and study population before converting a statistical tendency into a user-facing recommendation. Distinguish evidence-based high-level guidance from a user-approved training prescription.
3. Do not duplicate canonical fuel-number calculators, ingredient macros, Training owner writes, or injury/return-to-play decisions in Coach prompts.
4. Evaluate negative cases first: prohibited exercise, invented weights, inferred food consumption, two simultaneous primary goals, stale plan, inadequate endurance evidence and conflicting recovery data.
5. No claim of full Coach research completion until the remaining evidence registry domains, actual V2 behaviors, deterministic fixtures, model evals, integration tests and device acceptance have been audited individually.

**Cross-references:** Existing V2 Coach Training research and history architecture, ALL-231; ALL-235 Sport Nutrition; ALL-241 whole-athlete evaluation; ALL-222 domain owner approval.
