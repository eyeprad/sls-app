/* ------------------------------------------------------------------
   SLS catalog — the eleven life areas, their default daily practices,
   and the workout plan templates a user can start from.
   Everything here is a default: each user's own copy lives in their
   profile settings and can be edited freely.
------------------------------------------------------------------ */
(function (root) {
  "use strict";

  // Monday-first display order; `day` is the JS weekday (0 = Sun … 6 = Sat).
  var WEEK = [
    { day: 1, short: "Mon", long: "Monday" },
    { day: 2, short: "Tue", long: "Tuesday" },
    { day: 3, short: "Wed", long: "Wednesday" },
    { day: 4, short: "Thu", long: "Thursday" },
    { day: 5, short: "Fri", long: "Friday" },
    { day: 6, short: "Sat", long: "Saturday" },
    { day: 0, short: "Sun", long: "Sunday" }
  ];

  function p(id, label, detail) { return { id: id, label: label, detail: detail || "" }; }

  var AREAS = [
    { key: "fitness", title: "Fitness", role: "Personal trainer", kind: "plan",
      purpose: "Train with a plan and get measurably stronger over time." },
    { key: "spiritual", title: "Spiritual", role: "Pastor, spiritual director, or mentor", kind: "practices",
      purpose: "Keep faith practiced daily, rooted in community, with rest built in.",
      defaults: { practices: [p("prayer", "Prayer or quiet time"), p("scripture", "Scripture or devotional")], allowMinimum: true, daysPerWeek: 7 } },
    { key: "nutrition", title: "Nutrition", role: "Registered dietitian", kind: "practices",
      purpose: "Eat well by default, with fewer daily food decisions.",
      defaults: { practices: [p("protein", "Hit protein goal"), p("water", "Drank enough water")], allowMinimum: false, daysPerWeek: 7 } },
    { key: "health-recovery", title: "Health & Recovery", role: "Primary care doctor", kind: "practices",
      purpose: "Stay ahead of health issues and recover well through sleep and prevention.",
      defaults: { practices: [p("sleep", "7+ hours of sleep"), p("bedtime", "In bed by 11 PM")], allowMinimum: false, daysPerWeek: 7 } },
    { key: "mental-emotional", title: "Mental & Emotional", role: "Therapist or counselor", kind: "practices",
      purpose: "Stay clear-headed and resilient, with a plan for hard days.",
      defaults: { practices: [p("journal", "Journaled or reflected"), p("reset", "Took a real break (walk, breathe, call someone)")], allowMinimum: true, daysPerWeek: 7 } },
    { key: "relationships", title: "Relationships", role: "Relationship coach, mentor", kind: "practices",
      purpose: "Invest in partner, family, and friends on purpose, not just when there's time.",
      defaults: { practices: [p("reach_out", "Intentional time or reach-out")], allowMinimum: false, daysPerWeek: 4 } },
    { key: "career-purpose", title: "Career & Purpose", role: "Career coach, executive mentor", kind: "practices",
      purpose: "Know where you're headed and build the record to get there.",
      defaults: { practices: [p("deep_work", "Deep work block"), p("goal_progress", "Moved my main goal forward")], allowMinimum: true, daysPerWeek: 5 } },
    { key: "financial", title: "Financial", role: "Fiduciary planner, CPA", kind: "practices",
      purpose: "Spend with intention, save and invest automatically.",
      defaults: { practices: [p("spending", "Logged today's spending"), p("on_plan", "Stayed on the spending plan")], allowMinimum: false, daysPerWeek: 7 } },
    { key: "learning-growth", title: "Learning & Growth", role: "Tutor, mastermind group", kind: "practices",
      purpose: "Always be reading, always be building one skill.",
      defaults: { practices: [p("reading", "Read 10+ pages"), p("skill", "Practiced my current skill")], allowMinimum: true, daysPerWeek: 5 } },
    { key: "time-productivity", title: "Time & Productivity", role: "Executive assistant, chief of staff", kind: "practices",
      purpose: "Priorities get time before the week fills up.",
      defaults: { practices: [p("plan_tomorrow", "Planned tomorrow"), p("inbox_zero", "Cleared my task inbox")], allowMinimum: false, daysPerWeek: 5 } },
    { key: "home-admin", title: "Home & Admin", role: "House manager, assistant", kind: "practices",
      purpose: "Keep the home and paperwork running quietly in the background.",
      defaults: { practices: [p("reset", "10-minute home reset")], allowMinimum: false, daysPerWeek: 7 } }
  ];

  function ex(name, scheme, alts, note) { return { name: name, scheme: scheme || "", note: note || "", alts: alts || [] }; }

  var GAINZ = {
    push: [
      ex("Bench Press (Barbell)", "4 × 6–8", ["Bench Press (Dumbbell)", "Bench Press (Machine)"]),
      ex("Incline Bench Press (Dumbbell)", "3 × 8–12", ["Incline Bench Press (Barbell)", "Landmine Press (T-Bar)"]),
      ex("Seated Overhead Press (Dumbbell)", "3 × 8–12", ["Arnold Press (Dumbbell)", "Shoulder Press (Machine)"]),
      ex("Lateral Raise (Dumbbell)", "3 × 8–12", ["Cross Body Lateral Raise (Cable)"], "Can do more sets and drop set")
    ],
    pull: [
      ex("Bent Over Row (Barbell)", "3 × 8–12", ["Single-Arm Row (Dumbbell)", "T-Bar Row"]),
      ex("Lat Pulldown (Cable)", "3 × 8–12", ["Pull Ups (Bodyweight or Assisted)", "Single Arm Pulldown (Cable)"]),
      ex("Shrug (Dumbbell)", "4 × 8–12", ["Shrug (Barbell)", "Chest Supported Incline Shrug"]),
      ex("Face Pull (Cable)", "3 × 8–12", ["Rear Delt Fly (Cable or Machine)", "Band Pull-Aparts"])
    ],
    legs: [
      ex("Squat (Barbell)", "3 × 6–12", ["Goblet Squat (Dumbbell)", "Hack Squat (Machine)"]),
      ex("Seated Hamstring Curl (Machine)", "3 × 8–12", ["Lying Leg Curl (Machine)", "RDL (Dumbbell or Barbell)"]),
      ex("Leg Extension (Machine)", "3 × 8–12", ["Sissy Squat (Bodyweight or Smith)", "Step-Ups (Dumbbell)"]),
      ex("Standing Calf Raise (Dumbbell)", "3 × 15–20", ["Seated Calf Raise (Machine)", "Calf Press (Leg Press Machine)"])
    ],
    arms: [
      ex("Bicep Curl (Dumbbell)", "3 × 8–12", ["Spider Curls (Dumbbell on Incline Bench)", "Curl (Cable)"]),
      ex("Tricep Extension (Cable, V-bar)", "3 × 6–8", ["Skull Crushers (EZ Curl Bar)", "Overhead Tricep Extension (Cable)"]),
      ex("Tricep Extension (Cable, Long Rope)", "3 × 8–12", ["Single Arm Tricep Extension (Cable)", "Tricep Dip (Bodyweight, bench)"], "Lighter weight here"),
      ex("Incline Curl (Dumbbell)", "3 × 8–12", ["Concentration Curl (Dumbbell)", "Bicep Curl (Armblaster)"]),
      ex("Seated Overhead Tricep Extension (Dumbbell)", "3 × 8–12", ["Seated Overhead Tricep Extension (EZ Curl)", "Tricep Pushdown (Cable, straight bar)"]),
      ex("Cable Curl (Straight bar)", "3 × 8–12", ["EZ Curl (21s)"])
    ]
  };

  function day(name, exercises, extra) {
    return Object.assign({ name: name, time: "", location: "", note: "", exercises: exercises || [] }, extra || {});
  }

  // Templates are plain data; `days` is keyed by JS weekday.
  var PLAN_TEMPLATES = [
    {
      id: "sls-ppl",
      title: "SLS lunch PPL",
      blurb: "Push, pull, legs Mon–Wed at the work gym, Tuesday yoga, backup classes.",
      plan: {
        name: "SLS lunch PPL",
        days: {
          1: day("Push", GAINZ.push, { time: "12–1 PM", location: "Gym at work" }),
          2: day("Pull", GAINZ.pull, { time: "12–1 PM", location: "Gym at work" }),
          3: day("Legs", GAINZ.legs, { time: "12–1 PM", location: "Gym at work" }),
          4: day("", [], { note: "Cycle at 5:30 PM is tonight's backup if an earlier slot was missed." })
        },
        backups: ["Circuit Training", "HIIT", "Cycle"],
        extras: [{ id: "yoga", day: 2, name: "Vinyasa Yoga", time: "6–6:50 PM", location: "Apartment studio" }],
        extrasCount: false,
        minimum: "Show up and do the first exercise — that still counts."
      }
    },
    {
      id: "gainz-ppla",
      title: "GAINZ PPLA 4-day split",
      blurb: "Push, pull, rest, legs, arms, rest, rest. 8–12 rep progression to failure.",
      plan: {
        name: "GAINZ PPLA",
        days: {
          1: day("Push", GAINZ.push),
          2: day("Pull", GAINZ.pull),
          4: day("Legs", GAINZ.legs),
          5: day("Arms", GAINZ.arms)
        },
        backups: [],
        extras: [],
        extrasCount: false,
        minimum: "Hit the first two exercises to failure."
      }
    },
    {
      id: "full-body-3",
      title: "Full body 3×",
      blurb: "Mon / Wed / Fri full-body strength. Great starting point.",
      plan: {
        name: "Full body 3×",
        days: {
          1: day("Full body A", [ex("Squat", "3 × 5–8"), ex("Bench Press", "3 × 6–10"), ex("Bent Over Row", "3 × 8–12"), ex("Plank", "3 × 30–60s")]),
          3: day("Full body B", [ex("Romanian Deadlift", "3 × 8–10"), ex("Overhead Press", "3 × 6–10"), ex("Lat Pulldown", "3 × 8–12"), ex("Walking Lunge", "3 × 10–12")]),
          5: day("Full body A", [ex("Squat", "3 × 5–8"), ex("Bench Press", "3 × 6–10"), ex("Bent Over Row", "3 × 8–12"), ex("Plank", "3 × 30–60s")])
        },
        backups: [],
        extras: [],
        extrasCount: false,
        minimum: "10 minutes of movement still counts."
      }
    },
    {
      id: "upper-lower-4",
      title: "Upper / lower 4×",
      blurb: "Two upper and two lower days each week.",
      plan: {
        name: "Upper / lower",
        days: {
          1: day("Upper", [ex("Bench Press", "4 × 6–8"), ex("Bent Over Row", "4 × 8–10"), ex("Overhead Press", "3 × 8–10"), ex("Lat Pulldown", "3 × 10–12"), ex("Bicep Curl", "3 × 10–12")]),
          2: day("Lower", [ex("Squat", "4 × 6–8"), ex("Romanian Deadlift", "3 × 8–10"), ex("Leg Press", "3 × 10–12"), ex("Standing Calf Raise", "3 × 15–20")]),
          4: day("Upper", [ex("Incline Dumbbell Press", "4 × 8–10"), ex("Seated Cable Row", "4 × 10–12"), ex("Lateral Raise", "3 × 12–15"), ex("Tricep Pushdown", "3 × 10–12")]),
          5: day("Lower", [ex("Deadlift", "3 × 5"), ex("Bulgarian Split Squat", "3 × 8–10"), ex("Leg Curl", "3 × 10–12"), ex("Hanging Leg Raise", "3 × 10–15")])
        },
        backups: [],
        extras: [],
        extrasCount: false,
        minimum: "Do the first lift of the day."
      }
    },
    {
      id: "home-starter",
      title: "Home starter",
      blurb: "40 minutes, no gym: two full-body days plus a class.",
      plan: {
        name: "Home starter",
        days: {
          1: day("Full body", [ex("Bodyweight Squat", "3 × 12–15"), ex("Push-up", "3 × 6–12"), ex("Backpack Row", "3 × 10–12"), ex("Reverse Lunge", "3 × 8–10"), ex("Plank", "3 × 30–45s")], { location: "Home" }),
          2: day("Yoga class", [], { time: "6 PM" }),
          3: day("Full body", [ex("Bodyweight Squat", "3 × 12–15"), ex("Push-up", "3 × 6–12"), ex("Backpack Row", "3 × 10–12"), ex("Reverse Lunge", "3 × 8–10"), ex("Plank", "3 × 30–45s")], { location: "Home" })
        },
        backups: ["Walk", "Run", "Hike"],
        extras: [],
        extrasCount: false,
        minimum: "10 minutes still counts."
      }
    },
    {
      id: "blank",
      title: "Start blank",
      blurb: "Build your own week from scratch, or import a file.",
      plan: { name: "My plan", days: {}, backups: [], extras: [], extrasCount: false, minimum: "" }
    }
  ];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function templatePlan(id) {
    var found = PLAN_TEMPLATES.filter(function (t) { return t.id === id; })[0] || PLAN_TEMPLATES[0];
    return clone(found.plan);
  }

  var api = { WEEK: WEEK, AREAS: AREAS, PLAN_TEMPLATES: PLAN_TEMPLATES, templatePlan: templatePlan, clone: clone };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SLSCatalog = api;
})(this);
