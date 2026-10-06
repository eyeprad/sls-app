/* ------------------------------------------------------------------
   SLS plan import — turns a workout plan written by a human (PDF,
   Google Doc export, plain text, Markdown, CSV, or SLS JSON) into the
   app's plan shape. The parser is deliberately forgiving: it looks for
   day headings ("Day One (Push):", "Monday – Upper", "Legs day:") and
   exercise lines that carry a sets × reps scheme ("Squat 3 x 8-12").
   Pure functions only, so it runs in the browser and under Node tests.
------------------------------------------------------------------ */
(function (root) {
  "use strict";

  var NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
  var WEEKDAY_WORDS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

  // "4 x 6-8", "3×8–12", "3 sets x 10", "3 sets of 10 reps", "3 x 30-60s"
  var SCHEME_RE = /(\d{1,2})\s*(?:sets?\s*)?(?:[x×*]|sets?\s+of)\s*(\d{1,3}(?:\s*(?:-|–|—|to)\s*\d{1,3})?)\s*(reps?|s\b|sec(?:onds?)?\b|min(?:utes?)?\b)?/i;
  var DAY_RE = /^(?:day\s*(\d{1,2}|one|two|three|four|five|six|seven|first|second|third|fourth|fifth|sixth|seventh)|(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat))\b\s*(.*)$/i;
  var STOP_RE = /^(important|notes?|training info|tips|faq|how to|instructions|rep ranges?|rest between)\b/i;

  function decodeEntities(text) {
    return String(text)
      .replace(/&#10;|&#x0?a;/gi, "\n")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\\([\\*_!#.\-()[\]|])/g, "$1")
      .replace(/\*\*|__|\*|`/g, "")
      .replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, "")
      .replace(/^[\s#>|]+/, "")
      .replace(/[\s|]+$/, "")
      .replace(/^(?:\d{1,2}[.)]|[-•–·▪◦])\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function prettyScheme(sets, reps, unit) {
    var r = String(reps).replace(/\s*(?:-|–|—|to)\s*/, "–");
    var u = unit ? String(unit).toLowerCase() : "";
    if (/^s|^sec/.test(u)) u = "s";
    else if (/^min/.test(u)) u = " min";
    else u = "";
    return sets + " × " + r + u;
  }

  function splitAlts(text) {
    return String(text || "")
      .split(/\n|;|\s[-•–]\s|^\s*[-•]\s*/)
      .map(cleanText)
      .map(function (s) { return s.replace(/^(?:alt(?:ernatives?)?|or)\s*:\s*/i, ""); })
      .filter(function (s) { return s && s.length > 1 && !/^alternative exercises$/i.test(s); });
  }

  // Parse one exercise from a single line of text, or null if it has no scheme.
  function parseExerciseLine(raw) {
    var line = decodeEntities(raw);
    var altSection = "";
    var altMatch = /\|\s*alt(?:ernatives?)?\s*:/i.exec(line);
    if (altMatch) {
      altSection = line.slice(altMatch.index + altMatch[0].length);
      line = line.slice(0, altMatch.index);
    }
    var cells = line.indexOf("|") !== -1 ? line.split("|").map(function (c) { return c.trim(); }).filter(Boolean) : [line];
    for (var i = 0; i < cells.length; i++) {
      var cell = cleanText(cells[i]);
      var m = SCHEME_RE.exec(cell);
      if (!m) continue;
      var before = cell.slice(0, m.index);
      var nameParts = cells.slice(0, i).map(cleanText).filter(Boolean);
      if (before.trim()) nameParts.push(before);
      var name = cleanText(nameParts.join(" ")).replace(/[\s:–—\-·,]+$/, "").trim();
      if (!name || name.length > 80 || /^(example|e\.g|sets|reps)\b/i.test(name) || /:$/.test(name)) return null;
      var after = cell.slice(m.index + m[0].length);
      var note = "";
      var noteMatch = /^\s*[—–\-·]?\s*\(([^)]*)\)/.exec(after);
      if (noteMatch) { note = noteMatch[1]; after = after.slice(noteMatch[0].length); }
      else {
        var labeled = /^\s*[—–\-·]\s*note:\s*([^|]*)/i.exec(after);
        if (labeled) { note = labeled[1]; after = after.slice(labeled[0].length); }
      }
      var altText = cells.slice(i + 1).join("\n") + "\n" + after + "\n" + altSection.replace(/;/g, "\n");
      return {
        name: name,
        scheme: prettyScheme(m[1], m[2], m[3]),
        note: cleanText(note).replace(/!+$/, "").trim(),
        alts: splitAlts(altText)
      };
    }
    return null;
  }

  function dayHeading(line) {
    var text = cleanText(decodeEntities(line).split("|")[0]);
    if (!text || text.length > 60 || SCHEME_RE.test(text)) return null;
    var m = DAY_RE.exec(text);
    if (m) {
      var number = m[1] ? (NUMBER_WORDS[m[1].toLowerCase()] || parseInt(m[1], 10)) : null;
      var weekday = m[2] ? WEEKDAY_WORDS[m[2].toLowerCase()] : null;
      var rest = m[3] || "";
      var paren = /\(([^)]+)\)/.exec(rest);
      var name = paren ? paren[1] : rest.replace(/^[\s:–—\-·.]+/, "").replace(/[:.\s]+$/, "");
      var isRest = /^rest\b|\brest day\b|^off\b/i.test(name);
      return { number: number, weekday: weekday, name: isRest ? "" : cleanText(name), rest: isRest, explicit: true };
    }
    // "Push Day:", "Upper A:", "LEGS" — short label lines ending with a colon.
    if (/:$/.test(text) && text.length <= 40 && !/[.?!]/.test(text.slice(0, -1))) {
      var label = text.replace(/:$/, "").trim();
      return { number: null, weekday: null, name: label, rest: /^rest\b/i.test(label), explicit: false };
    }
    return null;
  }

  // Free text (PDF text, Docs export, Markdown, notes) → draft plan.
  function parsePlanText(text, fallbackName) {
    // Split on real line breaks first so "&#10;" inside a table cell stays inside its row.
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var days = [];
    var current = null;
    var lastExercise = null;
    var title = "";
    var warnings = [];

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var clean = cleanText(raw);
      if (!clean || /^:?-{2,}:?$/.test(clean.replace(/[|\s]/g, ""))) continue;
      if (days.length && STOP_RE.test(clean)) break;

      var heading = dayHeading(raw);
      if (heading) {
        if (!heading.explicit && !days.length && !title) title = heading.name;
        current = { number: heading.number, weekday: heading.weekday, name: heading.name, rest: heading.rest, explicit: heading.explicit, exercises: [] };
        days.push(current);
        lastExercise = null;
        continue;
      }

      var exercise = parseExerciseLine(raw);
      if (exercise) {
        if (!current) {
          current = { number: null, weekday: null, name: "Workout", rest: false, explicit: false, exercises: [] };
          days.push(current);
        }
        current.exercises.push(exercise);
        lastExercise = exercise;
        continue;
      }

      // Bulleted lines right after an exercise are its alternatives (table cells in PDFs wrap this way).
      if (lastExercise && /^\s*[-•–]\s+/.test(decodeEntities(raw)) && clean.length <= 70) {
        lastExercise.alts.push(clean);
        continue;
      }
      if (!title && !days.length && clean.length <= 60) title = clean.replace(/:$/, "");
    }

    // Keep explicit day headings (training or rest) to preserve order; drop empty label-only blocks.
    var kept = days.filter(function (d) { return d.exercises.length || (d.explicit && (d.rest || d.name)); });
    var training = kept.filter(function (d) { return !d.rest && (d.exercises.length || d.name); });
    if (!training.length) warnings.push("No exercises with sets × reps were found. Try pasting the text, or use one line per exercise like “Squat — 3 x 8-12”.");

    // Weekday assignment: explicit weekdays win; otherwise Day 1 = Monday, in order.
    var used = {};
    kept.forEach(function (d) { if (d.weekday !== null && d.weekday !== undefined) used[d.weekday] = true; });
    var sequence = [1, 2, 3, 4, 5, 6, 0];
    var cursor = 0;
    kept.forEach(function (d) {
      if (d.weekday !== null && d.weekday !== undefined) return;
      if (d.number) { d.weekday = sequence[(d.number - 1) % 7]; return; }
      while (cursor < 7 && used[sequence[cursor]]) cursor++;
      d.weekday = cursor < 7 ? sequence[cursor] : null;
      if (d.weekday !== null) used[d.weekday] = true;
      cursor++;
    });

    var plan = { name: title || fallbackName || "Imported plan", days: {}, backups: [], extras: [], extrasCount: false, minimum: "" };
    var unplaced = 0;
    training.forEach(function (d) {
      if (d.weekday === null || d.weekday === undefined || plan.days[d.weekday]) { unplaced++; return; }
      plan.days[d.weekday] = { name: d.name || "Workout", time: "", location: "", note: "", exercises: d.exercises };
    });
    if (unplaced) warnings.push(unplaced + " workout day(s) could not be placed on a free weekday. Assign them in the editor.");

    return {
      plan: plan,
      summary: { days: Object.keys(plan.days).length, exercises: training.reduce(function (n, d) { return n + d.exercises.length; }, 0) },
      warnings: warnings
    };
  }

  function parseCsv(text) {
    var rows = [];
    var row = [], field = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }

  // CSV with a header row: day, workout/name, exercise, sets, reps (or scheme), alternatives, time, location.
  function parsePlanCsv(text, fallbackName) {
    var rows = parseCsv(String(text || ""));
    if (rows.length < 2) return parsePlanText(text, fallbackName);
    var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    function col(names) { for (var i = 0; i < header.length; i++) if (names.indexOf(header[i]) !== -1) return i; return -1; }
    var cDay = col(["day", "weekday"]), cWorkout = col(["workout", "session", "name", "split"]), cEx = col(["exercise", "movement", "lift"]);
    var cSets = col(["sets"]), cReps = col(["reps", "rep range"]), cScheme = col(["scheme", "sets x reps", "prescription"]);
    var cAlts = col(["alternatives", "alts", "alternative exercises", "substitutes"]), cTime = col(["time"]), cLoc = col(["location", "place"]);
    if (cEx === -1) return parsePlanText(rows.map(function (r) { return r.join(" | "); }).join("\n"), fallbackName);

    var lines = [];
    var lastDay = null;
    rows.slice(1).forEach(function (r) {
      var dayLabel = cDay !== -1 ? r[cDay].trim() : "";
      var workout = cWorkout !== -1 ? r[cWorkout].trim() : "";
      var key = dayLabel + "|" + workout;
      if (key !== lastDay && (dayLabel || workout)) {
        var heading = dayLabel ? (/^(day|\w+day$|mon|tue|wed|thu|fri|sat|sun)/i.test(dayLabel) ? dayLabel : "Day " + dayLabel) : "Day";
        lines.push(heading + (workout ? " (" + workout + ")" : "") + ":");
        lastDay = key;
      }
      var scheme = cScheme !== -1 ? r[cScheme] : (cSets !== -1 && cReps !== -1 ? r[cSets] + " x " + r[cReps] : "");
      var alts = cAlts !== -1 ? r[cAlts].split(/[;\/]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
      lines.push(r[cEx].trim() + " — " + scheme + (alts.length ? " | alt: " + alts.join("; ") : ""));
    });
    var result = parsePlanText(lines.join("\n"), fallbackName);
    if (cTime !== -1 || cLoc !== -1) {
      var firstRow = rows[1];
      Object.keys(result.plan.days).forEach(function (k) {
        if (cTime !== -1) result.plan.days[k].time = firstRow[cTime].trim();
        if (cLoc !== -1) result.plan.days[k].location = firstRow[cLoc].trim();
      });
    }
    return result;
  }

  // SLS export / plan JSON.
  function parsePlanJson(text, fallbackName) {
    var data = JSON.parse(text);
    var plan = data && data.settings && data.settings.workoutPlan ? data.settings.workoutPlan : data && data.workoutPlan ? data.workoutPlan : data;
    if (!plan || typeof plan !== "object" || !plan.days) throw new Error("This JSON file doesn't contain a workout plan.");
    var days = {};
    if (Array.isArray(plan.days)) {
      plan.days.forEach(function (d, index) {
        var weekday = typeof d.day === "number" ? d.day : WEEKDAY_WORDS[String(d.day || "").toLowerCase()];
        if (weekday === undefined) weekday = [1, 2, 3, 4, 5, 6, 0][index % 7];
        days[weekday] = d;
      });
    } else days = plan.days;
    var normalized = normalizePlan({ name: plan.name || fallbackName, days: days, backups: plan.backups, extras: plan.extras, extrasCount: plan.extrasCount, minimum: plan.minimum });
    var count = 0;
    Object.keys(normalized.days).forEach(function (k) { count += normalized.days[k].exercises.length; });
    return { plan: normalized, summary: { days: Object.keys(normalized.days).length, exercises: count }, warnings: [] };
  }

  function normalizeExercise(value) {
    if (typeof value === "string") return parseExerciseLine(value) || { name: cleanText(value), scheme: "", note: "", alts: [] };
    if (!value || typeof value !== "object") return null;
    return {
      name: String(value.name || "").trim(),
      scheme: String(value.scheme || (value.sets && value.reps ? prettyScheme(value.sets, value.reps) : "")).trim(),
      note: String(value.note || "").trim(),
      alts: Array.isArray(value.alts) ? value.alts.map(String).filter(Boolean) : []
    };
  }

  function normalizePlan(plan) {
    plan = plan && typeof plan === "object" ? plan : {};
    var days = {};
    var source = plan.days && typeof plan.days === "object" ? plan.days : {};
    Object.keys(source).forEach(function (key) {
      var weekday = parseInt(key, 10);
      var d = source[key];
      if (!(weekday >= 0 && weekday <= 6) || !d || typeof d !== "object") return;
      var exercises = Array.isArray(d.exercises) ? d.exercises.map(normalizeExercise).filter(function (e) { return e && e.name; }) : [];
      var name = String(d.name || "").trim();
      var note = String(d.note || "").trim();
      if (!name && !exercises.length && !note) return;
      days[weekday] = { name: name || (exercises.length ? "Workout" : ""), time: String(d.time || "").trim(), location: String(d.location || "").trim(), note: note, exercises: exercises };
    });
    var extras = Array.isArray(plan.extras) ? plan.extras.filter(function (e) { return e && e.name; }).map(function (e, i) {
      var weekday = typeof e.day === "number" ? e.day : WEEKDAY_WORDS[String(e.day || "").toLowerCase()];
      return { id: String(e.id || "extra" + i), day: weekday >= 0 && weekday <= 6 ? weekday : 1, name: String(e.name), time: String(e.time || ""), location: String(e.location || "") };
    }) : [];
    return {
      name: String(plan.name || "My plan").trim() || "My plan",
      days: days,
      backups: Array.isArray(plan.backups) ? plan.backups.map(function (b) { return String(b).trim(); }).filter(Boolean) : [],
      extras: extras,
      extrasCount: Boolean(plan.extrasCount),
      minimum: String(plan.minimum || "").trim()
    };
  }

  // Entry point used by the app: pick a parser by file name / content.
  function parsePlanFromText(text, fileName) {
    var base = String(fileName || "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
    var trimmed = String(text || "").trim();
    var result;
    if (/\.json$/i.test(fileName || "") || /^[{[]/.test(trimmed)) {
      try { result = parsePlanJson(trimmed, base); } catch (e) { if (/\.json$/i.test(fileName || "")) throw e; }
    }
    if (!result && /\.csv$/i.test(fileName || "")) result = parsePlanCsv(trimmed, base);
    if (!result) result = parsePlanText(trimmed, base);
    result.plan = normalizePlan(result.plan);
    if (base && (!result.plan.name || result.plan.name === "Imported plan")) result.plan.name = base;
    return result;
  }

  // Editor round-trip: "Bench Press (Barbell) — 4 × 6–8 — note: drop set | alt: A; B"
  function formatExerciseLine(e) {
    var line = e.name;
    if (e.scheme) line += " — " + e.scheme;
    if (e.note) line += " — note: " + e.note;
    if (e.alts && e.alts.length) line += " | alt: " + e.alts.join("; ");
    return line;
  }

  function parseEditorLine(line) {
    var text = String(line || "").trim();
    if (!text) return null;
    var parsed = parseExerciseLine(text);
    if (parsed) return parsed;
    var altIndex = text.search(/\|\s*alt(?:ernatives?)?\s*:/i);
    var name = altIndex === -1 ? text : text.slice(0, altIndex);
    var alts = altIndex === -1 ? [] : text.slice(altIndex).replace(/^\|\s*alt(?:ernatives?)?\s*:/i, "").split(";").map(function (s) { return s.trim(); }).filter(Boolean);
    var noteSplit = name.split(/\s+[—–-]\s+note:\s*/i);
    return { name: cleanText(noteSplit[0]).replace(/[\s—–-]+$/, ""), scheme: "", note: (noteSplit[1] || "").trim(), alts: alts };
  }

  var api = {
    parsePlanFromText: parsePlanFromText,
    parsePlanText: parsePlanText,
    parsePlanCsv: parsePlanCsv,
    parsePlanJson: parsePlanJson,
    parseExerciseLine: parseExerciseLine,
    normalizePlan: normalizePlan,
    formatExerciseLine: formatExerciseLine,
    parseEditorLine: parseEditorLine
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SLSPlanImport = api;
})(this);
