# SLS — Single Life System

A system of systems for every area of life. Each area is a role you'd hire for (personal trainer, dietitian, chief of staff…). Turning an area on gives you a small daily checklist that does that person's job. The scorecard keeps everything honest with one rule: **never miss twice**.

Live app: https://eyeprad.github.io/sls-app/

## What it does

- **Today**: your workout for the day from your own plan (exercises, sets × reps, alternatives, backup options, minimum version), add-ons like a weekly yoga class, and a checklist for each area you've turned on. Each practice can have a **Min** button for small-promise days.
- **Scorecard**: weekly rings for workouts and every active area, a "two in a row missed" alert, a day-by-day strip, and current and best streaks. Areas set to fewer than 7 days a week are scored in weeks.
- **Areas**: all 11 life areas, each with an on/off switch. Rename, add or remove practices, set days per week, allow minimums, and choose which streak shows on Today.
- **Workout plans**: start from a template (SLS lunch PPL, GAINZ PPLA 4-day split, Full body 3×, Upper/lower 4×, Home starter), build your own week, or **import a file**.
- **Accounts**: sign in with a 6-digit email code (works in the home-screen app), a password, or the email link. History syncs across devices through Supabase. The app also keeps a copy on the device, so it opens instantly and still saves when you're offline.
- **Export**: download your settings, plan and every check-in as JSON. The file also works as a plan import.

## Importing a workout plan

Areas → Fitness → **Edit plan** → **Import your own**. Supported files:

| Format | What SLS looks for |
| --- | --- |
| PDF, `.txt`, `.md` (including Google Docs → Download → PDF/Markdown) | Day headings like `Day One (Push):`, `Monday – Upper`, `Legs day:`; exercise lines with a scheme like `Squat 3 x 8-12`, `3 sets of 10`, `1 x 20 min`; bulleted alternatives under an exercise; `Day 3: REST` |
| `.csv` | A header row with `exercise` plus any of `day`, `workout`, `sets`, `reps`, `scheme`, `alternatives` (separated by `;`), `time`, `location` |
| `.json` | An SLS export, or `{ "name", "days": { "1": { "name", "exercises": [...] } } }` (weekday 0 = Sunday) |

You can also paste text. Numbered days are placed from Monday on (Day 1 = Monday), and you review and edit everything before saving. Word/Pages files: export to PDF or paste the text.

## Setup (Supabase)

1. **Database**: run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor. You can run it more than once: it adds the `profiles.settings` and `daily_logs.practices` columns if they're missing and turns on row-level security so each account only sees its own rows.
2. **Email codes**: in Authentication → Email Templates, add the code to both the **Magic Link** and **Confirm signup** templates, for example:
   ```html
   <h2>Your SLS code</h2>
   <p>Enter this code in the app: <strong>{{ .Token }}</strong></p>
   <p>Or <a href="{{ .ConfirmationURL }}">tap here to sign in</a> on this device.</p>
   ```
   Add `{{ .Token }}` to the **Reset Password** template too, so password resets work with a code.
3. **Redirect URLs**: in Authentication → URL Configuration, set the Site URL to `https://eyeprad.github.io/sls-app/` and add it (plus `http://localhost:*` for local testing) to the redirect allow-list.
4. Optional: the built-in Supabase email sender is heavily rate-limited. For real users, set up custom SMTP (Authentication → SMTP).

The publishable key in `js/app.js` is meant to be public. Your data stays private because of the row-level security policies.

## Project layout

```
index.html          app shell
styles.css          all styles (light + dark)
js/catalog.js       the 11 areas, default practices, workout plan templates
js/plan-import.js   plan file parser (PDF text, Markdown, CSV, JSON)
js/app.js           auth, sync, and every screen
supabase/schema.sql database tables + row-level security
tests/              parser tests and an end-to-end run against a mocked Supabase
```

No build step: GitHub Pages serves the files as they are.

## Running locally and testing

```sh
npx http-server -p 8080          # then open http://localhost:8080
node tests/parser.test.js        # plan import parser
NODE_PATH=$(npm root -g) node tests/e2e.js   # needs Playwright; screenshots go to tests/screenshots/
```

The end-to-end test swaps Supabase for `tests/mock-supabase.js` (the valid code is always `123456`). It covers: code sign-in, onboarding, workouts and practices syncing, area toggles, plan file and paste import, reload from cache, password sign-up/sign-in/reset, links opened in another browser, expired links, and offline saves that retry.

## Data model

- `profiles.settings` (JSON): `{ version: 2, onboarded, anchorArea, areas: { [key]: { enabled, practices: [{ id, label, detail }], allowMinimum, daysPerWeek } }, workoutPlan: { name, days: { [weekday]: { name, time, location, note, exercises: [{ name, scheme, note, alts }] } }, backups, extras, extrasCount, minimum } }`
- `daily_logs`: one row per day. `practices` holds `{ [areaKey]: { [practiceId]: true | "min" }, _extras: { [extraId]: true } }`. The original columns (`spiritual_*`, `workout_*`, `yoga_done`, `gratitude`) are still filled in, so older history and reports keep working.

Accounts created with the first version of the app keep their exact setup (lunch PPL Mon–Wed, Tuesday yoga, the five areas they had on, and any renamed practices). They see a one-time "Set up your system" screen to confirm it.
