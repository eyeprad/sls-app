"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const P = require("../js/plan-import.js");
const fx = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");

// GAINZ Google Docs export
let r = P.parsePlanFromText(fx("gainz-docs-export.md"), "GAINZ 4 Day SPLIT.md");
let d = r.plan.days;
assert.deepStrictEqual(Object.keys(d).sort(), ["1", "2", "4", "5"], "PPLA lands Mon, Tue, Thu, Fri: " + JSON.stringify(Object.keys(d)));
assert.strictEqual(d[1].name, "Push");
assert.strictEqual(d[2].name, "Pull");
assert.strictEqual(d[4].name, "Legs");
assert.strictEqual(d[5].name, "Arms");
assert.strictEqual(d[1].exercises.length, 4);
assert.strictEqual(d[5].exercises.length, 6);
assert.strictEqual(d[1].exercises[0].name, "Bench Press (Barbell)");
assert.strictEqual(d[1].exercises[0].scheme, "4 × 6–8");
assert.deepStrictEqual(d[1].exercises[0].alts, ["Bench Press (Dumbbell)", "Bench Press (Machine)"]);
assert.strictEqual(d[1].exercises[3].note, "Can do more sets and drop set");
assert.strictEqual(d[5].exercises[5].name, "Cable Curl (Straight bar)");
assert.strictEqual(d[5].exercises[5].scheme, "3 × 8–12");
assert.strictEqual(r.plan.name, "PPLA");
assert.deepStrictEqual(r.warnings, []);

// PDF text with column separators and wrapped alternatives
r = P.parsePlanFromText(fx("gainz-pdf-lines.txt"), "gainz.pdf");
d = r.plan.days;
assert.deepStrictEqual(Object.keys(d).sort(), ["1", "2", "4", "5"]);
assert.deepStrictEqual(d[1].exercises[0].alts, ["Bench Press (Dumbbell)", "Bench Press (Machine)"]);
assert.deepStrictEqual(d[2].exercises[0].alts, ["Single-Arm Row (Dumbbell)", "T-Bar Row"]);
assert.strictEqual(d[2].exercises[0].name, "Bent Over Row (Barbell)");
assert.strictEqual(d[5].exercises.length, 1, "stops before training info");

// CSV
r = P.parsePlanFromText(fx("plan.csv"), "plan.csv");
d = r.plan.days;
assert.deepStrictEqual(Object.keys(d).sort(), ["1", "4"]);
assert.strictEqual(d[1].name, "Upper");
assert.strictEqual(d[1].exercises.length, 2);
assert.deepStrictEqual(d[1].exercises[0].alts, ["DB Bench", "Machine Press"]);
assert.strictEqual(d[4].exercises[0].scheme, "3 × 5");

// Free-form notes
r = P.parsePlanFromText(fx("freeform.txt"), "notes.txt");
d = r.plan.days;
assert.strictEqual(r.plan.name, "My summer plan");
assert.strictEqual(d[1].name, "Push day");
assert.strictEqual(d[1].exercises[0].scheme, "3 × 10");
assert.strictEqual(d[2].name, "Cardio", JSON.stringify(d));
assert.strictEqual(d[2].exercises[0].scheme, "1 × 30 min");
assert.strictEqual(d[3].name, "Leg day");

// JSON round trip + editor line round trip
const json = JSON.stringify({ workoutPlan: P.parsePlanFromText(fx("gainz-docs-export.md"), "g.md").plan });
r = P.parsePlanFromText(json, "export.json");
assert.strictEqual(r.summary.exercises, 18);
const e = d[1].exercises[0];
const line = P.formatExerciseLine({ name: "Lateral Raise (Dumbbell)", scheme: "3 × 8–12", note: "drop set", alts: ["Cable Lateral (Cable, single)", "Band"] });
const back = P.parseEditorLine(line);
assert.deepStrictEqual(back, { name: "Lateral Raise (Dumbbell)", scheme: "3 × 8–12", note: "drop set", alts: ["Cable Lateral (Cable, single)", "Band"] });
assert.deepStrictEqual(P.parseEditorLine("Stretching"), { name: "Stretching", scheme: "", note: "", alts: [] });

// Nothing recognizable
r = P.parsePlanFromText("hello world", "x.txt");
assert.strictEqual(r.summary.days, 0);
assert.ok(r.warnings.length);
console.log("parser tests passed");
