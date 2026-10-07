/* End-to-end walkthrough against a mocked Supabase (tests/mock-supabase.js).
   Run: NODE_PATH=$(npm root -g) node tests/e2e.js
   Screenshots land in tests/screenshots/. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      let file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

const MONDAY = new Date("2026-10-05T09:00:00");

async function newPage(browser, base, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: opts.dark ? "dark" : "light" });
  await context.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8") }));
  await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ contentType: "text/css", body: "" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.setFixedTime(opts.time || MONDAY);
  if (opts.seed) {
    await page.goto(base);
    await page.evaluate((seed) => { localStorage.clear(); Object.keys(seed).forEach((k) => localStorage.setItem(k, JSON.stringify(seed[k]))); }, opts.seed);
  }
  await page.goto(base + (opts.query || ""));
  return { page, context, errors };
}

async function signInWithCode(page, email) {
  await page.getByRole("tab", { name: "Email code" }).click();
  await page.fill("#account-email", email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.waitForSelector("#otp-code");
  await page.fill("#otp-code", "123456");
  await page.getByRole("button", { name: /Verify/ }).click();
}

const dbOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("mock.db")));

(async () => {
  const server = await serve();
  const base = "http://localhost:" + server.address().port + "/";
  const browser = await chromium.launch();
  let step = "";
  try {
    /* 1. New user: email code → onboarding → GAINZ plan */
    step = "new user sign-in";
    let { page, context, errors } = await newPage(browser, base);
    await page.waitForSelector("text=Sign in");
    await page.screenshot({ path: path.join(SHOTS, "01-sign-in.png") });
    await page.fill("#account-email", "new@example.com");
    await page.getByRole("button", { name: "Email me a code" }).click();
    await page.waitForSelector("#otp-code");
    await page.fill("#otp-code", "111111");
    await page.getByRole("button", { name: /Verify/ }).click();
    await page.waitForSelector("text=That code is wrong or has expired");
    await page.screenshot({ path: path.join(SHOTS, "02-code-error.png") });
    await page.fill("#otp-code", "123456");
    await page.getByRole("button", { name: /Verify/ }).click();

    step = "onboarding";
    await page.waitForSelector("text=Set up your system");
    assert.strictEqual(await page.inputValue("#onb-name"), "New");
    await page.fill("#onb-name", "Pratick");
    await page.click('[data-onb-area="spiritual"]');
    await page.click('[data-onb-area="nutrition"]');
    assert.strictEqual(await page.inputValue("#onb-name"), "Pratick", "name survives re-render");
    await page.click('[data-onb-plan="gainz-ppla"]');
    await page.screenshot({ path: path.join(SHOTS, "03-onboarding.png"), fullPage: true });
    await page.getByRole("button", { name: "Start", exact: true }).click();

    step = "today";
    await page.waitForSelector("text=Push day");
    assert.ok(!(await page.isVisible("text=Never miss twice")), "no reset banner on day one");
    await page.click("#exercise-toggle");
    await page.waitForSelector("text=Bench Press (Barbell)");
    await page.waitForSelector("text=Alt: Bench Press (Dumbbell) · Bench Press (Machine)");
    await page.click('[data-action="workout-lift"]');
    await page.waitForSelector(".habit-block.workout.complete");
    await page.click('[data-practice="spiritual::prayer"][data-mode="done"]');
    await page.click('[data-practice="spiritual::scripture"][data-mode="min"]');
    await page.waitForSelector("text=Saved · synced");
    await page.screenshot({ path: path.join(SHOTS, "04-today.png"), fullPage: true });
    let db = await dbOf(page);
    let row = db.daily_logs.find((r) => r.log_date === "2026-10-05");
    assert.ok(row && row.workout_done && row.spiritual_done && row.spiritual_minimum, "row synced: " + JSON.stringify(row));
    assert.deepStrictEqual(row.practices.spiritual, { prayer: true, scripture: "min" });
    let profile = db.profiles.find((p) => p.id === "user-newexamplecom");
    assert.ok(profile.settings.onboarded && profile.settings.areas.nutrition.enabled, "settings synced");
    assert.strictEqual(profile.display_name, "Pratick");
    assert.strictEqual(profile.settings.workoutPlan.name, "GAINZ PPLA");

    step = "scorecard";
    await page.click('[data-nav="scorecard"]');
    await page.waitForSelector("text=Workouts");
    assert.ok(await page.isVisible('[aria-label="Workouts: 1 of 4"]'));
    assert.ok(await page.isVisible('[aria-label="Spiritual: 1 of 7"]'));
    await page.screenshot({ path: path.join(SHOTS, "05-scorecard.png"), fullPage: true });

    step = "areas toggles + practices";
    await page.click('[data-nav="areas"]');
    await page.click('[data-toggle-area="financial"]');
    await page.waitForSelector('.area-tile.on [data-area="financial"]');
    await page.click('[data-area="nutrition"]');
    await page.fill("#new-practice", "Ate my default meals");
    await page.click('#add-practice button[type="submit"]');
    await page.waitForSelector('input[value="Ate my default meals"]');
    await page.click('[data-days="-1"]');
    await page.waitForSelector("text=6 days");
    await page.screenshot({ path: path.join(SHOTS, "06-area-sheet.png") });
    await page.click("#sheet-close");
    await page.screenshot({ path: path.join(SHOTS, "07-areas.png"), fullPage: true });

    step = "plan editor: file import";
    await page.click('[data-area="fitness"]');
    await page.click("#edit-plan");
    await page.setInputFiles("#plan-file", path.join(__dirname, "fixtures", "gainz-docs-export.md"));
    await page.waitForSelector("text=Found 4 workout days and 18 exercises");
    await page.screenshot({ path: path.join(SHOTS, "08-plan-import.png"), fullPage: true });

    step = "plan editor: paste + edit";
    await page.click("details.paste-box summary");
    await page.fill("#plan-paste", "Monday - Upper\nBench 3x8\nRow 3 x 10\nWednesday - Lower\nSquat 5x5\nFriday: Rest");
    await page.click("#plan-paste-go");
    await page.waitForSelector("text=Found 2 workout days and 3 exercises");
    await page.fill('[data-plan-day="5"] [data-f="name"]', "Conditioning");
    await page.fill('[data-plan-day="5"] [data-f="exercises"]', "Bike — 1 x 20 min | alt: Rower; Run");
    await page.fill("#plan-backups", "Spin, HIIT");
    await page.click("#plan-save");
    await page.waitForSelector("text=YOUR PLAN");
    db = await dbOf(page);
    profile = db.profiles.find((p) => p.id === "user-newexamplecom");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("mock.db")).profiles[0].settings.workoutPlan.days["3"]);
    db = await dbOf(page);
    const plan = db.profiles[0].settings.workoutPlan;
    assert.deepStrictEqual(Object.keys(plan.days).sort(), ["1", "3", "5"]);
    assert.deepStrictEqual(plan.days[5].exercises[0], { name: "Bike", scheme: "1 × 20 min", note: "", alts: ["Rower", "Run"] });
    assert.deepStrictEqual(plan.backups, ["Spin", "HIIT"]);
    await page.click("#sheet-close");
    await page.click('[data-nav="today"]');
    await page.waitForSelector("text=Upper day");
    assert.ok(await page.isVisible("text=Backup"));
    assert.ok(await page.isVisible("text=Financial"));

    step = "reload restores session from cache";
    await page.reload();
    await page.waitForSelector("text=Upper day");
    assert.ok(await page.isVisible(".habit-block.workout.complete"), "workout still logged after reload");
    assert.deepStrictEqual(errors, []);

    step = "sign out";
    await page.click('[data-nav="settings"]');
    await page.screenshot({ path: path.join(SHOTS, "09-settings.png"), fullPage: true });
    await page.click("#sign-out");
    await page.waitForSelector("text=Sign in");
    assert.strictEqual(await page.inputValue("#account-email"), "new@example.com", "email remembered");
    await context.close();

    /* 2. Legacy user (first app version): history + settings carried over */
    step = "legacy user";
    const legacyDb = {
      users: {}, sent: [],
      profiles: [{ id: "user-legacyexamplecom", email: "legacy@example.com", display_name: "Pratick", settings: { practice_labels: { "nutrition.protein": "180g protein" } } }],
      daily_logs: [
        { profile_id: "user-legacyexamplecom", log_date: "2026-10-04", spiritual_done: true, spiritual_minimum: false, workout_done: false, workout_minimum: false, workout_type: null, workout_notes: null, yoga_done: false, gratitude: "Rest day", practices: { nutrition: { protein: true, water: true } }, updated_at: "2026-10-04T20:00:00Z" },
        { profile_id: "user-legacyexamplecom", log_date: "2026-10-05", spiritual_done: true, spiritual_minimum: true, workout_done: true, workout_minimum: false, workout_type: "lift", workout_notes: "Push", yoga_done: false, gratitude: "", practices: null, updated_at: "2026-10-05T13:00:00Z" }
      ]
    };
    ({ page, context, errors } = await newPage(browser, base, { seed: { "mock.db": legacyDb } }));
    await signInWithCode(page, "legacy@example.com");
    await page.waitForSelector("text=Set up your system");
    assert.ok(await page.isVisible("text=Keep SLS lunch PPL"));
    for (const key of ["fitness", "spiritual", "nutrition", "health-recovery", "career-purpose"]) {
      assert.strictEqual(await page.getAttribute('[data-onb-area="' + key + '"]', "aria-checked"), "true", key + " on");
    }
    assert.strictEqual(await page.getAttribute('[data-onb-area="financial"]', "aria-checked"), "false");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForSelector("text=Push day");
    assert.ok(await page.isVisible("text=Gym at work"));
    assert.ok(await page.isVisible("text=180g protein"), "custom label carried over");
    assert.strictEqual(await page.getAttribute('[data-practice="spiritual::prayer"][data-mode="min"]', "aria-pressed"), "true", "legacy minimum shows");
    assert.ok(await page.isVisible(".habit-block.workout.complete"));
    await page.screenshot({ path: path.join(SHOTS, "10-legacy-today.png"), fullPage: true });
    // History starts Oct 4: Health and Career were skipped Sunday and are still open Monday; Spiritual/Nutrition weren't.
    const banner = await page.textContent(".reset-banner");
    assert.ok(/Health & Recovery, Career & Purpose slipped/.test(banner), banner);
    assert.deepStrictEqual(errors, []);
    await context.close();

    /* 3. Password flows */
    step = "password sign-up with confirmation code";
    ({ page, context, errors } = await newPage(browser, base));
    await page.getByRole("tab", { name: "Password" }).click();
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.fill("#account-email", "pw@example.com");
    await page.fill("#account-password", "supersecret");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForSelector("text=enter the code from the confirmation email");
    await page.fill("#otp-code", "123456");
    await page.getByRole("button", { name: /Verify/ }).click();
    await page.waitForSelector("text=Set up your system");
    db = await dbOf(page);
    assert.deepStrictEqual(db.verified, ["signup"]);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.click('[data-nav="settings"]');
    await page.click("#sign-out");
    await page.waitForSelector("text=Sign in");
    await page.getByRole("tab", { name: "Password" }).click();
    await page.fill("#account-email", "pw@example.com");
    await page.fill("#account-password", "wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForSelector("text=That email and password don't match");
    await page.fill("#account-password", "supersecret");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForSelector(".today-view");

    step = "forgot password with code";
    await page.click('[data-nav="settings"]');
    await page.click("#sign-out");
    await page.waitForSelector("text=Sign in");
    await page.getByRole("tab", { name: "Password" }).click();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page.getByRole("button", { name: "Email me a reset code" }).click();
    await page.waitForSelector("text=We sent a reset code");
    await page.fill("#otp-code", "123456");
    await page.getByRole("button", { name: /Verify/ }).click();
    await page.waitForSelector("text=Choose a new password");
    await page.fill("#new-password", "evenbetter1");
    await page.getByRole("button", { name: "Save password" }).click();
    await page.waitForSelector(".today-view");
    db = await dbOf(page);
    assert.strictEqual(db.users["pw@example.com"], "evenbetter1");
    assert.deepStrictEqual(errors, []);
    await context.close();

    /* 4. Magic link opened in another browser (PKCE verifier missing) */
    step = "link opened elsewhere";
    ({ page, context, errors } = await newPage(browser, base, { seed: { "sls.lastEmail": "x@example.com" }, query: "?code=bad" }));
    await page.waitForSelector("text=opened in a different browser");
    assert.ok(await page.isVisible("#otp-code"), "goes straight to code entry");
    assert.ok(!page.url().includes("code="), "callback URL cleaned");
    await page.screenshot({ path: path.join(SHOTS, "11-link-elsewhere.png") });
    await context.close();

    step = "link opened in same browser";
    ({ page, context, errors } = await newPage(browser, base, { query: "?code=good" }));
    await page.waitForSelector("text=Set up your system");
    await context.close();

    step = "expired link";
    ({ page, context, errors } = await newPage(browser, base, { query: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired" }));
    await page.waitForSelector("text=That sign-in link has expired");
    await context.close();

    /* 5. Offline save then recovery, dark mode, rest day */
    step = "offline + rest day";
    ({ page, context, errors } = await newPage(browser, base, { dark: true, time: new Date("2026-10-08T19:00:00") }));
    await signInWithCode(page, "dark@example.com");
    await page.waitForSelector("text=Set up your system");
    await page.click('[data-onb-plan="sls-ppl"]');
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForSelector("text=Rest day");
    assert.ok(await page.isVisible("text=Cycle at 5:30 PM"));
    await page.evaluate(() => { window.__mockOffline = true; });
    await page.click('[data-action="workout-makeup"]');
    await page.waitForSelector("text=cloud sync will retry");
    await page.screenshot({ path: path.join(SHOTS, "12-dark-rest-offline.png"), fullPage: true });
    await page.evaluate(() => { window.__mockOffline = false; });
    await page.reload();
    await page.waitForSelector("text=Make-up workout logged");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("mock.db")).daily_logs.some((r) => r.log_date === "2026-10-08" && r.workout_done));
    await page.waitForSelector("text=Saved · synced");
    assert.deepStrictEqual(errors.filter((e) => !/Failed to fetch/.test(e)), []);
    await context.close();

    console.log("e2e passed");
  } catch (error) {
    console.error("FAILED at step:", step);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
