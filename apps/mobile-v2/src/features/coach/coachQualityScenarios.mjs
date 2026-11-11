/**
 * ALL-241 versioned scenario inputs for future live Coach evaluation.
 * These are test specifications, NOT observed Coach output and NOT release evidence.
 */
export const COACH_QUALITY_JOURNEYS = [
  {
    "id": "ALL241-beginner-journey-v1",
    "cohort": "beginner",
    "target": "Build a habit without gym access",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Build a habit without gym access. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Can only walk 10 minutes now. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: No connected activity history.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never invent a race target or required weekly minutes"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Review a three-day walking plan. Show me before applying.",
        "expected": [
          "Use canonical training owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "invent a race target or required weekly minutes",
    "requiredOwner": "training",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-road-runner-journey-v1",
    "cohort": "road-runner",
    "target": "Run a recreational 10K with two strength sessions",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Run a recreational 10K with two strength sessions. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Work shift removes Thursday availability. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: Watch sync is incomplete.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never treat unsynced days as missed workouts"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Preview moving Thursday session. Show me before applying.",
        "expected": [
          "Use canonical training owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "treat unsynced days as missed workouts",
    "requiredOwner": "training",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-ultrarunner-journey-v1",
    "cohort": "ultrarunner",
    "target": "Prepare for a trail 50-mile race with aid stations",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Prepare for a trail 50-mile race with aid stations. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Course GPX version changes. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: Aid station offerings are unverified.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never invent course elevation or station supplies"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Review race fuel and course strategy. Show me before applying.",
        "expected": [
          "Use canonical race owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "invent course elevation or station supplies",
    "requiredOwner": "race",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-cyclist-journey-v1",
    "cohort": "cyclist",
    "target": "Improve a 100-mile cycling goal with indoor sessions",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Improve a 100-mile cycling goal with indoor sessions. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Outdoor ride replaced by indoor trainer. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: No power meter available.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never derive running pace or fabricated watts"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Preview revised cycling session. Show me before applying.",
        "expected": [
          "Use canonical training owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "derive running pace or fabricated watts",
    "requiredOwner": "training",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-lifter-journey-v1",
    "cohort": "lifter",
    "target": "Build strength with accepted four-superset routine",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Build strength with accepted four-superset routine. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Lying leg curl is now a hard restriction. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: Working load for alternate exercise unknown.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never reintroduce excluded exercise by alias"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Preview safe exercise substitution. Show me before applying.",
        "expected": [
          "Use canonical training owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "reintroduce excluded exercise by alias",
    "requiredOwner": "training",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-multisport-journey-v1",
    "cohort": "multisport",
    "target": "Balance swim, bike, run and strength",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Balance swim, bike, run and strength. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Hard bike and run intervals collide with recovery. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: Swim sensor data missing.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never convert swim distance into running load"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Preview coordinated weekly schedule. Show me before applying.",
        "expected": [
          "Use canonical training owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "convert swim distance into running load",
    "requiredOwner": "training",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-shift-worker-journey-v1",
    "cohort": "shift-worker",
    "target": "Stay consistent on rotating shifts",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Stay consistent on rotating shifts. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Availability changes from mornings to evenings. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: Two recent sessions lack completion evidence.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never silently move accepted sessions"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Preview availability-aware reflow. Show me before applying.",
        "expected": [
          "Use canonical training owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "silently move accepted sessions",
    "requiredOwner": "training",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  },
  {
    "id": "ALL241-lifestyle-journey-v1",
    "cohort": "lifestyle",
    "target": "Eat better with no calorie counting",
    "steps": [
      {
        "phase": "establish",
        "input": "My goal is: Eat better with no calorie counting. What can we do?",
        "expected": [
          "Recognize the stated goal",
          "Ask only material missing questions",
          "Do not save goals without confirmation"
        ]
      },
      {
        "phase": "fresh-thread",
        "input": "Remember what we are working on? What should I focus on today?",
        "expected": [
          "Read relevant canonical athlete context",
          "Do not leak unrelated thread context",
          "No repeated questions for known facts"
        ]
      },
      {
        "phase": "changed-context",
        "input": "Things changed: Food budget tightens and prep time drops. What should we adjust?",
        "expected": [
          "Use latest accepted owner revision",
          "Explain relevant tradeoffs",
          "Propose rather than silently write"
        ]
      },
      {
        "phase": "uncertainty",
        "input": "I need advice, but this is all I know: Food Log has no entries this week.",
        "expected": [
          "Label missing source coverage as unknown",
          "Avoid precise invented facts",
          "Ask one essential question or offer bounded options",
          "Never claim zero calories eaten or log consumption"
        ]
      },
      {
        "phase": "action-review",
        "input": "Please help me: Review pantry-first meal and shopping proposal. Show me before applying.",
        "expected": [
          "Use canonical kitchen owner",
          "Preview exact target and version",
          "Require explicit approval before write",
          "No success claim before verified canonical readback"
        ]
      },
      {
        "phase": "follow-up",
        "input": "I have not confirmed that I completed the last step. What comes next?",
        "expected": [
          "Do not infer completion from silence",
          "Check fresh owner state",
          "Offer a relevant next action without nagging"
        ]
      }
    ],
    "forbidden": "claim zero calories eaten or log consumption",
    "requiredOwner": "kitchen",
    "levels": [
      "fixture",
      "integration",
      "model",
      "device"
    ]
  }
];
export function validateQualityJourneys(journeys) {
  const failures = [];
  const cohorts = new Set();
  for (const journey of journeys) {
    if (cohorts.has(journey.cohort)) failures.push("DUPLICATE_COHORT:"+journey.cohort);
    cohorts.add(journey.cohort);
    if (!journey.id || !journey.target || !journey.requiredOwner || !journey.forbidden) failures.push("INCOMPLETE_CASE:"+journey.cohort);
    const phases = journey.steps?.map((step) => step.phase);
    if (JSON.stringify(phases) !== JSON.stringify(["establish","fresh-thread","changed-context","uncertainty","action-review","follow-up"])) failures.push("INVALID_PHASES:"+journey.cohort);
    if (!journey.steps?.every((step) => step.input && Array.isArray(step.expected) && step.expected.length >= 3)) failures.push("INCOMPLETE_EXPECTATIONS:"+journey.cohort);
  }
  if (cohorts.size !== 8) failures.push("MISSING_COHORTS");
  return { valid: failures.length === 0, failures };
}
