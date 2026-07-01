/* ============================================================================
   Aura — Enhancement Layer (runtime)
   Mounts an ambient greeting + clock + date + daily-intention widget as a
   fixed overlay on <body>, independent of the React app's #root (so React
   re-renders never remove it). Pure vanilla JS, no dependencies.
   Safe to remove: delete this file + its <script> tag in index.html.
   ============================================================================ */

(function () {
  "use strict";

  // Curated focus intentions / quotes. Kept short so they fit the widget.
  var INTENTIONS = [
    "Start with the one thing that matters most.",
    "Focus is saying no to a hundred good ideas.",
    "Small steps, every day, beat big plans someday.",
    "Do the hard thing first — the rest gets easier.",
    "Clarity comes from action, not thought.",
    "One tab, one task. Protect your attention.",
    "Done is better than perfect.",
    "Make today simpler than yesterday.",
    "Energy flows where attention goes.",
    "Slow is smooth, smooth is fast.",
    "You don't need more time, just fewer distractions.",
    "Progress over perfection, always.",
    "What you organize, you control.",
    "Deep work now, shallow work later.",
    "Tidy space, tidy mind.",
    "Choose three priorities. Ignore the rest.",
    "The best time to focus is now.",
    "Less noise. More signal.",
    "Finish what you start before starting more.",
    "Your future self is built by today's choices.",
  ];

  function dayOfYear(d) {
    var start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }

  function mount() {
    if (document.querySelector(".aura-widget")) return; // guard against double-mount
    if (!document.body) return;

    // Motivational line only — clock/date/greeting removed by request.
    var w = document.createElement("div");
    w.className = "aura-widget aura-widget--quote";
    w.innerHTML =
      '<div class="aura-quote" data-quote title="Click for another">' +
      '<span class="spark">✦</span><span data-quote-text></span></div>';
    document.body.appendChild(w);

    var elQuote = w.querySelector("[data-quote-text]");

    // Daily intention (stable through the day), click to cycle.
    var idx = dayOfYear(new Date()) % INTENTIONS.length;
    function showQuote() { elQuote.textContent = INTENTIONS[idx % INTENTIONS.length]; }
    w.querySelector("[data-quote]").addEventListener("click", function () {
      idx = (idx + 1) % INTENTIONS.length;
      showQuote();
    });
    showQuote();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

/* ============================================================================
   Aura — Data Persistence & Backup Layer
   Fixes: boards/links disappearing on their own.

   Root cause: all boards + bookmarks live in IndexedDB ("AuraDB"). By default
   that storage is "best-effort" and Chrome may EVICT it automatically (disk
   pressure, "clear browsing data", privacy cleaners, "clear on exit").

   Two-layer fix, both self-contained (no dependency on the React bundle):
     1. Ask the browser to mark storage PERSISTENT so it is not auto-evicted.
     2. Mirror AuraDB into chrome.storage.local (which is NOT evictable and
        survives clearing browsing data). If AuraDB is ever found wiped, the
        snapshot is restored automatically.

   Safe to remove: delete this block. It never deletes user data.
   ============================================================================ */
(function () {
  "use strict";

  var DB_NAME = "AuraDB";
  var BACKUP_KEY = "auraBackup";
  var BACKUP_INTERVAL_MS = 60 * 1000; // snapshot at most this often

  var hasChromeStorage =
    typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  if (typeof indexedDB === "undefined" || !hasChromeStorage) return;

  // --- Layer 1: request non-evictable (persistent) storage --------------------
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted()
      .then(function (already) { return already || navigator.storage.persist(); })
      .catch(function () {});
  }

  // --- tiny IndexedDB helpers (raw IDB; Dexie owns the schema) ----------------
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME); // no version => attach to existing DB
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("blocked")); };
      // If the DB does not exist yet, this creates an empty one with no stores;
      // getAll() below simply returns [] for missing stores, which is harmless.
    });
  }

  function hasStore(db, name) {
    return db.objectStoreNames && db.objectStoreNames.contains(name);
  }

  function getAll(db, store) {
    return new Promise(function (resolve) {
      if (!hasStore(db, store)) return resolve([]);
      try {
        var rq = db.transaction(store, "readonly").objectStore(store).getAll();
        rq.onsuccess = function () { resolve(rq.result || []); };
        rq.onerror = function () { resolve([]); };
      } catch (e) { resolve([]); }
    });
  }

  function putRec(db, store, rec) {
    return new Promise(function (resolve, reject) {
      try {
        var os = db.transaction(store, "readwrite").objectStore(store);
        var rq = os.put(rec);
        rq.onsuccess = function () { resolve(rq.result); };
        rq.onerror = function () { reject(rq.error); };
      } catch (e) { reject(e); }
    });
  }

  function stripId(rec) { var o = Object.assign({}, rec); delete o.id; return o; }

  // --- Layer 2a: snapshot AuraDB -> chrome.storage.local ----------------------
  function backup() {
    return openDB().then(function (db) {
      return Promise.all([
        getAll(db, "boards"),
        getAll(db, "bookmarks"),
        getAll(db, "settings"),
      ]).then(function (r) {
        db.close();
        var boards = r[0], bookmarks = r[1], settings = r[2];
        // Only overwrite the backup when there is something worth keeping,
        // so a transient empty read never destroys a good snapshot.
        if (!boards.length && !bookmarks.length) return;
        var snap = {
          boards: boards, bookmarks: bookmarks, settings: settings,
          ts: Date.now(), v: 1,
        };
        var payload = {}; payload[BACKUP_KEY] = snap;
        chrome.storage.local.set(payload);
      });
    }).catch(function () {});
  }

  // --- Layer 2b: restore snapshot if the live DB looks wiped ------------------
  function maybeRestore() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(BACKUP_KEY, function (obj) {
        var snap = obj && obj[BACKUP_KEY];
        if (!snap || !snap.bookmarks || !snap.bookmarks.length) return resolve(false);
        openDB().then(function (db) {
          getAll(db, "bookmarks").then(function (curBookmarks) {
            // Data still present => nothing to restore.
            if (curBookmarks.length > 0) { db.close(); return resolve(false); }
            if (!hasStore(db, "boards") || !hasStore(db, "bookmarks")) {
              // Dexie hasn't built the schema yet; skip this pass.
              db.close(); return resolve(false);
            }
            mergeSnapshot(db, snap).then(function (n) {
              db.close();
              resolve(n > 0);
            }).catch(function () { db.close(); resolve(false); });
          });
        }).catch(function () { resolve(false); });
      });
    });
  }

  // Merge a snapshot into the live DB. Boards are deduped by slug (so the app's
  // default Inbox/Work/Reading are reused, never duplicated); bookmarks are
  // deduped by board+url (so re-importing the same file adds nothing new).
  // Used by both auto-restore (empty DB) and manual Import (populated DB).
  function mergeSnapshot(db, snap) {
    return Promise.all([getAll(db, "boards"), getAll(db, "bookmarks")]).then(function (cur) {
      var curBoards = cur[0], curBookmarks = cur[1];

      var bySlug = {};
      curBoards.forEach(function (b) { bySlug[b.slug] = b.id; });

      // Existing (liveBoardId \n url) keys, to skip bookmarks we already have.
      var seen = {};
      curBookmarks.forEach(function (bm) { seen[bm.boardId + "\n" + bm.url] = true; });

      var idMap = {}; // snapshot boardId -> live boardId
      var chain = Promise.resolve();

      (snap.boards || []).forEach(function (b) {
        chain = chain.then(function () {
          if (bySlug[b.slug] != null) { idMap[b.id] = bySlug[b.slug]; return; }
          return putRec(db, "boards", stripId(b)).then(function (newId) {
            idMap[b.id] = newId; bySlug[b.slug] = newId;
          });
        });
      });

      var count = 0;
      (snap.bookmarks || []).forEach(function (bm) {
        chain = chain.then(function () {
          var rec = stripId(bm);
          if (idMap[bm.boardId] != null) rec.boardId = idMap[bm.boardId];
          var key = rec.boardId + "\n" + rec.url;
          if (seen[key]) return; // already present — skip
          seen[key] = true;
          return putRec(db, "bookmarks", rec).then(function () { count++; });
        });
      });

      // settings are keyed (not auto-increment) so a straight put is safe.
      (snap.settings || []).forEach(function (s) {
        chain = chain.then(function () { return putRec(db, "settings", s).catch(function () {}); });
      });

      return chain.then(function () { return count; });
    });
  }

  // --- Export: download the whole dashboard as one JSON file ------------------
  function exportData() {
    return openDB().then(function (db) {
      return Promise.all([
        getAll(db, "boards"),
        getAll(db, "bookmarks"),
        getAll(db, "settings"),
      ]).then(function (r) {
        db.close();
        var snap = {
          app: "Aura", type: "aura-backup", v: 1, ts: Date.now(),
          boards: r[0], bookmarks: r[1], settings: r[2],
        };
        var blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var d = new Date();
        var stamp = d.getFullYear() + "-" +
          ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
          ("0" + d.getDate()).slice(-2);
        var a = document.createElement("a");
        a.href = url;
        a.download = "aura-backup-" + stamp + ".json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      });
    }).catch(function () { alert("Aura: export failed."); });
  }

  // --- Import: merge a previously exported JSON file back in ------------------
  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var snap;
      try { snap = JSON.parse(reader.result); }
      catch (e) { alert("Aura: that file isn't valid JSON."); return; }
      if (!snap || (!snap.bookmarks && !snap.boards)) {
        alert("Aura: that doesn't look like an Aura backup.");
        return;
      }
      openDB().then(function (db) {
        if (!hasStore(db, "boards") || !hasStore(db, "bookmarks")) {
          db.close(); alert("Aura: database not ready — open a fresh tab and retry."); return;
        }
        mergeSnapshot(db, snap).then(function (added) {
          db.close();
          alert("Aura: import complete — " + added + " new link" + (added === 1 ? "" : "s") + " added.");
          location.reload();
        }).catch(function () { db.close(); alert("Aura: import failed."); });
      }).catch(function () { alert("Aura: could not open the database."); });
    };
    reader.readAsText(file);
  }

  // --- Export / Import controls (fixed overlay, survives React re-renders) ----
  function buildToolbar() {
    if (document.querySelector(".aura-tools")) return;
    var bar = document.createElement("div");
    bar.className = "aura-tools";

    var expBtn = document.createElement("button");
    expBtn.className = "aura-tool-btn";
    expBtn.type = "button";
    expBtn.title = "Export all boards & links to a JSON file";
    expBtn.innerHTML = "⤓ Export";
    expBtn.addEventListener("click", exportData);

    var impBtn = document.createElement("button");
    impBtn.className = "aura-tool-btn";
    impBtn.type = "button";
    impBtn.title = "Import boards & links from a JSON backup";
    impBtn.innerHTML = "⤑ Import";

    var file = document.createElement("input");
    file.type = "file";
    file.accept = "application/json,.json";
    file.style.display = "none";
    file.addEventListener("change", function () {
      if (file.files && file.files[0]) importData(file.files[0]);
      file.value = ""; // allow re-importing the same file
    });
    impBtn.addEventListener("click", function () { file.click(); });

    bar.appendChild(expBtn);
    bar.appendChild(impBtn);
    bar.appendChild(file);
    document.body.appendChild(bar);
  }

  // --- "Open all" per board: open every link in a board card at once ----------
  function openUrls(urls) {
    if (!urls.length) return;
    if (urls.length > 12 && !confirm("Open " + urls.length + " tabs?")) return;
    var useTabs = typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create;
    urls.forEach(function (u) {
      if (useTabs) chrome.tabs.create({ url: u, active: false });
      else window.open(u, "_blank", "noopener");
    });
  }

  function injectOpenAll() {
    var cards = document.querySelectorAll(".board-card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var title = card.querySelector(".bcard-title");
      if (!title || card.querySelector(".aura-openall")) continue;

      var btn = document.createElement("button");
      btn.className = "aura-openall";
      btn.type = "button";
      btn.title = "Open all links in this board";
      btn.setAttribute("aria-label", "Open all links in this board");
      btn.setAttribute("draggable", "false");
      btn.textContent = "⧉"; // ⧉
      // Don't let clicks bubble into the card's drag / rename handlers.
      btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
      btn.addEventListener("dragstart", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        var c = e.currentTarget.closest(".board-card");
        if (!c) return;
        var anchors = c.querySelectorAll("a.bmrow-title[href]");
        var urls = [];
        for (var j = 0; j < anchors.length; j++) {
          var href = anchors[j].href;
          if (/^https?:/i.test(href)) urls.push(href);
        }
        openUrls(urls);
      });
      title.insertAdjacentElement("afterend", btn);
    }
  }

  function setupOpenAll() {
    injectOpenAll();
    // React re-renders replace card DOM; re-inject when the tree changes.
    var scheduled = false;
    var obs = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; injectOpenAll(); });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // --- orchestration ----------------------------------------------------------
  function run() {
    // A wipe can leave the app already rendered as "empty"; restoring then
    // needs one reload to repaint. Guard so we reload at most once per load.
    var RELOAD_FLAG = "auraRestoredReload";
    maybeRestore().then(function (restored) {
      if (restored && !sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, "1");
        location.reload();
        return;
      }
      backup();
      setInterval(backup, BACKUP_INTERVAL_MS);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") backup();
      });
      buildToolbar();
      setupOpenAll();
    });
  }

  // Give Dexie a moment to open the DB / seed defaults before we look.
  setTimeout(run, 1500);
})();
