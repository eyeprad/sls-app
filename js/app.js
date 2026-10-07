/* ------------------------------------------------------------------
   SLS — Single Life System.
   A system of systems: each life area a user turns on gets a small
   daily checklist, the Fitness area runs their own workout plan, and
   the scorecard keeps everything honest with "never miss twice".
   Supabase is the durable cross-device record; localStorage is an
   offline cache so the app opens instantly.
------------------------------------------------------------------ */
(function () {
  "use strict";

  var Catalog = window.SLSCatalog;
  var PlanImport = window.SLSPlanImport;

  var STORE_KEY = "sls.state.v1";
  var LAST_EMAIL_KEY = "sls.lastEmail";
  var SUPABASE_URL = "https://dflahjxwxqxsqwrjnhrc.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vk7SYGrhku7CVPQdJZU07w_PAJsdmV_";
  var PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  var RESEND_SECONDS = 60;

  var AREAS = Catalog.AREAS;
  var WEEK = Catalog.WEEK;
  var WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function areaDef(key) { return AREAS.filter(function (a) { return a.key === key; })[0]; }
  function appUrl() { return window.location.origin + window.location.pathname; }

  /* ---------------- date helpers ---------------- */

  function localIso(date) {
    date = date || new Date();
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function fromIso(value) {
    var parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  function addDays(value, amount) {
    var date = fromIso(value);
    date.setDate(date.getDate() + amount);
    return localIso(date);
  }

  function mondayOf(value) {
    var date = fromIso(value);
    var day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return localIso(date);
  }

  function weekdayOf(value) { return fromIso(value).getDay(); }

  function dayTitle(date) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(fromIso(date));
  }

  /* ---------------- settings model ---------------- */

  function cleanPractice(p, index) {
    if (!p || typeof p !== "object" || !String(p.label || "").trim()) return null;
    return { id: String(p.id || "p" + index).slice(0, 40), label: String(p.label).trim().slice(0, 80), detail: String(p.detail || "").trim().slice(0, 140) };
  }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var rawAreas = raw.areas && typeof raw.areas === "object" ? raw.areas : {};
    var areas = {};
    AREAS.forEach(function (area) {
      var d = area.defaults || { practices: [], allowMinimum: true, daysPerWeek: 7 };
      var src = rawAreas[area.key] && typeof rawAreas[area.key] === "object" ? rawAreas[area.key] : {};
      var practices = Array.isArray(src.practices) ? src.practices.map(cleanPractice).filter(Boolean) : Catalog.clone(d.practices);
      var days = parseInt(src.daysPerWeek, 10);
      areas[area.key] = {
        enabled: src.enabled === undefined ? area.key === "fitness" : Boolean(src.enabled),
        practices: practices,
        allowMinimum: src.allowMinimum === undefined ? Boolean(d.allowMinimum) : Boolean(src.allowMinimum),
        daysPerWeek: days >= 1 && days <= 7 ? days : d.daysPerWeek
      };
    });
    return {
      version: 2,
      onboarded: Boolean(raw.onboarded),
      anchorArea: typeof raw.anchorArea === "string" ? raw.anchorArea : "",
      areas: areas,
      workoutPlan: PlanImport.normalizePlan(raw.workoutPlan || Catalog.templatePlan("full-body-3"))
    };
  }

  // Accounts that used the original single-plan app keep exactly what they had.
  function legacySettings(practiceLabels) {
    var labels = practiceLabels && typeof practiceLabels === "object" ? practiceLabels : {};
    function lp(area, id, fallback) { return { id: id, label: labels[area + "." + id] || fallback, detail: "" }; }
    return normalizeSettings({
      onboarded: false,
      anchorArea: "spiritual",
      workoutPlan: Catalog.templatePlan("sls-ppl"),
      areas: {
        fitness: { enabled: true },
        spiritual: { enabled: true, allowMinimum: true, daysPerWeek: 7, practices: [{ id: "prayer", label: "Morning prayer", detail: "6:45–7 AM anchor · car worship + Bible at work complete it" }] },
        nutrition: { enabled: true, allowMinimum: false, daysPerWeek: 7, practices: [lp("nutrition", "protein", "Hit protein goal"), lp("nutrition", "water", "Drank enough water")] },
        "health-recovery": { enabled: true, allowMinimum: false, daysPerWeek: 7, practices: [lp("health-recovery", "sleep", "7+ hours of sleep"), lp("health-recovery", "bedtime", "In bed by 11 PM")] },
        "career-purpose": { enabled: true, allowMinimum: false, daysPerWeek: 7, practices: [lp("career-purpose", "deep_work", "Deep work block"), lp("career-purpose", "goal_progress", "Moved my main goal forward")] }
      }
    });
  }

  /* ---------------- local store ---------------- */

  var store = (function () {
    var data;
    var activeUserId = "";
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch (e) { data = null; }
    if (!data || typeof data !== "object") data = {};
    if (!data.settings || typeof data.settings !== "object") data.settings = {};
    if (!data.logs || typeof data.logs !== "object") data.logs = {};
    if (!data.accountLogs || typeof data.accountLogs !== "object") data.accountLogs = {};
    if (!data.accountSettings || typeof data.accountSettings !== "object") data.accountSettings = {};
    if (!data.settings.supabaseImportedUsers || typeof data.settings.supabaseImportedUsers !== "object") data.settings.supabaseImportedUsers = {};
    if (!data.settings.dirtySettings || typeof data.settings.dirtySettings !== "object") data.settings.dirtySettings = {};
    // The Notion token from the first version is no longer used; don't keep a secret around.
    delete data.settings.notionToken;

    function persist() {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* storage full/blocked — app still works in-memory */ }
    }
    function currentLogs() {
      if (!activeUserId) return data.logs;
      if (!data.accountLogs[activeUserId]) data.accountLogs[activeUserId] = {};
      return data.accountLogs[activeUserId];
    }
    return {
      get meta() { return data.settings; },
      get logs() { return currentLogs(); },
      get legacyLogs() { return data.logs; },
      get userId() { return activeUserId; },
      setActiveUser: function (userId) { activeUserId = userId || ""; persist(); },
      cachedSettings: function () { return activeUserId && data.accountSettings[activeUserId] ? normalizeSettings(data.accountSettings[activeUserId]) : null; },
      setSettings: function (settings, dirty) {
        if (!activeUserId) return;
        data.accountSettings[activeUserId] = settings;
        if (dirty !== undefined) data.settings.dirtySettings[activeUserId] = Boolean(dirty);
        persist();
      },
      settingsDirty: function () { return Boolean(activeUserId && data.settings.dirtySettings[activeUserId]); },
      rawLog: function (date) { return currentLogs()[date]; },
      saveLog: function (log) { currentLogs()[log.date] = log; persist(); },
      clearUser: function (userId) { delete data.accountLogs[userId]; delete data.accountSettings[userId]; delete data.settings.dirtySettings[userId]; persist(); },
      persist: persist
    };
  })();

  var settings = normalizeSettings(null);
  function S() { return settings; }

  /* ---------------- daily log model ---------------- */

  function blankLog(date) {
    return { date: date, workoutStatus: "none", workoutDetail: "", extras: {}, practices: {}, reflection: "", updatedAt: "", cloudSyncStatus: "", cloudSyncMessage: "" };
  }

  function cleanPracticeMap(value) {
    var out = {};
    if (!value || typeof value !== "object") return out;
    Object.keys(value).forEach(function (areaKey) {
      if (areaKey.charAt(0) === "_") return;
      var src = value[areaKey];
      if (!src || typeof src !== "object") return;
      var area = {};
      Object.keys(src).forEach(function (id) {
        var v = src[id];
        if (v === "min") area[id] = "min";
        else if (v === true || v === "done") area[id] = true;
      });
      if (Object.keys(area).length) out[areaKey] = area;
    });
    return out;
  }

  function firstSpiritualId() {
    var cfg = S().areas.spiritual;
    return cfg && cfg.practices[0] ? cfg.practices[0].id : "prayer";
  }

  // Reads both the current shape and the first app version's shape (spiritualStatus / yogaDone).
  function upgradeLog(raw, date) {
    var log = blankLog(date);
    if (!raw || typeof raw !== "object") return log;
    log.workoutStatus = ["lift", "class", "minimum"].indexOf(raw.workoutStatus) !== -1 ? raw.workoutStatus : "none";
    log.workoutDetail = String(raw.workoutDetail || "");
    log.reflection = String(raw.reflection || "");
    log.updatedAt = String(raw.updatedAt || "");
    log.cloudSyncStatus = String(raw.cloudSyncStatus || "");
    log.cloudSyncMessage = String(raw.cloudSyncMessage || "");
    log.practices = cleanPracticeMap(raw.practices);
    log.extras = {};
    if (raw.extras && typeof raw.extras === "object") Object.keys(raw.extras).forEach(function (k) { if (raw.extras[k]) log.extras[k] = true; });
    if (raw.yogaDone) log.extras.yoga = true;
    if (raw.spiritualStatus && raw.spiritualStatus !== "none" && !log.practices.spiritual) {
      log.practices.spiritual = {};
      log.practices.spiritual[firstSpiritualId()] = raw.spiritualStatus === "minimum" ? "min" : true;
    }
    return log;
  }

  function getLog(date) { return upgradeLog(store.rawLog(date), date); }
  function logAt(logs, date) { return logs[date] ? upgradeLog(logs[date], date) : null; }

  function practiceState(log, areaKey, practiceId) {
    var v = log && log.practices[areaKey] ? log.practices[areaKey][practiceId] : undefined;
    return v === "min" ? "min" : v ? "done" : "";
  }

  // "" (not done), "done", or "min" (done, at least partly as a minimum).
  function areaState(log, key) {
    if (!log) return "";
    if (key === "fitness") return log.workoutStatus === "minimum" ? "min" : log.workoutStatus !== "none" ? "done" : "";
    var cfg = S().areas[key];
    if (!cfg || !cfg.practices.length) return "";
    var states = cfg.practices.map(function (p) { return practiceState(log, key, p.id); });
    if (states.some(function (s) { return !s; })) return "";
    return states.indexOf("min") !== -1 ? "min" : "done";
  }

  function logHasHistory(log) {
    if (!log) return false;
    return log.workoutStatus !== "none" || Object.keys(log.practices).length > 0 || Object.keys(log.extras).length > 0 || Boolean(String(log.reflection || "").trim());
  }

  // Days before someone's first check-in aren't "misses" — they hadn't started yet.
  function firstLogDate(logs) {
    var dates = Object.keys(logs).filter(function (d) { return logHasHistory(upgradeLog(logs[d], d)); }).sort();
    return dates[0] || today;
  }

  function enabledPracticeAreas() {
    return AREAS.filter(function (a) { return a.kind === "practices" && S().areas[a.key].enabled; });
  }

  function fitnessOn() { return S().areas.fitness.enabled; }

  /* ---------------- plan helpers ---------------- */

  function planDay(weekday) {
    var d = S().workoutPlan.days[weekday];
    return d && d.name ? d : null;
  }

  function trainingWeekdays() {
    return [1, 2, 3, 4, 5, 6, 0].filter(function (w) { return Boolean(planDay(w)); });
  }

  function extrasFor(weekday) {
    return S().workoutPlan.extras.filter(function (e) { return e.day === weekday; });
  }

  function workoutTarget() {
    var plan = S().workoutPlan;
    return Math.max(1, trainingWeekdays().length + (plan.extrasCount ? plan.extras.length : 0));
  }

  function workoutsOn(log) {
    if (!log) return 0;
    var n = log.workoutStatus !== "none" ? 1 : 0;
    if (S().workoutPlan.extrasCount) n += extrasFor(weekdayOf(log.date)).filter(function (e) { return log.extras[e.id]; }).length;
    return n;
  }

  function workoutsInWeek(logs, start) {
    var n = 0;
    for (var i = 0; i < 7; i++) n += workoutsOn(logAt(logs, addDays(start, i)));
    return n;
  }

  /* ---------------- streak math ---------------- */

  function dayStreak(logs, todayValue, completed) {
    var cursor = completed(todayValue) ? todayValue : addDays(todayValue, -1);
    var current = 0;
    while (completed(cursor) && current < 1000) { current += 1; cursor = addDays(cursor, -1); }
    var best = 0, run = 0, prior = "";
    Object.keys(logs).filter(completed).sort().forEach(function (date) {
      run = prior && addDays(prior, 1) === date ? run + 1 : 1;
      best = Math.max(best, run);
      prior = date;
    });
    return { current: current, best: Math.max(best, current), unit: "days" };
  }

  function weekStreak(logs, todayValue, weekOk) {
    var starts = {};
    Object.keys(logs).forEach(function (date) { starts[mondayOf(date)] = true; });
    starts[mondayOf(todayValue)] = true;
    var best = 0, run = 0, prev = "";
    Object.keys(starts).sort().forEach(function (start) {
      var ok = weekOk(start);
      run = ok ? (prev && addDays(prev, 7) === start ? run + 1 : 1) : 0;
      if (ok) prev = start;
      best = Math.max(best, run);
    });
    var cursor = mondayOf(todayValue);
    if (!weekOk(cursor)) cursor = addDays(cursor, -7);
    var current = 0;
    while (weekOk(cursor) && current < 520) { current += 1; cursor = addDays(cursor, -7); }
    return { current: current, best: Math.max(best, current), unit: "wks" };
  }

  function areaDaysInWeek(logs, key, start) {
    var n = 0;
    for (var i = 0; i < 7; i++) if (areaState(logAt(logs, addDays(start, i)), key)) n++;
    return n;
  }

  function areaStreak(logs, key) {
    if (key === "fitness") {
      var target = workoutTarget();
      return weekStreak(logs, today, function (start) { return workoutsInWeek(logs, start) >= target; });
    }
    var cfg = S().areas[key];
    if (cfg.daysPerWeek >= 7) return dayStreak(logs, today, function (date) { return Boolean(areaState(logAt(logs, date), key)); });
    return weekStreak(logs, today, function (start) { return areaDaysInWeek(logs, key, start) >= cfg.daysPerWeek; });
  }

  function anchorAreaKey() {
    var key = S().anchorArea;
    var enabled = enabledPracticeAreas();
    if (enabled.some(function (a) { return a.key === key; })) return key;
    return enabled[0] ? enabled[0].key : "";
  }

  /* ---------------- Supabase rows ---------------- */

  function isMissingColumn(error, column) {
    var message = String(error && error.message || "").toLowerCase();
    var code = String(error && error.code || "");
    return (code === "PGRST204" || code === "42703" || message.indexOf("schema cache") !== -1 || message.indexOf("does not exist") !== -1) && message.indexOf(column.toLowerCase()) !== -1;
  }

  function logToRow(log, profileId, includePractices) {
    var spiritual = areaState(log, "spiritual");
    var workoutDone = log.workoutStatus !== "none";
    var row = {
      profile_id: profileId,
      log_date: log.date,
      day_label: dayTitle(log.date),
      spiritual_done: Boolean(spiritual),
      spiritual_minimum: spiritual === "min",
      workout_done: workoutDone,
      workout_minimum: log.workoutStatus === "minimum",
      workout_type: log.workoutStatus === "lift" || log.workoutStatus === "class" ? log.workoutStatus : null,
      workout_notes: workoutDone ? (log.workoutDetail || null) : null,
      yoga_done: Object.keys(log.extras).length > 0,
      gratitude: log.reflection || "",
      updated_at: log.updatedAt || new Date().toISOString()
    };
    if (includePractices !== false) row.practices = Object.assign({}, log.practices, { _extras: log.extras });
    return row;
  }

  function rowToLog(row) {
    var raw = {
      workoutStatus: row.workout_minimum ? "minimum" : row.workout_done && (row.workout_type === "lift" || row.workout_type === "class") ? row.workout_type : row.workout_done ? "minimum" : "none",
      workoutDetail: row.workout_notes || "",
      reflection: row.gratitude || "",
      practices: row.practices || {},
      extras: row.practices && row.practices._extras ? row.practices._extras : (row.yoga_done ? { yoga: true } : {}),
      updatedAt: row.updated_at || "",
      cloudSyncStatus: "synced"
    };
    if (!row.practices || !row.practices.spiritual) raw.spiritualStatus = row.spiritual_minimum ? "minimum" : row.spiritual_done ? "done" : "none";
    return upgradeLog(raw, row.log_date);
  }

  /* ---------------- Supabase sync ---------------- */

  var supabaseClient = null;
  var cloud = { settingsColumn: true, practicesColumn: true, syncing: false, lastSyncedAt: "", error: "" };

  function signedInUserId() { return authState.session && authState.session.user ? authState.session.user.id : ""; }

  function upsertLog(log) {
    var userId = signedInUserId();
    if (!supabaseClient || !userId) return Promise.resolve({ status: "offline" });
    return supabaseClient.from("daily_logs").upsert(logToRow(log, userId, cloud.practicesColumn), { onConflict: "profile_id,log_date" }).then(function (result) {
      if (!result.error) return { status: "synced" };
      if (!isMissingColumn(result.error, "practices")) throw result.error;
      cloud.practicesColumn = false;
      return supabaseClient.from("daily_logs").upsert(logToRow(log, userId, false), { onConflict: "profile_id,log_date" }).then(function (fallback) {
        if (fallback.error) throw fallback.error;
        return { status: "synced", message: "Area check-offs are saved on this device until the database update is run." };
      });
    }).catch(function (error) {
      return { status: "error", message: error && error.message ? error.message : "Cloud sync failed." };
    });
  }

  function fetchAllDailyLogs(userId, offset, collected) {
    offset = offset || 0;
    collected = collected || [];
    var columns = "log_date,spiritual_done,spiritual_minimum,workout_done,workout_minimum,workout_type,workout_notes,yoga_done,gratitude,updated_at" + (cloud.practicesColumn ? ",practices" : "");
    return supabaseClient.from("daily_logs").select(columns).eq("profile_id", userId).order("log_date", { ascending: true }).range(offset, offset + 999).then(function (result) {
      if (result.error && cloud.practicesColumn && isMissingColumn(result.error, "practices") && offset === 0) {
        cloud.practicesColumn = false;
        return fetchAllDailyLogs(userId, 0, []);
      }
      if (result.error) throw result.error;
      var page = Array.isArray(result.data) ? result.data : [];
      var next = collected.concat(page);
      return page.length === 1000 ? fetchAllDailyLogs(userId, offset + 1000, next) : next;
    });
  }

  function fetchProfile(userId) {
    var columns = "id,email,display_name" + (cloud.settingsColumn ? ",settings" : "");
    return supabaseClient.from("profiles").select(columns).eq("id", userId).maybeSingle().then(function (result) {
      if (result.error && cloud.settingsColumn && isMissingColumn(result.error, "settings")) {
        cloud.settingsColumn = false;
        return fetchProfile(userId);
      }
      if (result.error) throw result.error;
      return result.data;
    });
  }

  function upsertProfile(extra) {
    var user = authState.session.user;
    var row = Object.assign({ id: user.id, email: user.email || "", display_name: (authState.profile && authState.profile.display_name) || defaultName(user.email) }, extra || {});
    if (cloud.settingsColumn) row.settings = S();
    return supabaseClient.from("profiles").upsert(row, { onConflict: "id" }).then(function (result) {
      if (!result.error) return row;
      if (!isMissingColumn(result.error, "settings")) throw result.error;
      cloud.settingsColumn = false;
      delete row.settings;
      return supabaseClient.from("profiles").upsert(row, { onConflict: "id" }).then(function (fallback) {
        if (fallback.error) throw fallback.error;
        return row;
      });
    });
  }

  var settingsTimer = null;
  function saveSettings() {
    store.setSettings(S(), true);
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(pushSettings, 500);
  }

  function pushSettings() {
    if (!supabaseClient || !signedInUserId()) return Promise.resolve();
    return upsertProfile().then(function () {
      store.setSettings(S(), !cloud.settingsColumn);
    }).catch(function (error) {
      cloud.error = error && error.message ? error.message : "Could not save settings to the cloud.";
    });
  }

  function defaultName(email) {
    var local = String(email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Friend";
  }

  // Pull profile + history. Cached data is already on screen, so this runs quietly.
  function refreshFromCloud() {
    var user = authState.session.user;
    cloud.syncing = true;
    cloud.error = "";
    var hadCache = Boolean(store.cachedSettings());
    var localLegacy = Object.keys(store.legacyLogs).filter(function (date) { return logHasHistory(upgradeLog(store.legacyLogs[date], date)); });
    return fetchProfile(user.id).then(function (profile) {
      if (!profile) {
        // First sign-in: create the profile without making the user fill in a form.
        settings = hadCache ? store.cachedSettings() : normalizeSettings({ onboarded: false });
        authState.profile = { id: user.id, email: user.email || "", display_name: defaultName(user.email) };
        return upsertProfile().then(function () { store.setSettings(S(), false); });
      }
      authState.profile = profile;
      var cloudSettings = profile.settings && typeof profile.settings === "object" ? profile.settings : null;
      if (store.settingsDirty() && hadCache) {
        settings = store.cachedSettings();
        return pushSettings();
      }
      if (cloudSettings && cloudSettings.version === 2) settings = normalizeSettings(cloudSettings);
      else if (hadCache) settings = store.cachedSettings();
      else {
        settings = legacySettings(cloudSettings && cloudSettings.practice_labels || store.meta.practiceLabels);
        store.setSettings(S(), true);
        return pushSettings();
      }
      store.setSettings(S(), false);
    }).then(function () {
      return fetchAllDailyLogs(user.id);
    }).then(function (rows) {
      var stale = [];
      rows.forEach(function (row) {
        var cloudLog = rowToLog(row);
        var local = store.rawLog(row.log_date);
        if (local && local.updatedAt && row.updated_at && Date.parse(local.updatedAt) > Date.parse(row.updated_at) && local.cloudSyncStatus !== "synced") {
          stale.push(upgradeLog(local, row.log_date));
          return;
        }
        if (!cloud.practicesColumn && local) cloudLog.practices = upgradeLog(local, row.log_date).practices;
        store.saveLog(cloudLog);
      });
      // Local check-ins the cloud never received (offline, closed tab) go up now.
      Object.keys(store.logs).forEach(function (date) {
        var l = store.logs[date];
        if (l && (l.cloudSyncStatus === "pending" || l.cloudSyncStatus === "error")) stale.push(upgradeLog(l, date));
      });
      stale.forEach(queueCloudSync);
      cloud.syncing = false;
      cloud.lastSyncedAt = new Date().toISOString();
      var imported = Boolean(store.meta.supabaseImportedUsers[user.id]);
      ui.importPrompt = rows.length === 0 && localLegacy.length > 0 && !imported;
      if (!S().onboarded) ui.onboarding = true;
    }).catch(function (error) {
      cloud.syncing = false;
      cloud.error = error && error.message ? error.message : "Could not reach your account.";
    });
  }

  var cloudQueue = Promise.resolve();
  var cloudGenerations = {};

  function queueCloudSync(log) {
    if (!signedInUserId()) return;
    var generation = (cloudGenerations[log.date] || 0) + 1;
    cloudGenerations[log.date] = generation;
    cloudQueue = cloudQueue.catch(function () { return null; }).then(function () { return upsertLog(log); });
    cloudQueue.then(function (result) {
      if (cloudGenerations[log.date] !== generation) return;
      var current = getLog(log.date);
      current.cloudSyncStatus = result.status === "synced" ? "synced" : result.status === "offline" ? "pending" : "error";
      current.cloudSyncMessage = result.message || "";
      store.saveLog(current);
      if (log.date === today && currentTab === "today" && authState.phase === "ready") renderSoon();
    });
  }

  function persistAndSync(log) {
    log.updatedAt = new Date().toISOString();
    log.cloudSyncStatus = signedInUserId() ? "pending" : "";
    store.saveLog(log);
    render();
    queueCloudSync(log);
  }

  function importExistingHistory() {
    var userId = signedInUserId();
    if (!userId) return;
    var legacy = store.legacyLogs;
    var logs = Object.keys(legacy).map(function (date) { return upgradeLog(legacy[date], date); }).filter(logHasHistory);
    if (!logs.length) { ui.importPrompt = false; render(); return; }
    ui.importing = true;
    render();
    supabaseClient.from("daily_logs").upsert(logs.map(function (l) { return logToRow(l, userId, cloud.practicesColumn); }), { onConflict: "profile_id,log_date" }).then(function (result) {
      if (result.error) throw result.error;
      logs.forEach(function (l) { l.cloudSyncStatus = "synced"; store.saveLog(l); });
      store.meta.supabaseImportedUsers[userId] = true;
      store.persist();
      ui.importing = false;
      ui.importPrompt = false;
      render();
    }).catch(function (error) {
      ui.importing = false;
      ui.importError = error && error.message ? error.message : "Could not import your history.";
      render();
    });
  }

  /* ---------------- auth ---------------- */

  var authState = {
    phase: "boot",          // boot | signed-out | loading | recovery | ready
    method: "code",         // code | password
    step: "email",          // email | code
    passwordView: "signin", // signin | signup | forgot
    otpType: "email",       // email | signup | recovery
    email: "",
    submitting: false,
    error: "",
    info: "",
    cooldownUntil: 0,
    recoveryPending: false,
    session: null,
    profile: null
  };

  try { authState.email = window.localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch (e) { /* ignore */ }

  function rememberEmail(email) {
    authState.email = email;
    try { window.localStorage.setItem(LAST_EMAIL_KEY, email); } catch (e) { /* ignore */ }
  }

  function friendlyAuthError(error) {
    var message = String(error && error.message || error || "");
    var lower = message.toLowerCase();
    if (lower.indexOf("invalid login credentials") !== -1) return "That email and password don't match. Try again, or use an email code.";
    if (lower.indexOf("expired") !== -1 || lower.indexOf("otp") !== -1 && lower.indexOf("invalid") !== -1 || lower.indexOf("token") !== -1 && lower.indexOf("invalid") !== -1) return "That code is wrong or has expired. Check the newest email, or send a new code.";
    if (lower.indexOf("email not confirmed") !== -1) return "Confirm your email first — use “Email code” to sign in with a code instead.";
    if (lower.indexOf("rate limit") !== -1 || lower.indexOf("security purposes") !== -1 || lower.indexOf("only request this after") !== -1) return "Too many emails in a row. Wait a minute, then try again — the last code still works.";
    if (lower.indexOf("password should be") !== -1 || lower.indexOf("weak") !== -1) return "Choose a longer password (at least 8 characters).";
    if (lower.indexOf("already registered") !== -1) return "That email already has an account. Sign in instead.";
    if (lower.indexOf("code verifier") !== -1 || lower.indexOf("flow state") !== -1 || lower.indexOf("pkce") !== -1) return "That link was opened in a different browser than the one that asked for it. Enter the 6-digit code from the email instead.";
    if (lower.indexOf("failed to fetch") !== -1 || lower.indexOf("network") !== -1) return "Can't reach the server. Check your connection and try again.";
    return message || "Something went wrong. Try again.";
  }

  function readUrlAuthState() {
    var search = new URLSearchParams(window.location.search);
    var hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    var description = search.get("error_description") || hash.get("error_description");
    if (description) {
      var code = search.get("error_code") || hash.get("error_code") || "";
      authState.error = code === "otp_expired" ? "That sign-in link has expired or was already used. Enter the code from your newest email, or send a new one." : friendlyAuthError(description.replace(/\+/g, " "));
      if (authState.email) { authState.step = "code"; authState.method = "code"; }
    }
    return { hadCode: Boolean(search.get("code")), hadError: Boolean(description) };
  }

  function cleanAuthUrl() {
    try {
      var url = new URL(window.location.href);
      ["code", "error", "error_code", "error_description", "type"].forEach(function (k) { url.searchParams.delete(k); });
      var hash = /access_token|error|refresh_token/.test(url.hash) ? "" : url.hash;
      window.history.replaceState({}, document.title, url.pathname + url.search + hash);
    } catch (e) { /* keep the callback URL if the host blocks history changes */ }
  }

  function initializeSupabase() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      authState.phase = "signed-out";
      authState.error = "Sign-in couldn't load. Check your connection and reload.";
      render();
      return;
    }
    var urlState = readUrlAuthState();
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // detectSessionInUrl exchanges ?code= once during init — never exchange it again by hand.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    });
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      // Supabase warns against awaiting its own calls inside this callback; hop off the stack.
      setTimeout(function () { handleAuthEvent(event, session, urlState); }, 0);
    });
  }

  function handleAuthEvent(event, session, urlState) {
    if (event === "INITIAL_SESSION") {
      if (urlState.hadCode || urlState.hadError) cleanAuthUrl();
      if (session) startSession(session);
      else {
        if (urlState.hadCode && !authState.error) {
          authState.error = friendlyAuthError("code verifier");
          if (authState.email) { authState.method = "code"; authState.step = "code"; }
        }
        authState.phase = "signed-out";
        render();
      }
    } else if (event === "PASSWORD_RECOVERY") {
      authState.recoveryPending = true;
      authState.session = session;
      authState.phase = "recovery";
      render();
    } else if (event === "SIGNED_IN") {
      if (session) startSession(session);
    } else if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      if (session) authState.session = session;
    } else if (event === "SIGNED_OUT") {
      authState.session = null;
      authState.profile = null;
      authState.phase = "signed-out";
      authState.step = "email";
      authState.passwordView = "signin";
      authState.otpType = "email";
      authState.submitting = false;
      store.setActiveUser("");
      ui.onboarding = false;
      ui.planDraft = null;
      ui.selectedArea = null;
      ui.message = "";
      currentTab = "today";
      render();
    }
  }

  function startSession(session) {
    // verifyOtp/signIn resolve *and* emit SIGNED_IN; only the first one should start the session.
    var sameUser = authState.session && authState.session.user && authState.session.user.id === session.user.id;
    if (sameUser && ["loading", "ready", "recovery"].indexOf(authState.phase) !== -1) { authState.session = session; return; }
    authState.session = session;
    authState.submitting = false;
    authState.error = "";
    authState.info = "";
    if (authState.recoveryPending) { authState.phase = "recovery"; render(); return; }
    if (session.user.email) rememberEmail(session.user.email);
    store.setActiveUser(session.user.id);
    var cached = store.cachedSettings();
    if (cached) {
      // Open instantly from the device cache, then reconcile with the cloud.
      settings = cached;
      authState.profile = authState.profile || { id: session.user.id, email: session.user.email || "", display_name: defaultName(session.user.email) };
      authState.phase = "ready";
      if (!S().onboarded) ui.onboarding = true;
      render();
      refreshFromCloud().then(renderSoon);
    } else {
      authState.phase = "loading";
      render();
      refreshFromCloud().then(function () {
        if (cloud.error && !store.cachedSettings()) {
          authState.phase = "signed-out";
          authState.error = "Signed in, but your account couldn't load: " + cloud.error;
          render();
          return;
        }
        authState.phase = "ready";
        render();
      });
    }
  }

  function sendCode(email, type) {
    authState.submitting = true;
    authState.error = "";
    authState.info = "";
    render();
    var request = type === "recovery"
      ? supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
      : supabaseClient.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, emailRedirectTo: appUrl() } });
    return request.then(function (result) {
      if (result.error) throw result.error;
      rememberEmail(email);
      authState.submitting = false;
      authState.otpType = type;
      authState.step = "code";
      authState.cooldownUntil = Date.now() + RESEND_SECONDS * 1000;
      authState.info = type === "recovery" ? "We sent a reset code to " + email + "." : "We sent a 6-digit code to " + email + ".";
      render();
      focusSoon("otp-code");
    }).catch(function (error) {
      authState.submitting = false;
      authState.error = friendlyAuthError(error);
      render();
    });
  }

  function verifyCode(token) {
    authState.submitting = true;
    authState.error = "";
    render();
    if (authState.otpType === "recovery") authState.recoveryPending = true;
    supabaseClient.auth.verifyOtp({ email: authState.email, token: token, type: authState.otpType }).then(function (result) {
      if (result.error) throw result.error;
      if (result.data && result.data.session) startSession(result.data.session);
    }).catch(function (error) {
      authState.recoveryPending = false;
      authState.submitting = false;
      authState.error = friendlyAuthError(error);
      render();
      focusSoon("otp-code");
    });
  }

  function passwordSubmit(email, password) {
    authState.submitting = true;
    authState.error = "";
    authState.info = "";
    render();
    rememberEmail(email);
    var signup = authState.passwordView === "signup";
    var request = signup
      ? supabaseClient.auth.signUp({ email: email, password: password, options: { emailRedirectTo: appUrl() } })
      : supabaseClient.auth.signInWithPassword({ email: email, password: password });
    request.then(function (result) {
      if (result.error) throw result.error;
      if (result.data && result.data.session) { startSession(result.data.session); return; }
      // Email confirmation is on: finish with the code from the confirmation email.
      authState.submitting = false;
      authState.method = "code";
      authState.step = "code";
      authState.otpType = "signup";
      authState.cooldownUntil = Date.now() + RESEND_SECONDS * 1000;
      authState.info = "Almost there — enter the code from the confirmation email we sent to " + email + ".";
      render();
    }).catch(function (error) {
      authState.submitting = false;
      authState.error = friendlyAuthError(error);
      render();
    });
  }

  function focusSoon(id) {
    setTimeout(function () { var el = document.getElementById(id); if (el) el.focus(); }, 30);
  }

  var cooldownTimer = null;
  function tickCooldown() {
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(function () {
      var button = document.getElementById("resend-code");
      if (!button) { clearInterval(cooldownTimer); return; }
      var left = Math.ceil((authState.cooldownUntil - Date.now()) / 1000);
      button.disabled = left > 0;
      button.textContent = left > 0 ? "Send a new code (" + left + "s)" : "Send a new code";
      if (left <= 0) clearInterval(cooldownTimer);
    }, 1000);
  }

  function renderAuthGate() {
    navEl.hidden = true;
    var a = authState;
    var html = '<div class="auth-gate"><section class="auth-card">';
    if (a.phase === "boot") {
      html += '<p class="habit-label">SLS</p><h1>Opening…</h1>';
    } else if (a.phase === "loading") {
      html += '<p class="habit-label">ACCOUNT</p><h1>Loading your history…</h1><p>Your saved days are being brought onto this device.</p>';
    } else if (a.phase === "recovery") {
      html += '<p class="habit-label">RESET PASSWORD</p><h1>Choose a new password</h1><p>You\'re signed in. Set a password you can use next time.</p>';
      html += '<form id="new-password-form"><label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" minlength="8" required />';
      html += '<button class="primary-action" type="submit"' + (a.submitting ? " disabled" : "") + ">" + (a.submitting ? "Saving…" : "Save password") + "</button></form>";
      html += '<button type="button" class="text-action" id="skip-password" style="color:var(--dim)">Skip for now</button>';
    } else {
      html += '<p class="habit-label">YOUR PRIVATE HISTORY</p><h1>' + (a.step === "code" ? "Check your email" : "Sign in") + "</h1>";
      if (a.step === "code") {
        html += "<p>" + escapeHtml(a.info || "Enter the code we emailed to " + a.email + ".") + "</p>";
        html += '<form id="code-form"><label for="otp-code">Code</label><input id="otp-code" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="10" required />';
        html += '<button class="primary-action" type="submit"' + (a.submitting ? " disabled" : "") + ">" + (a.submitting ? "Checking…" : "Verify &amp; continue") + "</button></form>";
        html += '<div class="row-actions"><button type="button" class="link-action" id="resend-code">Send a new code</button><button type="button" class="link-action" id="change-email">Use a different email</button></div>';
        html += '<p class="auth-hint">Tip: the email also has a sign-in link. It works if you open it in this same browser — the code works everywhere, including the home-screen app.</p>';
      } else {
        html += "<p>Keep your check-ins and scorecard synced across every device.</p>";
        html += '<div class="segmented" role="tablist"><button type="button" role="tab" data-method="code" class="' + (a.method === "code" ? "active" : "") + '" aria-selected="' + (a.method === "code") + '">Email code</button><button type="button" role="tab" data-method="password" class="' + (a.method === "password" ? "active" : "") + '" aria-selected="' + (a.method === "password") + '">Password</button></div>';
        if (a.method === "code") {
          html += '<form id="email-form"><label for="account-email">Email</label><input id="account-email" type="email" inputmode="email" autocomplete="email" required value="' + escapeHtml(a.email) + '" />';
          html += '<button class="primary-action" type="submit"' + (a.submitting ? " disabled" : "") + ">" + (a.submitting ? "Sending…" : "Email me a code") + "</button></form>";
          html += '<p class="auth-hint">No password needed. New here? This creates your account.</p>';
        } else {
          var view = a.passwordView;
          html += '<form id="password-form"><label for="account-email">Email</label><input id="account-email" type="email" inputmode="email" autocomplete="email" required value="' + escapeHtml(a.email) + '" />';
          if (view !== "forgot") html += '<label for="account-password">Password</label><input id="account-password" type="password" autocomplete="' + (view === "signup" ? "new-password" : "current-password") + '" minlength="' + (view === "signup" ? 8 : 1) + '" required />';
          var label = view === "signup" ? "Create account" : view === "forgot" ? "Email me a reset code" : "Sign in";
          html += '<button class="primary-action" type="submit"' + (a.submitting ? " disabled" : "") + ">" + (a.submitting ? "One moment…" : label) + "</button></form>";
          html += '<div class="row-actions">';
          if (view !== "signin") html += '<button type="button" class="link-action" data-pw-view="signin">Have an account? Sign in</button>';
          if (view !== "signup") html += '<button type="button" class="link-action" data-pw-view="signup">Create an account</button>';
          if (view !== "forgot") html += '<button type="button" class="link-action" data-pw-view="forgot">Forgot password?</button>';
          html += "</div>";
        }
      }
      if (a.error) html += '<p class="form-message error" role="alert">' + escapeHtml(a.error) + "</p>";
    }
    html += "</section></div>";
    appEl.innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll("[data-method]"), function (button) {
      button.addEventListener("click", function () { a.method = button.getAttribute("data-method"); a.error = ""; render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-pw-view]"), function (button) {
      button.addEventListener("click", function () {
        var input = document.getElementById("account-email");
        if (input) a.email = input.value.trim();
        a.passwordView = button.getAttribute("data-pw-view");
        a.error = "";
        render();
      });
    });
    onSubmit("email-form", function () {
      var email = document.getElementById("account-email").value.trim();
      if (email && supabaseClient) sendCode(email, "email");
    });
    onSubmit("code-form", function () {
      var token = document.getElementById("otp-code").value.replace(/\D/g, "");
      if (token.length >= 6) verifyCode(token);
      else { a.error = "Enter the full code from the email."; render(); }
    });
    onSubmit("password-form", function () {
      var email = document.getElementById("account-email").value.trim();
      if (!email || !supabaseClient) return;
      if (a.passwordView === "forgot") { sendCode(email, "recovery"); return; }
      passwordSubmit(email, document.getElementById("account-password").value);
    });
    onSubmit("new-password-form", function () {
      var password = document.getElementById("new-password").value;
      a.submitting = true;
      render();
      supabaseClient.auth.updateUser({ password: password }).then(function (result) {
        if (result.error) throw result.error;
        finishRecovery();
      }).catch(function (error) {
        a.submitting = false;
        a.error = friendlyAuthError(error);
        render();
      });
    });
    bind(document.getElementById("skip-password"), finishRecovery);
    bind(document.getElementById("resend-code"), function () { sendCode(a.email, a.otpType === "recovery" ? "recovery" : "email"); });
    bind(document.getElementById("change-email"), function () { a.step = "email"; a.error = ""; a.info = ""; render(); focusSoon("account-email"); });
    if (document.getElementById("resend-code")) tickCooldown();
    if (a.step === "code" && document.getElementById("otp-code") && !a.submitting) focusSoon("otp-code");
  }

  function finishRecovery() {
    authState.recoveryPending = false;
    authState.submitting = false;
    authState.phase = "boot";
    if (authState.session) startSession(authState.session);
  }

  function onSubmit(id, handler) {
    var form = document.getElementById(id);
    if (form) form.addEventListener("submit", function (event) { event.preventDefault(); handler(); });
  }

  /* ---------------- icons + escaping ---------------- */

  var ICON_PATHS = {
    today: '<path d="M6 3v3M18 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z"/><path d="M8 12h3v3H8z"/>',
    score: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    areas: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1L5 6.1 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1Z"/>',
    flame: '<path d="M13 3c.5 3-1.8 4.3-1.8 6.5 0 1.2.8 2 1.8 2.5-.2-2.4 2-3.2 2-5 2.3 1.8 4 4.4 4 7.2A7 7 0 0 1 5 14c0-3.8 2.2-6.4 5.2-9-.2 2.6 1 3.6 1.7 4.2C12 6.6 13 5.2 13 3Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    sync: '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 1 0 1 7"/>'
  };

  function icon(name, size) {
    return '<svg aria-hidden="true" width="' + (size || 21) + '" height="' + (size || 21) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_PATHS[name] + "</svg>";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function bind(el, handler) { if (el) el.addEventListener("click", handler); }
  function bindAll(selector, handler) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (el) { el.addEventListener("click", function (event) { handler(el, event); }); });
  }

  /* ---------------- app shell ---------------- */

  var appEl = document.getElementById("app");
  var navEl = document.getElementById("bottom-nav");
  var today = localIso();
  var currentTab = "today";
  var ui = {
    exercisesOpen: false, classPicker: false, weekStart: mondayOf(today), selectedArea: null,
    importPrompt: false, importing: false, importError: "",
    onboarding: false, onboardingPlan: "", planDraft: null, planImport: null, planImportBusy: false, editingName: false, message: ""
  };

  var NAV = [
    { key: "today", label: "Today", icon: "today" },
    { key: "scorecard", label: "Scorecard", icon: "score" },
    { key: "areas", label: "Areas", icon: "areas" },
    { key: "settings", label: "Settings", icon: "settings" }
  ];

  function renderNav() {
    navEl.innerHTML = NAV.map(function (item) {
      var active = currentTab === item.key ? ' class="active" aria-current="page"' : "";
      return '<button type="button" data-nav="' + item.key + '"' + active + ">" + icon(item.icon) + "<span>" + item.label + "</span></button>";
    }).join("");
    bindAll("[data-nav]", function (button) { goTab(button.getAttribute("data-nav")); });
  }

  function goTab(tab) {
    currentTab = tab;
    ui.selectedArea = null;
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    if (!appEl) return;
    if (authState.phase !== "ready" || !authState.session) { renderAuthGate(); return; }
    if (ui.onboarding) { navEl.hidden = true; renderOnboarding(); return; }
    navEl.hidden = false;
    renderNav();
    if (currentTab === "today") renderToday();
    else if (currentTab === "scorecard") renderScorecard();
    else if (currentTab === "areas") { if (ui.planDraft) renderPlanEditor(); else renderAreas(); }
    else renderSettings();
    renderImportPrompt();
  }

  // Background updates shouldn't wipe what someone is typing.
  var pendingRender = false;
  function renderSoon() {
    var active = document.activeElement;
    if (active && appEl.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      if (pendingRender) return;
      pendingRender = true;
      active.addEventListener("blur", function () { setTimeout(function () { pendingRender = false; render(); }, 120); }, { once: true });
      return;
    }
    render();
  }

  function renderImportPrompt() {
    if (!ui.importPrompt || ui.onboarding) return;
    var html = '<div class="sheet-backdrop"><section class="area-sheet import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title">';
    html += '<p>ONE-TIME IMPORT</p><h2 id="import-title">Bring over your existing history</h2>';
    html += '<p class="import-copy">Check-ins saved in this browser can be added to your account so they follow you to every device.</p>';
    html += '<button type="button" class="primary-action" id="import-history"' + (ui.importing ? " disabled" : "") + ">" + (ui.importing ? "Importing…" : "Import my existing history") + "</button>";
    html += '<button type="button" class="text-action" id="import-later">Not now</button>';
    if (ui.importError) html += '<p class="form-message error">' + escapeHtml(ui.importError) + "</p>";
    html += "</section></div>";
    appEl.insertAdjacentHTML("beforeend", html);
    bind(document.getElementById("import-history"), importExistingHistory);
    bind(document.getElementById("import-later"), function () { ui.importPrompt = false; render(); });
  }

  function choiceButton(active, label, attrs, variant) {
    return '<button type="button" class="choice' + (active ? " active" : "") + (variant ? " " + variant : "") + '" ' + attrs + ">" + (active ? icon("check", 17) : "") + escapeHtml(label) + "</button>";
  }

  function switchButton(on, attrs, label) {
    return '<button type="button" class="switch" role="switch" aria-checked="' + Boolean(on) + '" aria-label="' + escapeHtml(label) + '" ' + attrs + "></button>";
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  /* ---------------- Today ---------------- */

  function previousTrainingDay(fromDate) {
    for (var i = 1; i <= 7; i++) {
      var d = addDays(fromDate, -i);
      if (planDay(weekdayOf(d))) return d;
    }
    return "";
  }

  function workoutLoggedBetween(logs, startExclusive, endExclusive) {
    for (var d = addDays(startExclusive, 1); d < endExclusive; d = addDays(d, 1)) if (workoutsOn(logAt(logs, d))) return true;
    return false;
  }

  function renderToday() {
    var logs = store.logs;
    var log = getLog(today);
    var weekday = weekdayOf(today);
    var plan = S().workoutPlan;
    var dateParts = { weekday: WEEKDAY_LONG[weekday], date: new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(fromIso(today)) };
    var practiceAreas = enabledPracticeAreas();
    var yesterday = addDays(today, -1);
    var yLog = logAt(logs, yesterday);
    var started = firstLogDate(logs);

    // Never miss twice: daily areas missed yesterday and not yet done today, or the last scheduled workout missed.
    var missedAreas = yesterday < started ? [] : practiceAreas.filter(function (a) { return S().areas[a.key].daysPerWeek >= 7 && !areaState(yLog, a.key) && !areaState(log, a.key); }).map(function (a) { return a.title; });
    var session = fitnessOn() ? planDay(weekday) : null;
    if (session && log.workoutStatus === "none") {
      var prev = previousTrainingDay(today);
      if (prev && prev >= started && !workoutsOn(logAt(logs, prev)) && !workoutLoggedBetween(logs, prev, today)) missedAreas.unshift("Workout");
    }

    var html = '<div class="view today-view">';
    html += '<header class="today-header"><div><p class="date-day">' + escapeHtml(dateParts.weekday.toUpperCase()) + "</p><h1>" + escapeHtml(dateParts.date) + "</h1></div>";
    var anchor = anchorAreaKey();
    var cluster = "";
    if (anchor) { var as = areaStreak(logs, anchor); cluster += "<span>" + icon("flame", 18) + "<b>" + as.current + "</b><small>" + as.unit + "</small></span>"; }
    if (fitnessOn()) { var ws = areaStreak(logs, "fitness"); cluster += "<span><b>" + ws.current + "</b><small>wks</small></span>"; }
    if (cluster) html += '<button type="button" class="streak-cluster" id="streak-cluster" aria-label="Open scorecard">' + cluster + "</button>";
    html += "</header>";

    if (missedAreas.length) {
      html += '<div class="reset-banner">' + icon("flame", 22) + "<div><strong>Never miss twice.</strong><span>" + escapeHtml(missedAreas.join(", ")) + " slipped last time. Today resets it — keep the promise small if you need to.</span></div></div>";
    }

    var index = 1;
    if (fitnessOn()) {
      if (session) {
        var workoutDone = log.workoutStatus !== "none";
        html += '<section class="habit-block workout' + (workoutDone ? " complete" : "") + '">';
        html += '<div class="habit-top"><span class="habit-index">' + pad2(index++) + '</span><div><p class="habit-label">FITNESS' + (session.time ? " · " + escapeHtml(session.time.toUpperCase()) : "") + "</p><h2>" + escapeHtml(session.name) + (/day$/i.test(session.name) ? "" : " day") + "</h2>" + (session.location ? "<p>" + escapeHtml(session.location) + "</p>" : "") + "</div>" + (workoutDone ? '<span class="completion-mark">' + icon("check") + "</span>" : "") + "</div>";
        if (session.note) html += '<p class="habit-note">' + escapeHtml(session.note) + "</p>";
        if (session.exercises.length) {
          html += '<button type="button" class="exercise-toggle" id="exercise-toggle" aria-expanded="' + ui.exercisesOpen + '">' + (ui.exercisesOpen ? "Hide exercises" : "View " + session.exercises.length + " exercises") + '<span class="' + (ui.exercisesOpen ? "rotate" : "") + '">' + icon("chevron", 18) + "</span></button>";
          if (ui.exercisesOpen) {
            html += '<ol class="exercise-list">' + session.exercises.map(function (e) {
              var sub = [];
              if (e.note) sub.push(escapeHtml(e.note));
              if (e.alts.length) sub.push("Alt: " + escapeHtml(e.alts.join(" · ")));
              return "<li><b>" + escapeHtml(e.name) + "</b>" + (e.scheme ? " · " + escapeHtml(e.scheme) : "") + (sub.length ? "<small>" + sub.join("<br>") + "</small>" : "") + "</li>";
            }).join("") + "</ol>";
          }
        }
        var hasBackups = plan.backups.length > 0;
        html += '<div class="choices ' + (hasBackups ? "workout-choices" : "two") + '">';
        html += choiceButton(log.workoutStatus === "lift", "Done", 'data-action="workout-lift"');
        if (hasBackups) html += choiceButton(log.workoutStatus === "class", log.workoutStatus === "class" && log.workoutDetail ? log.workoutDetail : "Backup", 'data-action="workout-class-open"');
        html += choiceButton(log.workoutStatus === "minimum", "Minimum", 'data-action="workout-minimum"');
        html += "</div>";
        if (ui.classPicker && hasBackups) {
          html += '<div class="class-picker" role="group" aria-label="Choose a backup">' + plan.backups.map(function (name) {
            return '<button type="button" data-class="' + escapeHtml(name) + '">' + escapeHtml(name) + "</button>";
          }).join("") + "</div>";
        }
        if (plan.minimum) html += '<p class="minimum-note">Minimum: ' + escapeHtml(plan.minimum) + "</p>";
        html += "</section>";
      } else {
        var restDay = plan.days[weekday];
        var weekCount = workoutsInWeek(logs, mondayOf(today));
        var madeUp = log.workoutStatus !== "none";
        html += '<section class="habit-block rest-block' + (madeUp ? " complete" : "") + '"><div class="habit-top"><span class="habit-index">' + pad2(index++) + '</span><div><p class="habit-label">FITNESS · RECOVERY</p><h2>Rest day</h2><p>' + weekCount + " of " + workoutTarget() + " workouts done this week</p></div>" + (madeUp ? '<span class="completion-mark">' + icon("check") + "</span>" : "") + "</div>";
        html += '<p class="habit-note">' + escapeHtml(restDay && restDay.note ? restDay.note : "Recover well. If you missed a session this week, a make-up workout today still counts.") + "</p>";
        html += '<div class="choices one">' + choiceButton(madeUp, madeUp ? "Make-up workout logged" : "Log a make-up workout", 'data-action="workout-makeup"') + "</div></section>";
      }
      extrasFor(weekday).forEach(function (extra) {
        var done = Boolean(log.extras[extra.id]);
        html += '<section class="habit-block yoga' + (done ? " complete" : "") + '"><div class="habit-top"><span class="habit-index">' + pad2(index++) + '</span><div><p class="habit-label">FITNESS EXTRA' + (extra.time ? " · " + escapeHtml(extra.time.toUpperCase()) : "") + "</p><h2>" + escapeHtml(extra.name) + "</h2>" + (extra.location ? "<p>" + escapeHtml(extra.location) + "</p>" : "") + "</div>" + (done ? '<span class="completion-mark">' + icon("check") + "</span>" : "") + "</div>";
        html += '<div class="choices one">' + choiceButton(done, "Done", 'data-extra="' + escapeHtml(extra.id) + '"') + "</div></section>";
      });
    }

    practiceAreas.forEach(function (area) { html += renderPracticeSection(area, index++, log); });

    if (!fitnessOn() && !practiceAreas.length) {
      html += '<div class="empty-state"><strong>Nothing to track yet</strong><p>Turn on the life areas you want to run, and they\'ll show up here every day.</p><button type="button" class="primary-action" id="go-areas">Choose areas</button></div>';
    }

    var syncLabel = log.cloudSyncStatus === "synced" ? "Saved · synced" : log.cloudSyncStatus === "error" ? "Saved on this device · cloud sync will retry" : log.cloudSyncStatus === "pending" ? "Saving…" : logHasHistory(log) ? "Saved on this device" : "";
    html += '<section class="reflection-block"><div class="reflection-head"><label for="reflection">Gratitude &amp; reflection <span>optional</span></label><button type="button" id="save-reflection">Save note</button></div>';
    html += '<textarea id="reflection" maxlength="2000" placeholder="One line is enough…"></textarea>';
    html += '<div class="reflection-footer"><span>' + escapeHtml(syncLabel) + (log.cloudSyncMessage && log.cloudSyncStatus !== "error" ? " — " + escapeHtml(log.cloudSyncMessage) : "") + "</span></div></section>";
    html += "</div>";
    appEl.innerHTML = html;

    var textarea = document.getElementById("reflection");
    var saveButton = document.getElementById("save-reflection");
    textarea.value = log.reflection;
    saveButton.disabled = true;
    textarea.addEventListener("input", function () { saveButton.disabled = textarea.value.trim() === getLog(today).reflection; });
    bind(saveButton, function () { var l = getLog(today); l.reflection = textarea.value.trim(); persistAndSync(l); });
    bind(document.getElementById("streak-cluster"), function () { goTab("scorecard"); });
    bind(document.getElementById("go-areas"), function () { goTab("areas"); });

    function setWorkout(status, detail) {
      var l = getLog(today);
      l.workoutStatus = l.workoutStatus === status && (status !== "class" || l.workoutDetail === detail) ? "none" : status;
      l.workoutDetail = l.workoutStatus === "none" ? "" : detail || "";
      ui.classPicker = false;
      persistAndSync(l);
    }
    bind(document.getElementById("exercise-toggle"), function () { ui.exercisesOpen = !ui.exercisesOpen; render(); });
    bind(document.querySelector('[data-action="workout-lift"]'), function () { setWorkout("lift", session ? session.name : ""); });
    bind(document.querySelector('[data-action="workout-minimum"]'), function () { setWorkout("minimum", session ? session.name : ""); });
    bind(document.querySelector('[data-action="workout-makeup"]'), function () { setWorkout("lift", "Make-up workout"); });
    bind(document.querySelector('[data-action="workout-class-open"]'), function () {
      if (getLog(today).workoutStatus === "class") { setWorkout("class", getLog(today).workoutDetail); return; }
      ui.classPicker = !ui.classPicker;
      render();
    });
    bindAll("[data-class]", function (button) { setWorkout("class", button.getAttribute("data-class")); });
    bindAll("[data-extra]", function (button) {
      var l = getLog(today);
      var id = button.getAttribute("data-extra");
      if (l.extras[id]) delete l.extras[id]; else l.extras[id] = true;
      persistAndSync(l);
    });
    bindAll("[data-practice]", function (button) {
      var parts = button.getAttribute("data-practice").split("::");
      var mode = button.getAttribute("data-mode");
      var l = getLog(today);
      var area = l.practices[parts[0]] || {};
      var currentState = practiceState(l, parts[0], parts[1]);
      if (mode === "min") { if (currentState === "min") delete area[parts[1]]; else area[parts[1]] = "min"; }
      else { if (currentState === "done") delete area[parts[1]]; else area[parts[1]] = true; }
      if (Object.keys(area).length) l.practices[parts[0]] = area; else delete l.practices[parts[0]];
      persistAndSync(l);
    });
  }

  function renderPracticeSection(area, index, log) {
    var cfg = S().areas[area.key];
    var state = areaState(log, area.key);
    var cadence = cfg.daysPerWeek >= 7 ? "DAILY" : cfg.daysPerWeek + "× / WEEK";
    var html = '<section class="habit-block practice-block' + (state ? " complete" : "") + '">';
    html += '<div class="habit-top"><span class="habit-index">' + pad2(index) + '</span><div><p class="habit-label">' + escapeHtml(area.title.toUpperCase()) + " · " + cadence + "</p><h2>" + escapeHtml(area.title) + "</h2></div>" + (state ? '<span class="completion-mark">' + icon("check") + "</span>" : "") + "</div>";
    html += '<div class="practice-list">';
    if (!cfg.practices.length) html += '<p class="habit-note" style="margin:0">No practices yet — add some in Areas.</p>';
    cfg.practices.forEach(function (p) {
      var s = practiceState(log, area.key, p.id);
      var key = escapeHtml(area.key + "::" + p.id);
      html += '<div class="practice-row' + (cfg.allowMinimum ? " with-min" : "") + '" style="' + (cfg.allowMinimum ? "" : "grid-template-columns:1fr") + '">';
      html += '<button type="button" class="practice-check' + (s === "done" ? " active" : s === "min" ? " min" : "") + '" data-practice="' + key + '" data-mode="done" aria-pressed="' + (s === "done") + '"><span class="check-box">' + (s ? icon("check", 15) : "") + "</span><span>" + escapeHtml(p.label) + (p.detail ? "<small>" + escapeHtml(p.detail) + "</small>" : "") + "</span></button>";
      if (cfg.allowMinimum) html += '<button type="button" class="min-chip' + (s === "min" ? " active" : "") + '" data-practice="' + key + '" data-mode="min" aria-pressed="' + (s === "min") + '" aria-label="Minimum version of ' + escapeHtml(p.label) + '">Min</button>';
      html += "</div>";
    });
    html += "</div></section>";
    return html;
  }

  /* ---------------- Scorecard ---------------- */

  function renderScorecard() {
    var logs = store.logs;
    var weekStart = ui.weekStart;
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(weekStart, i));
    var thisWeek = mondayOf(today);
    var areas = enabledPracticeAreas();
    var fmt = function (value) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(fromIso(value)); };
    var weekLabel = fmt(weekStart) + "–" + fmt(addDays(weekStart, 6));

    function ring(value, total, label) {
      var percent = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
      return '<div class="ring-wrap" aria-label="' + escapeHtml(label) + ": " + value + " of " + total + '"><div class="ring" style="--progress:' + (percent * 3.6) + 'deg"><div><strong>' + value + "</strong><span>/" + total + "</span></div></div><span>" + escapeHtml(label) + "</span></div>";
    }

    // Two misses in a row inside this week (daily areas, and back-to-back scheduled workouts).
    var doubleMiss = [];
    var started = firstLogDate(logs);
    areas.forEach(function (a) {
      if (S().areas[a.key].daysPerWeek < 7) return;
      var hit = days.some(function (date, idx) { return idx > 0 && days[idx - 1] >= started && date < today && !areaState(logAt(logs, date), a.key) && !areaState(logAt(logs, days[idx - 1]), a.key); });
      if (hit) doubleMiss.push(a.title);
    });
    if (fitnessOn()) {
      var scheduled = days.filter(function (d) { return planDay(weekdayOf(d)); });
      var workoutMiss = scheduled.some(function (date, idx) {
        if (idx === 0 || date >= today) return false;
        var prev = scheduled[idx - 1];
        if (prev < started) return false;
        return !workoutsOn(logAt(logs, date)) && !workoutsOn(logAt(logs, prev)) && !workoutLoggedBetween(logs, prev, date);
      });
      if (workoutMiss) doubleMiss.unshift("Workouts");
    }

    var ringCount = (fitnessOn() ? 1 : 0) + areas.length;
    var html = '<div class="view scorecard-view">';
    html += '<header class="section-header"><p>WEEKLY REVIEW</p><h1>Scorecard</h1></header>';
    html += '<div class="week-picker"><button type="button" id="week-prev" aria-label="Previous week">' + icon("arrow") + "</button><div><strong>" + (weekStart === thisWeek ? "This week" : weekLabel) + "</strong><span>" + weekLabel + '</span></div><button type="button" id="week-next" aria-label="Next week"' + (weekStart >= thisWeek ? " disabled" : "") + ">" + icon("arrow") + "</button></div>";

    if (!ringCount) {
      html += '<div class="empty-state"><strong>No areas on</strong><p>Turn on an area to start scoring your week.</p><button type="button" class="primary-action" id="go-areas">Choose areas</button></div></div>';
      appEl.innerHTML = html;
      bind(document.getElementById("go-areas"), function () { goTab("areas"); });
      bindWeekPicker(weekStart);
      return;
    }

    html += '<div class="rings-panel' + (ringCount > 4 ? " compact" : "") + '">';
    if (fitnessOn()) html += ring(workoutsInWeek(logs, weekStart), workoutTarget(), "Workouts");
    areas.forEach(function (a) { html += ring(areaDaysInWeek(logs, a.key, weekStart), S().areas[a.key].daysPerWeek, a.title); });
    html += "</div>";

    if (doubleMiss.length) html += '<div class="miss-alert"><span>!</span><div><strong>Two in a row missed</strong><p>' + escapeHtml(doubleMiss.join(", ")) + " — the next one resets it.</p></div></div>";

    html += '<section class="week-strip" aria-label="Daily completion">';
    days.forEach(function (date) {
      var l = logAt(logs, date);
      var future = date > today;
      var wd = weekdayOf(date);
      html += '<div class="day-column' + (date === today ? " is-today" : "") + '"><span>' + WEEKDAY_SHORT[wd] + "</span><b>" + fromIso(date).getDate() + "</b>";
      if (fitnessOn()) {
        var w = workoutsOn(l);
        var scheduledDay = Boolean(planDay(wd));
        var cls = w ? (l.workoutStatus === "minimum" ? "min" : "done") : future ? "future" : scheduledDay ? "miss" : "off";
        html += '<i class="status-dot workout ' + cls + '" title="Workout"></i>';
      }
      if (areas.length) {
        var done = areas.filter(function (a) { return areaState(l, a.key); }).length;
        html += '<span class="day-score ' + (future ? "" : done === areas.length ? "full" : done ? "part" : "") + '">' + (future ? "–" : done + "/" + areas.length) + "</span>";
      }
      html += "</div>";
    });
    html += "</section>";
    html += '<div class="legend">' + (fitnessOn() ? '<span><i class="status-dot workout done"></i>Workout</span>' : "") + (areas.length ? '<span><span class="day-score full">2/2</span>Areas done</span>' : "") + "</div>";

    html += '<section class="streak-ledger">';
    if (fitnessOn()) {
      var ws = areaStreak(logs, "fitness");
      html += "<div><span>Workout weeks (" + workoutTarget() + "+)</span><strong>" + ws.current + " <small>current</small></strong><p>Best: " + ws.best + " weeks</p></div>";
    }
    areas.forEach(function (a) {
      var st = areaStreak(logs, a.key);
      html += "<div><span>" + escapeHtml(a.title) + "</span><strong>" + st.current + " <small>current</small></strong><p>Best: " + st.best + " " + (st.unit === "days" ? "days" : "weeks") + "</p></div>";
    });
    html += "</section>";
    html += '<p class="score-note">Minimums count and stay visible so the score stays honest. Areas set to fewer than 7 days a week score in weeks.</p></div>';
    appEl.innerHTML = html;
    bindWeekPicker(weekStart);
  }

  function bindWeekPicker(weekStart) {
    bind(document.getElementById("week-prev"), function () { ui.weekStart = addDays(weekStart, -7); render(); });
    bind(document.getElementById("week-next"), function () { ui.weekStart = addDays(weekStart, 7); render(); });
  }

  /* ---------------- Areas ---------------- */

  function renderAreas() {
    var count = AREAS.filter(function (a) { return S().areas[a.key].enabled; }).length;
    var html = '<div class="view areas-view">';
    html += '<header class="section-header"><p>THE WHOLE SYSTEM</p><h1>Life areas</h1><span>' + count + " of " + AREAS.length + " on. Turn on only what you'll actually run — you can add more any time.</span></header>";
    html += '<div class="area-grid">';
    AREAS.forEach(function (area, idx) {
      var cfg = S().areas[area.key];
      var sub = area.kind === "plan" ? (S().workoutPlan.name + " · " + workoutTarget() + "×/wk") : cfg.practices.length + " practice" + (cfg.practices.length === 1 ? "" : "s") + " · " + (cfg.daysPerWeek >= 7 ? "daily" : cfg.daysPerWeek + "×/wk");
      html += '<div class="area-tile ' + (cfg.enabled ? "on" : "off") + '">';
      html += '<button type="button" class="area-tile-open" data-area="' + area.key + '"><span class="area-number">' + pad2(idx + 1) + "</span><strong>" + escapeHtml(area.title) + "</strong><small>" + escapeHtml(cfg.enabled ? sub : area.role) + "</small></button>";
      html += '<div class="area-tile-foot"><span>' + (cfg.enabled ? "On" : "Off") + "</span>" + switchButton(cfg.enabled, 'data-toggle-area="' + area.key + '"', "Turn " + area.title + (cfg.enabled ? " off" : " on")) + "</div>";
      html += "</div>";
    });
    html += "</div></div>";
    if (ui.selectedArea) html += renderAreaSheet(areaDef(ui.selectedArea));
    appEl.innerHTML = html;

    bindAll("[data-area]", function (button) { ui.selectedArea = button.getAttribute("data-area"); render(); });
    bindAll("[data-toggle-area]", function (button) {
      var key = button.getAttribute("data-toggle-area");
      S().areas[key].enabled = !S().areas[key].enabled;
      saveSettings();
      render();
    });
    bindAreaSheet();
  }

  function renderAreaSheet(area) {
    if (!area) return "";
    var cfg = S().areas[area.key];
    var html = '<div class="sheet-backdrop" id="sheet-backdrop"><section class="area-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">';
    html += '<button type="button" class="sheet-close" id="sheet-close" aria-label="Close">' + icon("close") + "</button>";
    html += "<p>" + (cfg.enabled ? "ACTIVE AREA" : "AREA · OFF") + '</p><h2 id="sheet-title">' + escapeHtml(area.title) + '</h2><span class="role-line">Your ' + escapeHtml(area.role) + "</span>";
    html += '<p class="purpose-line">' + escapeHtml(area.purpose) + "</p>";
    html += '<div class="switch-row" style="margin-top:16px"><div><strong>Track this area</strong><small>Shows on Today and in the Scorecard</small></div>' + switchButton(cfg.enabled, 'data-sheet-toggle="enabled"', "Track " + area.title) + "</div>";

    if (area.kind === "plan") {
      var plan = S().workoutPlan;
      html += '<div class="sheet-section"><h3>YOUR PLAN · ' + escapeHtml(plan.name.toUpperCase()) + "</h3><ul class=\"plan-summary\">";
      WEEK.forEach(function (w) {
        var d = plan.days[w.day];
        var extras = plan.extras.filter(function (e) { return e.day === w.day; }).map(function (e) { return e.name; });
        var text = d && d.name ? escapeHtml(d.name) + (d.exercises.length ? " <em>· " + d.exercises.length + " exercises</em>" : "") : "<em>Rest</em>";
        if (extras.length) text += " <em>+ " + escapeHtml(extras.join(", ")) + "</em>";
        html += "<li><span>" + w.short + "</span><div>" + text + "</div></li>";
      });
      html += "</ul></div>";
      html += '<button type="button" class="primary-action" id="edit-plan">Edit plan, change template, or import a file</button>';
    } else {
      html += '<div class="sheet-section"><h3>DAILY PRACTICES</h3>';
      cfg.practices.forEach(function (p, i) {
        html += '<div class="practice-edit-row"><input type="text" maxlength="80" value="' + escapeHtml(p.label) + '" data-practice-label="' + i + '" aria-label="Practice ' + (i + 1) + '" /><button type="button" class="icon-button" data-remove-practice="' + i + '" aria-label="Remove ' + escapeHtml(p.label) + '">' + icon("trash", 17) + "</button></div>";
      });
      html += '<form class="practice-edit-row" id="add-practice"><input type="text" maxlength="80" id="new-practice" placeholder="Add a practice…" aria-label="New practice" /><button type="submit" class="icon-button" aria-label="Add practice">' + icon("plus", 17) + "</button></form>";
      html += "</div>";
      html += '<div class="sheet-section"><h3>TARGET</h3><div class="switch-row"><div><strong>Days per week</strong><small>All practices checked = the day counts</small></div><div class="stepper"><button type="button" data-days="-1" aria-label="Fewer days">−</button><b>' + (cfg.daysPerWeek >= 7 ? "Every day" : cfg.daysPerWeek + " days") + '</b><button type="button" data-days="1" aria-label="More days">+</button></div></div>';
      html += '<div class="switch-row"><div><strong>Allow minimum versions</strong><small>A “Min” button for small-promise days</small></div>' + switchButton(cfg.allowMinimum, 'data-sheet-toggle="allowMinimum"', "Allow minimum versions") + "</div>";
      html += '<div class="switch-row"><div><strong>Show streak on Today</strong><small>The flame in the header</small></div>' + switchButton(anchorAreaKey() === area.key, 'data-sheet-toggle="anchor"', "Show streak on Today") + "</div></div>";
    }
    html += "</section></div>";
    return html;
  }

  function bindAreaSheet() {
    var key = ui.selectedArea;
    if (!key) return;
    var cfg = S().areas[key];
    function close() { ui.selectedArea = null; render(); }
    bind(document.getElementById("sheet-close"), close);
    var backdrop = document.getElementById("sheet-backdrop");
    if (backdrop) backdrop.addEventListener("click", function (event) { if (event.target === backdrop) close(); });
    bindAll("[data-sheet-toggle]", function (button) {
      var field = button.getAttribute("data-sheet-toggle");
      if (field === "anchor") S().anchorArea = anchorAreaKey() === key ? "" : key;
      else cfg[field] = !cfg[field];
      saveSettings();
      render();
    });
    bind(document.getElementById("edit-plan"), function () {
      ui.selectedArea = null;
      ui.planDraft = Catalog.clone(S().workoutPlan);
      ui.planImport = null;
      window.scrollTo(0, 0);
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-practice-label]"), function (input) {
      input.addEventListener("change", function () {
        var label = input.value.trim();
        var p = cfg.practices[Number(input.getAttribute("data-practice-label"))];
        if (!p) return;
        if (label) { p.label = label; saveSettings(); }
        else input.value = p.label;
      });
    });
    bindAll("[data-remove-practice]", function (button) {
      cfg.practices.splice(Number(button.getAttribute("data-remove-practice")), 1);
      saveSettings();
      render();
    });
    onSubmit("add-practice", function () {
      var input = document.getElementById("new-practice");
      var label = input.value.trim();
      if (!label) return;
      cfg.practices.push({ id: "p" + Date.now().toString(36), label: label.slice(0, 80), detail: "" });
      saveSettings();
      render();
      focusSoon("new-practice");
    });
    bindAll("[data-days]", function (button) {
      cfg.daysPerWeek = Math.min(7, Math.max(1, cfg.daysPerWeek + Number(button.getAttribute("data-days"))));
      saveSettings();
      render();
    });
  }

  /* ---------------- Plan editor ---------------- */

  var WEEKDAY_LOOKUP = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

  function formatExtras(extras) {
    return extras.map(function (e) { return [WEEKDAY_SHORT[e.day], e.name, e.time, e.location].filter(Boolean).join(" · "); }).join("\n");
  }

  function parseExtras(text) {
    return String(text || "").split("\n").map(function (line, i) {
      var parts = line.split(/\s*[·|]\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length < 2) return null;
      var day = WEEKDAY_LOOKUP[parts[0].toLowerCase()];
      if (day === undefined) return null;
      var name = parts[1];
      return { id: /yoga/i.test(name) ? "yoga" : "x" + i + name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12), day: day, name: name, time: parts[2] || "", location: parts[3] || "" };
    }).filter(Boolean);
  }

  // Read the editor's fields back into the draft (keeps typing safe across re-renders).
  function collectPlanDraft() {
    var draft = ui.planDraft;
    if (!draft || !document.getElementById("plan-name")) return draft;
    draft.name = document.getElementById("plan-name").value.trim() || "My plan";
    var days = {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-plan-day]"), function (fs) {
      var weekday = Number(fs.getAttribute("data-plan-day"));
      function val(f) { var el = fs.querySelector('[data-f="' + f + '"]'); return el ? el.value.trim() : ""; }
      var exercises = val("exercises").split("\n").map(PlanImport.parseEditorLine).filter(Boolean);
      var name = val("name");
      if (!name && exercises.length) name = "Workout";
      if (name || val("note")) days[weekday] = { name: name, time: val("time"), location: val("location"), note: val("note"), exercises: name ? exercises : [] };
    });
    draft.days = days;
    draft.backups = document.getElementById("plan-backups").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    draft.extras = parseExtras(document.getElementById("plan-extras").value);
    draft.extrasCount = document.getElementById("plan-extras-count").getAttribute("aria-checked") === "true";
    draft.minimum = document.getElementById("plan-minimum").value.trim();
    return draft;
  }

  function renderPlanEditor() {
    var draft = ui.planDraft;
    var html = '<div class="view plan-editor">';
    html += '<header class="editor-head"><div><p class="habit-label">FITNESS</p><h1>Workout plan</h1></div><button type="button" class="sheet-close" id="plan-cancel-top" style="position:static" aria-label="Close without saving">' + icon("close") + "</button></header>";

    html += '<section class="panel"><h2>Start from a template</h2><p>Replaces the week below. Nothing is saved until you tap Save.</p><div class="template-grid">';
    Catalog.PLAN_TEMPLATES.forEach(function (t) {
      html += '<button type="button" class="template-card" data-template="' + t.id + '"><strong>' + escapeHtml(t.title) + "</strong><span>" + escapeHtml(t.blurb) + "</span></button>";
    });
    html += "</div></section>";

    html += '<section class="panel"><h2>Import your own</h2><p>Upload a PDF, text, Markdown, CSV, or SLS JSON file — or paste text from a doc. SLS finds the days and the sets × reps, then you review it here.</p>';
    html += '<label class="import-drop" for="plan-file">' + icon("upload", 24) + "<strong>" + (ui.planImportBusy ? "Reading file…" : "Choose a file") + '</strong><span>.pdf · .txt · .md · .csv · .json</span><input id="plan-file" type="file" accept=".pdf,.txt,.md,.markdown,.csv,.json,application/pdf,text/plain,text/csv,application/json" /></label>';
    html += '<details class="paste-box"><summary>Or paste the plan text</summary><div class="field"><textarea id="plan-paste" placeholder="Day 1 (Push):&#10;Bench Press — 4 x 6-8&#10;Incline DB Press — 3 x 8-12&#10;Day 2: Rest"></textarea></div><button type="button" class="secondary-action" id="plan-paste-go">Read pasted plan</button></details>';
    if (ui.planImport) {
      var r = ui.planImport;
      html += '<div class="import-result' + (r.warnings.length || r.error ? " warn" : "") + '" role="status">' + (r.error ? escapeHtml(r.error) : "Found " + r.summary.days + " workout day" + (r.summary.days === 1 ? "" : "s") + " and " + r.summary.exercises + " exercises. Review the week below, then save.") + (r.warnings.length ? "<br>" + r.warnings.map(escapeHtml).join("<br>") : "") + "</div>";
    }
    html += "</section>";

    html += '<section class="panel"><h2>Your week</h2><p>Leave a day’s workout name empty for a rest day. One exercise per line, like <code>Squat — 3 x 8-12 | alt: Goblet Squat; Leg Press</code>.</p>';
    html += '<label class="field"><span>Plan name</span><input id="plan-name" type="text" maxlength="60" value="' + escapeHtml(draft.name) + '" /></label>';
    WEEK.forEach(function (w) {
      var d = draft.days[w.day] || { name: "", time: "", location: "", note: "", exercises: [] };
      var rest = !d.name;
      html += '<fieldset class="plan-day' + (rest ? " rest" : "") + '" data-plan-day="' + w.day + '"><legend>' + w.long.toUpperCase() + "</legend>";
      html += '<div class="plan-day-grid"><label class="field wide"><span>Workout</span><input data-f="name" type="text" maxlength="40" placeholder="Rest day" value="' + escapeHtml(d.name) + '" /></label>';
      html += '<label class="field"><span>Time</span><input data-f="time" type="text" maxlength="30" placeholder="e.g. 12–1 PM" value="' + escapeHtml(d.time) + '" /></label>';
      html += '<label class="field"><span>Where</span><input data-f="location" type="text" maxlength="40" placeholder="e.g. Gym at work" value="' + escapeHtml(d.location) + '" /></label></div>';
      html += '<label class="field"><span>Exercises</span><textarea data-f="exercises" rows="' + Math.max(3, d.exercises.length + 1) + '" placeholder="Bench Press — 3 x 8-12">' + escapeHtml(d.exercises.map(PlanImport.formatExerciseLine).join("\n")) + "</textarea></label>";
      html += '<label class="field"><span>Note</span><input data-f="note" type="text" maxlength="140" placeholder="Shown on this day (rest days too)" value="' + escapeHtml(d.note) + '" /></label>';
      html += "</fieldset>";
    });
    html += "</section>";

    html += '<section class="panel"><h2>Extras</h2>';
    html += '<label class="field"><span>Backup options (comma separated)</span><input id="plan-backups" type="text" placeholder="Circuit Training, HIIT, Cycle" value="' + escapeHtml(draft.backups.join(", ")) + '" /><small>A backup fills a missed slot. Leave empty to hide the Backup button.</small></label>';
    html += '<label class="field"><span>Weekly add-ons (one per line: day · name · time · place)</span><textarea id="plan-extras" rows="3" placeholder="Tue · Vinyasa Yoga · 6–6:50 PM · Apartment studio">' + escapeHtml(formatExtras(draft.extras)) + "</textarea></label>";
    html += '<div class="switch-row"><div><strong>Add-ons count as workouts</strong><small>Raises the weekly target</small></div>' + switchButton(draft.extrasCount, 'id="plan-extras-count"', "Add-ons count as workouts") + "</div>";
    html += '<label class="field"><span>What counts as a minimum?</span><input id="plan-minimum" type="text" maxlength="140" placeholder="10 minutes still counts." value="' + escapeHtml(draft.minimum) + '" /></label>';
    html += "</section>";

    html += '<div class="sticky-actions"><button type="button" class="secondary-action" id="plan-cancel">Cancel</button><button type="button" class="primary-action" id="plan-save">Save plan</button></div>';
    html += "</div>";
    appEl.innerHTML = html;

    function close() { ui.planDraft = null; ui.planImport = null; ui.selectedArea = "fitness"; render(); }
    bind(document.getElementById("plan-cancel"), close);
    bind(document.getElementById("plan-cancel-top"), close);
    bind(document.getElementById("plan-save"), function () {
      S().workoutPlan = PlanImport.normalizePlan(collectPlanDraft());
      ui.planDraft = null;
      ui.planImport = null;
      saveSettings();
      ui.selectedArea = "fitness";
      render();
    });
    bind(document.getElementById("plan-extras-count"), function (event) {
      var b = event.currentTarget;
      b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true"));
    });
    bindAll("[data-template]", function (button) {
      collectPlanDraft();
      ui.planDraft = Catalog.templatePlan(button.getAttribute("data-template"));
      ui.planImport = null;
      render();
    });
    var fileInput = document.getElementById("plan-file");
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      collectPlanDraft();
      ui.planImportBusy = true;
      render();
      readPlanFile(file).then(function (text) { applyImport(text, file.name); }).catch(function (error) {
        ui.planImportBusy = false;
        ui.planImport = { error: error && error.message ? error.message : "Couldn't read that file.", warnings: [], summary: { days: 0, exercises: 0 } };
        render();
      });
    });
    bind(document.getElementById("plan-paste-go"), function () {
      var text = document.getElementById("plan-paste").value;
      collectPlanDraft();
      applyImport(text, "");
    });
  }

  function applyImport(text, fileName) {
    ui.planImportBusy = false;
    try {
      var result = PlanImport.parsePlanFromText(text, fileName);
      ui.planImport = result;
      if (result.summary.days) {
        var keep = ui.planDraft || {};
        var plan = result.plan;
        // Imported files rarely carry backups/add-ons; keep the user's existing ones.
        if (!plan.backups.length) plan.backups = keep.backups || [];
        if (!plan.extras.length) { plan.extras = keep.extras || []; plan.extrasCount = Boolean(keep.extrasCount); }
        if (!plan.minimum) plan.minimum = keep.minimum || "";
        ui.planDraft = plan;
      }
    } catch (error) {
      ui.planImport = { error: error && error.message ? error.message : "Couldn't read that plan.", warnings: [], summary: { days: 0, exercises: 0 } };
    }
    render();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Couldn't load the PDF reader. Check your connection, or paste the text instead.")); };
      document.head.appendChild(s);
    });
  }

  function readPlanFile(file) {
    if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error("That file is over 15 MB. Try a smaller export."));
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return readPdfText(file);
    if (/\.(docx?|pages|odt)$/i.test(file.name)) return Promise.reject(new Error("Word/Pages files can't be read directly. Export as PDF, or copy the text and paste it below."));
    return file.text();
  }

  // PDF → text lines; big horizontal gaps become " | " so table columns survive.
  function readPdfText(file) {
    var ready = window.pdfjsLib ? Promise.resolve() : loadScript(PDFJS_URL);
    return ready.then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return file.arrayBuffer();
    }).then(function (buffer) {
      return window.pdfjsLib.getDocument({ data: buffer }).promise;
    }).then(function (pdf) {
      var pages = [];
      for (var n = 1; n <= Math.min(pdf.numPages, 30); n++) pages.push(pdf.getPage(n).then(function (page) { return page.getTextContent(); }));
      return Promise.all(pages);
    }).then(function (contents) {
      var out = [];
      contents.forEach(function (content) {
        var rows = [];
        content.items.forEach(function (item) {
          if (!item.str || !item.str.trim()) return;
          var y = item.transform[5], x = item.transform[4];
          var size = Math.abs(item.transform[0]) || 10;
          var row = rows.filter(function (r) { return Math.abs(r.y - y) <= size * 0.45; })[0];
          if (!row) { row = { y: y, items: [] }; rows.push(row); }
          row.items.push({ x: x, w: item.width || 0, str: item.str, size: size });
        });
        rows.sort(function (a, b) { return b.y - a.y; });
        rows.forEach(function (row) {
          row.items.sort(function (a, b) { return a.x - b.x; });
          var line = "", end = null;
          row.items.forEach(function (it) {
            if (end !== null) {
              var gap = it.x - end;
              line += gap > Math.max(14, it.size * 1.6) ? " | " : gap > it.size * 0.15 ? " " : "";
            }
            line += it.str;
            end = it.x + it.w;
          });
          out.push(line.trim());
        });
        out.push("");
      });
      return out.join("\n");
    });
  }

  /* ---------------- Onboarding ---------------- */

  function renderOnboarding() {
    var name = authState.profile && authState.profile.display_name ? authState.profile.display_name : "";
    var current = ui.onboardingPlan || "keep";
    var html = '<div class="onboarding"><p class="habit-label">WELCOME</p><h1>Set up your system</h1><p>Pick the life areas you want to run. Start small — a few running systems beat many planned ones. Everything here can be changed later in Areas.</p>';
    html += '<section class="panel"><h2>Your name</h2><label class="field"><span>Display name</span><input id="onb-name" type="text" maxlength="80" autocomplete="name" value="' + escapeHtml(name) + '" /></label></section>';
    html += '<section class="panel"><h2>Life areas</h2>';
    AREAS.forEach(function (area) {
      html += '<div class="switch-row"><div><strong>' + escapeHtml(area.title) + "</strong><small>" + escapeHtml(area.purpose) + "</small></div>" + switchButton(S().areas[area.key].enabled, 'data-onb-area="' + area.key + '"', area.title) + "</div>";
    });
    html += "</section>";
    if (S().areas.fitness.enabled) {
      html += '<section class="panel"><h2>Workout plan</h2><p>Currently: ' + escapeHtml(S().workoutPlan.name) + '</p><div class="template-grid">';
      html += '<button type="button" class="template-card' + (current === "keep" ? " active" : "") + '" data-onb-plan="keep"><strong>Keep ' + escapeHtml(S().workoutPlan.name) + "</strong><span>" + trainingWeekdays().length + " training days a week</span></button>";
      Catalog.PLAN_TEMPLATES.forEach(function (t) {
        if (t.id === "blank") return;
        html += '<button type="button" class="template-card' + (current === t.id ? " active" : "") + '" data-onb-plan="' + t.id + '"><strong>' + escapeHtml(t.title) + "</strong><span>" + escapeHtml(t.blurb) + "</span></button>";
      });
      html += '<button type="button" class="template-card' + (current === "import" ? " active" : "") + '" data-onb-plan="import"><strong>Import my own</strong><span>Upload a PDF or paste your program after setup.</span></button>';
      html += "</div></section>";
    }
    html += '<button type="button" class="primary-action" id="onb-done" style="margin-top:18px">Start</button></div>';
    appEl.innerHTML = html;

    bindAll("[data-onb-area]", function (button) {
      var key = button.getAttribute("data-onb-area");
      ui.onboardingName = document.getElementById("onb-name").value;
      S().areas[key].enabled = !S().areas[key].enabled;
      render();
      if (ui.onboardingName !== undefined) document.getElementById("onb-name").value = ui.onboardingName;
    });
    bindAll("[data-onb-plan]", function (button) {
      ui.onboardingName = document.getElementById("onb-name").value;
      ui.onboardingPlan = button.getAttribute("data-onb-plan");
      render();
      document.getElementById("onb-name").value = ui.onboardingName;
    });
    bind(document.getElementById("onb-done"), function () {
      var newName = document.getElementById("onb-name").value.trim();
      var choice = ui.onboardingPlan || "keep";
      if (S().areas.fitness.enabled && choice !== "keep" && choice !== "import") S().workoutPlan = Catalog.templatePlan(choice);
      S().onboarded = true;
      if (newName && authState.profile) authState.profile.display_name = newName;
      ui.onboarding = false;
      ui.onboardingPlan = "";
      saveSettings();
      if (S().areas.fitness.enabled && choice === "import") {
        currentTab = "areas";
        ui.planDraft = Catalog.clone(S().workoutPlan);
      } else currentTab = "today";
      render();
    });
  }

  /* ---------------- Settings ---------------- */

  function renderSettings() {
    var profileName = authState.profile && authState.profile.display_name ? authState.profile.display_name : "Account";
    var email = authState.session && authState.session.user ? authState.session.user.email || "" : "";
    var html = '<div class="view settings-view"><header class="section-header"><p>ACCOUNT</p><h1>Settings</h1></header>';

    html += '<section class="connection-panel account-panel"><div class="connection-head"><div><h2>Your account</h2><p>' + (cloud.syncing ? "Syncing…" : cloud.error ? "Offline — changes are saved on this device" : "Synced across your devices") + '</p></div><span class="connection-dot' + (cloud.error ? "" : " on") + '"></span></div>';
    if (ui.editingName) {
      html += '<form id="name-form" class="practice-edit-row" style="grid-template-columns:1fr auto"><input id="name-input" type="text" maxlength="80" value="' + escapeHtml(profileName) + '" aria-label="Display name" /><button type="submit" class="secondary-action" style="margin:0;padding:0 14px">Save</button></form>';
    } else {
      html += '<div class="account-summary"><span class="account-avatar">' + escapeHtml(profileName.charAt(0).toUpperCase()) + "</span><div><strong>" + escapeHtml(profileName) + "</strong><span>" + escapeHtml(email) + '</span></div></div><button type="button" class="link-action" id="edit-name">Change name</button>';
    }
    if (cloud.error) html += '<p class="form-message error">' + escapeHtml(cloud.error) + "</p>";
    if (!cloud.settingsColumn || !cloud.practicesColumn) html += '<p class="form-message error">The database is missing the ' + (!cloud.settingsColumn ? "profiles.settings" : "daily_logs.practices") + " column, so some data only lives on this device. Run supabase/schema.sql in the Supabase SQL editor.</p>";
    html += "</section>";

    html += '<section class="panel"><h2>Password</h2><p>Optional. Email codes always work; a password is handy on shared devices.</p>';
    html += '<form id="set-password-form"><label class="field"><span>New password</span><input id="set-password" type="password" autocomplete="new-password" minlength="8" required /></label><button type="submit" class="secondary-action">Set password</button></form>';
    if (ui.message) html += '<p class="form-message ' + (/^Couldn|error/i.test(ui.message) ? "error" : "success") + '">' + escapeHtml(ui.message) + "</p>";
    html += "</section>";

    html += '<section class="panel"><h2>Your data</h2><p>Download everything — your settings, plan, and every check-in — as a JSON file. The file also works as a plan import.</p><button type="button" class="secondary-action" id="export-data">Export my data</button></section>';
    html += '<section class="panel"><h2>Sign out</h2><p>Your history stays in your account.</p><button type="button" class="text-action" id="sign-out">Sign out of this device</button></section>';
    html += "</div>";
    appEl.innerHTML = html;

    bind(document.getElementById("edit-name"), function () { ui.editingName = true; render(); focusSoon("name-input"); });
    onSubmit("name-form", function () {
      var value = document.getElementById("name-input").value.trim();
      ui.editingName = false;
      if (value && authState.profile) {
        authState.profile.display_name = value;
        pushSettings();
      }
      render();
    });
    onSubmit("set-password-form", function () {
      var password = document.getElementById("set-password").value;
      supabaseClient.auth.updateUser({ password: password }).then(function (result) {
        if (result.error) throw result.error;
        ui.message = "Password saved. You can now sign in with it.";
        render();
      }).catch(function (error) {
        ui.message = "Couldn't save password: " + friendlyAuthError(error);
        render();
      });
    });
    bind(document.getElementById("export-data"), exportData);
    bind(document.getElementById("sign-out"), function (event) {
      var button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Signing out…";
      // Local scope always clears this device, even offline.
      supabaseClient.auth.signOut({ scope: "local" }).then(function (result) {
        if (result && result.error) throw result.error;
      }).catch(function () {
        handleAuthEvent("SIGNED_OUT", null, {});
      });
    });
  }

  function exportData() {
    var logs = {};
    Object.keys(store.logs).sort().forEach(function (date) {
      var l = getLog(date);
      delete l.cloudSyncStatus;
      delete l.cloudSyncMessage;
      logs[date] = l;
    });
    var payload = { app: "SLS", exportedAt: new Date().toISOString(), profile: { display_name: authState.profile && authState.profile.display_name }, settings: S(), logs: logs };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sls-export-" + today + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- day rollover ---------------- */

  // A home-screen app can stay open overnight: move "today" forward when the date changes.
  function checkDate() {
    var now = localIso();
    if (now === today) return;
    var wasCurrentWeek = ui.weekStart === mondayOf(today);
    today = now;
    if (wasCurrentWeek) ui.weekStart = mondayOf(today);
    ui.exercisesOpen = false;
    ui.classPicker = false;
    if (authState.phase === "ready") renderSoon();
  }
  setInterval(checkDate, 60 * 1000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    checkDate();
    if (authState.phase === "ready" && !cloud.syncing && signedInUserId()) refreshFromCloud().then(renderSoon);
  });

  // Exposed for tests and debugging in the console.
  window.SLSApp = {
    get state() { return { auth: authState, ui: ui, settings: S(), cloud: cloud, today: today }; },
    normalizeSettings: normalizeSettings,
    legacySettings: legacySettings
  };

  render();
  initializeSupabase();
})();
