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

  function greeting(hour) {
    if (hour < 5) return "Working late? 🌙";   // 🌙
    if (hour < 12) return "Good morning ☀️";   // ☀️
    if (hour < 17) return "Good afternoon 🌤️"; // 🌤️
    if (hour < 21) return "Good evening 🌆";   // 🌆
    return "Good night 🌙";                    // 🌙
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function mount() {
    if (document.querySelector(".aura-widget")) return; // guard against double-mount
    if (!document.body) return;

    var w = document.createElement("div");
    w.className = "aura-widget";
    w.innerHTML =
      '<div class="aura-clock" data-clock></div>' +
      '<div class="aura-date" data-date></div>' +
      '<div class="aura-greeting" data-greeting></div>' +
      '<div class="aura-divider"></div>' +
      '<div class="aura-quote" data-quote title="Click for another">' +
      '<span class="spark">✦</span><span data-quote-text></span></div>';
    document.body.appendChild(w);

    var elClock = w.querySelector("[data-clock]");
    var elDate = w.querySelector("[data-date]");
    var elGreet = w.querySelector("[data-greeting]");
    var elQuote = w.querySelector("[data-quote-text]");

    var dateFmt = new Intl.DateTimeFormat(undefined, {
      weekday: "long", month: "long", day: "numeric",
    });

    function tick() {
      var now = new Date();
      var h = now.getHours();
      var m = now.getMinutes();
      var ampm = h >= 12 ? "PM" : "AM";
      var h12 = h % 12 || 12;
      elClock.innerHTML = pad(h12) + ":" + pad(m) + '<span class="ampm">' + ampm + "</span>";
      elDate.textContent = dateFmt.format(now);
      elGreet.textContent = greeting(h);
    }

    // Daily intention (stable through the day), click to cycle.
    var idx = dayOfYear(new Date()) % INTENTIONS.length;
    function showQuote() { elQuote.textContent = INTENTIONS[idx % INTENTIONS.length]; }
    w.querySelector("[data-quote]").addEventListener("click", function () {
      idx = (idx + 1) % INTENTIONS.length;
      showQuote();
    });
    showQuote();

    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
