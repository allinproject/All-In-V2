# V2 Exercise Science Evidence Baseline — 2026-11-10

This is a source review for the canonical Exercise Library owner (ALL-258), not an exercise catalog and not a prescription guide. It records which claims current reviews can support and where they cannot be generalized.

## Evidence rules for Coach

1. Bind anatomy, movement demands, cues and exercise benefits to the exact canonical **variation**. A goblet squat, barbell back squat, box squat and leg press are not interchangeable records.
2. Keep three levels of claim separate:
   - **General adaptation:** resistance training can develop a capacity such as maximal strength, muscle size or power in the studied population.
   - **Direct sport outcome:** a study measured a sport-specific performance outcome in a defined athlete population.
   - **Mechanistic rationale:** a movement or muscle action plausibly trains a demand. This is not proof of improved race performance.
3. Every claim must name its population, evidence tier, directness, linked source and limitations. A review of healthy adults must not be relabeled as proof of a sport-specific benefit.
4. Never convert a movement's muscle emphasis into an injury-prevention guarantee, an automatic performance prediction, or a claim that one exercise is mandatory.
5. Exercise suitability also depends on the athlete's goal, training age, phase, recent workload, next key session, confirmed equipment, accepted exercise restrictions and response to prior training. Evidence alone does not establish individual suitability.
6. When direct evidence is absent or uncertain, Coach may explain the general capacity being trained and label the sport transfer as indirect/uncertain. It should not invent a precise percentage benefit or claim causal certainty.

## Reviewed source findings

### General resistance training — healthy adults

**Currier et al., 2026, ACSM Position Stand / overview of reviews.** The overview synthesized 137 systematic reviews and more than 30,000 participants. Resistance training improved a broad set of strength, size, power and physical-function outcomes versus control. The reported prescription associations differ by target: heavier loads and full range of motion for strength; higher weekly volume for hypertrophy; moderate loads and fast concentric intent for power. Several popular programming variables did not consistently change outcomes across the reviewed literature.

**Allowed use:** broad general-adaptation evidence for healthy adults, with the actual outcome and training context stated.

**Not allowed:** using these population-level findings to claim that a particular exercise is best for runners, swimmers or cyclists; applying adult healthy-population advice to a person with a medical restriction as individualized clinical direction.

Source: [PubMed 41843416](https://pubmed.ncbi.nlm.nih.gov/41843416/) · [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/)

### Middle- and long-distance running

**Systematic review and meta-analysis, 2024.** This review examined strength-training methods and running economy in middle- and long-distance runners. Its reported conclusions indicate that high-load strength training, plyometric training and combined methods may improve running economy. Findings differ by method and test speed; the reviewed abstract reports potentially different patterns for plyometric and high-load approaches.

**Allowed use:** a bounded, population-specific direct outcome claim for running economy, provided the selected method, population and testing-speed limits are retained.

**Not allowed:** claiming every strength movement improves running economy; promising faster race times or injury prevention; generalizing the result to all trail-ultra demands, all experience levels or every running speed.

Source: [Systematic review and meta-analysis (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11052887/) · [PubMed 38165636](https://pubmed.ncbi.nlm.nih.gov/38165636/)

### Endurance cycling

**Heavy strength training systematic review and meta-analysis (published online 2025; journal issue 2026).** Seventeen studies with 262 cyclists were included. Heavy strength training showed statistically significant effects on cycling performance, cycling efficiency and anaerobic power in the pooled analysis, but not on several aerobic measures (including VO2max and maximal aerobic power). The authors characterize the certainty as low, so robust universal prescription claims are not justified.

**Allowed use:** evidence that heavy resistance training may support selected performance determinants in studied endurance cyclists; retain low-certainty and outcome-specific caveats.

**Not allowed:** saying strength training raises VO2max, that the same intervention suits every cyclist, or that a particular lift is proven superior from these pooled findings.

Source: [PubMed 40632222](https://pubmed.ncbi.nlm.nih.gov/40632222/) · [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12881108/)

### Competitive front-crawl swimming

**Systematic review and meta-analysis (2024).** Thirteen studies with 267 competitive swimmers were included. The analysis found improvements in upper-limb maximal strength and some short- to middle-distance front-crawl outcomes. The authors report that methodology mattered; evidence quality for several distance/technical outcomes was low or very low, and findings should not be generalized to every stroke, event distance, recreational swimmer or shoulder condition.

**Allowed use:** narrowly framed claims for competitive front-crawl swimmers and the interventions/outcomes actually studied.

**Not allowed:** blanket prescriptions for all swimming, claims that a specific shoulder exercise prevents injury, or extrapolation to other strokes or long-distance open-water performance without supporting evidence.

Source: [PubMed 39129754](https://pubmed.ncbi.nlm.nih.gov/39129754/) · [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC11310150/)

## Sport and athlete gaps still requiring research

The sources above do **not** establish exercise-to-performance mappings for every population ALL IN serves. Dedicated reviews and evidence grading are still needed for trail/ultra running, hiking, rucking, triathlon/multisport scheduling, rowing, beginners and older athletes with varied capability, strength/power sports, and athlete-specific restrictions. Do not fill those gaps with plausible-sounding muscle-transfer assumptions.

## Implementation mapping to ALL-258

The src/features/strength/exerciseScienceProfile.ts contract is intended to store evidence at the variation level:
- stable movement and variation IDs;
- movement pattern, laterality, contraction mode, skill and confirmed equipment IDs;
- sourced primary/secondary/stabilizer muscle roles and joint demands;
- caution flags and variation-specific written cues;
- progression, regression and alternative variation references;
- source records plus separate claims for muscle emphasis, general adaptation, direct sport transfer, load/recovery and caution;
- population, target sport/goal, directness, evidence tier, confidence and explicit limitations.

A profile may exist as a draft, but it is not Coach-eligible until the library owner marks it reviewed and it contains linked sources and claims. No exercise catalog rows are seeded by this research note.

## Next research and acceptance work

1. Build a variation-by-variation source review for common lifts and movement patterns; identify exactly which statements are anatomical description, general adaptation, direct sport outcome or mechanistic rationale.
2. Add athlete-context suitability rules only after the canonical profile fields and restriction/equipment owners are available. Missing equipment, unknown restrictions, pain context and incompatible next-session load must not be silently ignored.
3. Evaluate explanations across running, cycling, swimming, strength sport, beginner/walking, hiking/rucking and mixed-sport athletes. Include negative cases where an exercise is popular but unsupported or poorly timed for the athlete.
4. Coach must explain **why this variation is relevant now**, its limits, what it stresses and the alternative considered. It must not flatten every athlete into a generic leg/core routine.
