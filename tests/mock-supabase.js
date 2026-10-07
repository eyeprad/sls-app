/* Minimal in-browser stand-in for supabase-js v2, used by tests/e2e.js.
   The "cloud" lives in localStorage under mock.db so it survives reloads.
   The valid email code is always 123456. */
(function () {
  "use strict";
  var DB_KEY = "mock.db";
  var SESSION_KEY = "mock.session";

  function db() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || { profiles: [], daily_logs: [], users: {}, sent: [] }; } catch (e) { return { profiles: [], daily_logs: [], users: {}, sent: [] }; }
  }
  function saveDb(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); }
  function userId(email) { return "user-" + email.replace(/[^a-z0-9]/gi, ""); }
  function makeSession(email) { return { access_token: "t", user: { id: userId(email), email: email } }; }

  function createClient() {
    var listeners = [];
    var session = null;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { session = null; }
    function emit(event, s) { listeners.forEach(function (cb) { cb(event, s); }); }
    function setSession(s, event) {
      session = s;
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
      emit(event, s);
    }
    var params = new URLSearchParams(location.search);
    var urlCode = params.get("code");
    var initPromise = new Promise(function (resolve) {
      setTimeout(function () {
        if (urlCode === "good") session = makeSession("link@example.com");
        if (urlCode === "recovery") { session = makeSession("link@example.com"); emit("PASSWORD_RECOVERY", session); }
        if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        resolve();
      }, 20);
    });

    var auth = {
      onAuthStateChange: function (cb) {
        listeners.push(cb);
        initPromise.then(function () { cb("INITIAL_SESSION", session); });
        return { data: { subscription: { unsubscribe: function () {} } } };
      },
      signInWithOtp: function (opts) {
        var d = db(); d.sent.push({ kind: "otp", email: opts.email, redirect: opts.options && opts.options.emailRedirectTo }); saveDb(d);
        if (window.__mockRateLimit) return Promise.resolve({ error: { message: "For security purposes, you can only request this after 42 seconds." } });
        return Promise.resolve({ data: {}, error: null });
      },
      verifyOtp: function (opts) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            if (opts.token !== "123456") { resolve({ data: {}, error: { message: "Token has expired or is invalid" } }); return; }
            var s = makeSession(opts.email);
            var d = db(); d.verified = (d.verified || []).concat([opts.type]); saveDb(d);
            setSession(s, "SIGNED_IN");
            resolve({ data: { session: s, user: s.user }, error: null });
          }, 30);
        });
      },
      signInWithPassword: function (opts) {
        var d = db();
        if (d.users[opts.email] !== opts.password) return Promise.resolve({ data: {}, error: { message: "Invalid login credentials" } });
        var s = makeSession(opts.email);
        setSession(s, "SIGNED_IN");
        return Promise.resolve({ data: { session: s }, error: null });
      },
      signUp: function (opts) {
        var d = db();
        if (d.users[opts.email]) return Promise.resolve({ data: {}, error: { message: "User already registered" } });
        d.users[opts.email] = opts.password; saveDb(d);
        return Promise.resolve({ data: { user: { id: userId(opts.email) }, session: null }, error: null });
      },
      resetPasswordForEmail: function (email) {
        var d = db(); d.sent.push({ kind: "recovery", email: email }); saveDb(d);
        return Promise.resolve({ data: {}, error: null });
      },
      updateUser: function (attrs) {
        var d = db(); if (session && attrs.password) d.users[session.user.email] = attrs.password; saveDb(d);
        emit("USER_UPDATED", session);
        return Promise.resolve({ data: { user: session && session.user }, error: null });
      },
      signOut: function () { setSession(null, "SIGNED_OUT"); return Promise.resolve({ error: null }); },
      getSession: function () { return initPromise.then(function () { return { data: { session: session }, error: null }; }); }
    };

    function query(table) {
      var filters = [], single = false, op = "select", payload = null, conflict = "";
      var q = {
        select: function () { op = op === "upsert" ? op : "select"; return q; },
        eq: function (col, val) { filters.push([col, val]); return q; },
        order: function () { return q; },
        range: function () { return q; },
        lte: function () { return q; },
        maybeSingle: function () { single = true; return q; },
        upsert: function (rows, opts) { op = "upsert"; payload = Array.isArray(rows) ? rows : [rows]; conflict = (opts && opts.onConflict || "id").split(","); return q; },
        then: function (resolve, reject) {
          return new Promise(function (res) { setTimeout(res, 15); }).then(function () {
            var d = db();
            if (window.__mockOffline) return { data: null, error: { message: "Failed to fetch" } };
            if (op === "upsert") {
              payload.forEach(function (row) {
                var list = d[table];
                var idx = list.findIndex(function (r) { return conflict.every(function (c) { return r[c] === row[c]; }); });
                if (idx === -1) list.push(Object.assign({}, row)); else list[idx] = Object.assign({}, list[idx], row);
              });
              d.writes = (d.writes || 0) + 1;
              saveDb(d);
              return { data: null, error: null };
            }
            var rows = d[table].filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); });
            if (table === "daily_logs") rows.sort(function (a, b) { return a.log_date < b.log_date ? -1 : 1; });
            return { data: single ? rows[0] || null : rows, error: null };
          }).then(resolve, reject);
        }
      };
      return q;
    }

    return { auth: auth, from: query };
  }

  window.supabase = { createClient: createClient };
})();
