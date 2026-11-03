/* 3D-KOT data layer: Supabase instead of localStorage.
   Drop-in for the localStorage "(function(){...})" blocks in 3d-print-site.html,
   order.html, register.html, admin, articles.

   Loaded as <script src="db.js"></script> AFTER the page's own storage code,
   or used standalone. It exposes window.DB (async Promise) used by the pages.
*/
(function () {
  var SUPABASE_URL = "https://xvwqdkyuorexzctnwtjh.supabase.co";
  var SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2d3Fka3l1b3JleHpjdG53dGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2OTg1MjEsImV4cCI6MjEwOTI3NDUyMX0.L0c3ANfEckwZM0vSAQ6IOQmM2GWMOt_kC7rUxtFnYuA";
  var api = SUPABASE_URL + "/rest/v1/";
  var headers = {
    "apikey": SUPABASE_ANON,
    "Authorization": "Bearer " + SUPABASE_ANON,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  function esc(v) { return encodeURIComponent(v); }

  /* ---- generic REST helpers ---- */
  function req(method, table, body, qs) {
    var url = api + table + (qs ? "?" + qs : "");
    var opt = { method: method, headers: headers };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch(url, opt).then(function (r) {
      if (!r.ok) { throw new Error(method + " " + table + " -> " + r.status); }
      return r.json ? r.json() : r.text();
    });
  }
  function rpc(fn, body) {
    var url = api + "rpc/" + fn;
    return fetch(url, { method: "POST", headers: headers, body: JSON.stringify(body || {}) })
      .then(function (r) { if (!r.ok) { throw new Error("rpc " + fn + " -> " + r.status); } return r.json(); });
  }
  function list(table, qs) { return req("GET", table, undefined, qs); }
  function insert(table, row) {
    // return=minimal avoids needing SELECT permission on the response row.
    var hdrs = Object.assign({}, headers, { "Prefer": "return=minimal" });
    return fetch(api + table, { method: "POST", headers: hdrs, body: JSON.stringify(row) })
      .then(function (r) { if (!r.ok) { throw new Error("POST " + table + " -> " + r.status); } return r.text(); });
  }
  function update(table, id, patch) { return req("PATCH", table, patch, "id=eq." + id); }
  function del(table, id) { return req("DELETE", table, undefined, "id=eq." + id); }

  function ready() {
    if (!SUPABASE_URL || SUPABASE_URL.indexOf("YOUR_") === 0) {
      console.warn("[DB] Supabase not configured yet.");
    }
  }

  /* ---- high-level API used by pages ---- */
  // Admin secret: set by the ADMIN page only (window.ADMIN_SECRET). Public site leaves it unset.
  function secret(){ return (typeof window.ADMIN_SECRET === 'string') ? window.ADMIN_SECRET : ''; }

  var DB = {
    /* USERS (bcrypt via RPC — no direct table access) */
    users: {
      register: function (name, email, pass) { return rpc("register_user", { p_name: name, p_email: email, p_pass: pass }); },
      login: function (name, pass) { return rpc("login_user", { p_name: name, p_pass: pass }); },
      /* admin-only */
      publicAll: function () { return rpc("list_users", { p_secret: secret() }); },
      removeByName: function (name) { return rpc("user_delete", { p_name: name, p_secret: secret() }).catch(function(){ return null; }); }
    },
    /* ORDERS */
    orders: {
      all: function () { return rpc("admin_list_orders", { p_secret: secret() }); },
      byUser: function (name) { return rpc("user_my_orders", { p_name: name }).catch(function(){ return []; }); },
      add: function (o) { return insert("orders", o); },
      setStatus: function (id, status, reason) { return rpc("admin_update_order", { p_id: id, p_status: status, p_reason: (reason||null), p_secret: secret() }); },
      remove: function (id) { return rpc("admin_delete_order", { p_id: id, p_secret: secret() }); }
    },
    /* CONTACTS */
    contacts: {
      all: function () { return rpc("admin_list_contacts", { p_secret: secret() }); },
      add: function (c) { return insert("contacts", c); },
      remove: function (id) { return rpc("admin_delete_contact", { p_id: id, p_secret: secret() }); }
    },
    /* MESSAGES (flat thread table) */
    messages: {
      byThread: function (thread) {
        return list("messages", "select=*&thread=eq." + esc(thread) + "&order=id");
      },
      add: function (m) { return insert("messages", m); },
      markRead: function (thread, fromName) {
        return fetch(api + "messages?id=not.in.(1)&thread=eq." + esc(thread) + "&from_name=neq." + esc(fromName), {
          method: "PATCH", headers: headers, body: JSON.stringify({ read: true })
        }).then(function(){ return null; });
      }
    },
    /* ARTICLES: public read; admin (secret) add/delete */
    articles: {
      all: function () { return list("articles", "select=*&order=id"); },
      add: function (a) { return rpc("admin_add_article", { p_title: a.title, p_body: a.body, p_author: (a.author||''), p_secret: secret() }); },
      remove: function (id) { return rpc("admin_delete_article", { p_id: id, p_secret: secret() }); }
    },
    /* CONTENT OVERRIDES (single row id=1) — public read, admin write */
    content: {
      get: function () {
        return list("content", "select=*&id=eq.1").then(function (rows) {
          return (rows && rows[0] && rows[0].data) || {};
        });
      },
      set: function (data) { return rpc("admin_set_content", { p_data: data, p_secret: secret() }); }
    },
    isConfigured: function () {
      return SUPABASE_URL.indexOf("YOUR_") !== 0;
    }
  };

  /* ---- stats: use an RPC to atomically bump, two endpoints ---- */
  ready();
  window.DB = DB;
})();