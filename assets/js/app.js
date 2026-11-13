/* Nashira Spor Kulübü — site scripts
   - language switching (EN / TR / RU)
   - header / mobile menu / reveal animations
   - court plan drawing
   - demo availability engine + booking calendar
*/
(function () {
  "use strict";

  /* ---------- Club settings (edit here) ---------- */
  var CONFIG = {
    courts: 6,
    openHour: 7,        // first slot starts 07:00
    closeHour: 24,      // last slot ends at midnight
    peakFrom: 17,       // floodlit / evening price from 17:00
    priceDay: 900,      // ₺ per court-hour
    pricePeak: 1100,
    coachPerHour: 1100, // add-on: coach on court
    rackets: 250,       // add-on: racket rental (per booking)
    balls: 200,         // add-on: new ball tube (per booking)
    daysAhead: 14,
    currency: "₺",
    whatsapp: "905072412021", // club WhatsApp number, digits only (booking requests + enquiries go here)
    // Demo only: marks some slots as "booked" at random so the calendar looks realistic.
    // Set to false before launch (all future slots then show as free) or connect a real booking system.
    demoAvailability: true
  };

  var STORE_KEY = "nashira-bookings-v1";
  var LANG_KEY = "nashira-lang";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Language ---------- */
  var I18N = window.NASHIRA_I18N || { ui: { en: {} } };
  var LANGS = ["en", "tr", "ru"];

  function pickLang() {
    var q = new URLSearchParams(location.search).get("lang");
    if (LANGS.indexOf(q) > -1) return q;
    try {
      var s = localStorage.getItem(LANG_KEY);
      if (LANGS.indexOf(s) > -1) return s;
    } catch (e) { /* storage blocked */ }
    var nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return LANGS.indexOf(nav) > -1 ? nav : "en";
  }
  var lang = pickLang();

  function t(key) {
    var ui = I18N.ui || {};
    var v = ui[lang] && ui[lang][key] != null ? ui[lang][key] : ui.en && ui.en[key];
    if (typeof v === "function") return v.apply(null, Array.prototype.slice.call(arguments, 1));
    return v != null ? v : key;
  }
  function locale() { return t("locale"); }

  var originals = new Map(); // element -> English HTML written in the page
  var rerenders = [];        // dynamic sections re-drawn on language change

  function applyLang() {
    document.documentElement.lang = lang;
    var dict = I18N[lang] || {};
    $$("[data-i18n]").forEach(function (el) {
      if (!originals.has(el)) originals.set(el, el.innerHTML);
      var v = lang === "en" ? null : dict[el.getAttribute("data-i18n")];
      el.innerHTML = v != null ? v : originals.get(el);
    });
    $$("[data-i18n-content]").forEach(function (el) {
      if (!originals.has(el)) originals.set(el, el.getAttribute("content"));
      var v = lang === "en" ? null : dict[el.getAttribute("data-i18n-content")];
      el.setAttribute("content", v != null ? v : originals.get(el));
    });
    $$("[data-amount]").forEach(function (el) { el.textContent = money(+el.getAttribute("data-amount")); });
    $$("[data-setlang]").forEach(function (b) {
      var on = b.getAttribute("data-setlang") === lang;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    rerenders.forEach(function (fn) { fn(); });
  }

  function setLang(l) {
    if (LANGS.indexOf(l) < 0 || l === lang) return;
    lang = l;
    try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* storage blocked */ }
    if (history.replaceState) {
      var u = new URL(location.href);
      u.searchParams.set("lang", l);
      history.replaceState(null, "", u);
    }
    applyLang();
  }

  $$("[data-setlang]").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-setlang")); });
  });

  /* ---------- Helpers ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseKey(k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function hh(h) { return pad(h % 24) + ":00"; }
  function money(n) { return CONFIG.currency + n.toLocaleString(locale()); }
  function priceFor(h) { return h >= CONFIG.peakFrom ? CONFIG.pricePeak : CONFIG.priceDay; }
  function fmtDay(d, opts) { return d.toLocaleDateString(locale(), opts); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rand(key) {
    var x = (hashStr(key) + 0x6d2b79f5) | 0;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  function loadMine() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveMine(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  var mine = loadMine();

  function isMine(dk, court, hour) {
    return mine.some(function (b) { return b.date === dk && b.court === court && b.hour === hour; });
  }

  /* Demo occupancy: realistic, stable per date/court/hour */
  function isTaken(dk, court, hour) {
    if (!CONFIG.demoAvailability) return false;
    var d = parseKey(dk), wknd = d.getDay() === 0 || d.getDay() === 6;
    var p;
    if (hour < 10) p = 0.42;
    else if (hour < 16) p = 0.22;
    else if (hour < 18) p = 0.5;
    else if (hour < 22) p = 0.72;
    else p = 0.35;
    if (wknd) p += 0.12;
    var ahead = Math.round((d - parseKey(dateKey(new Date()))) / 864e5);
    p -= Math.min(ahead, 10) * 0.025; // days further out are emptier
    return rand(dk + "|" + court + "|" + hour) < p;
  }
  function isPast(dk, hour) {
    var now = new Date();
    return dk === dateKey(now) && hour <= now.getHours();
  }
  function status(dk, court, hour) {
    if (isMine(dk, court, hour)) return "mine";
    if (isPast(dk, hour)) return "past";
    if (isTaken(dk, court, hour)) return "booked";
    return "free";
  }

  /* ---------- Map labels follow the site language ---------- */
  var mapFrame = $(".map-frame iframe");
  if (mapFrame) {
    rerenders.push(function () {
      var u = new URL(mapFrame.getAttribute("src"), location.href);
      if (u.searchParams.get("hl") === lang) return;
      u.searchParams.set("hl", lang);
      mapFrame.setAttribute("src", u.toString());
    });
  }

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  /* ---------- Header & menu ---------- */
  var header = $("#header");
  function onScroll() {
    if (header && !header.classList.contains("solid")) header.classList.toggle("scrolled", window.scrollY > 40);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var burger = $("#burger");
  if (burger) {
    burger.addEventListener("click", function () {
      var open = document.body.classList.toggle("menu-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    $$("#nav a").forEach(function (a) {
      a.addEventListener("click", function () {
        document.body.classList.remove("menu-open");
        burger.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---------- Reveal on scroll ---------- */
  var reveals = $$(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  $$(".year").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Stats count up when they come into view ---------- */
  var counters = $$("[data-count]");
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (counters.length && "IntersectionObserver" in window && !calm) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        countIO.unobserve(e.target);
        var el = e.target, end = +el.getAttribute("data-count"), t0 = null, dur = 1400;
        el.textContent = "0";
        requestAnimationFrame(function step(ts) {
          if (t0 === null) t0 = ts;
          var k = Math.min((ts - t0) / dur, 1);
          el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
        });
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { countIO.observe(el); });
  }

  /* ---------- Gentle hero parallax (text drifts, court lags behind its frame) ---------- */
  var heroText = $(".hero-text"), courtWrap = $(".hero-art .court-wrap"), courtFrame = $(".hero-art .frame");
  if (heroText && courtWrap && !calm && window.matchMedia("(min-width: 961px)").matches) {
    var ticking = false;
    var parallax = function () {
      ticking = false;
      var y = Math.min(window.scrollY, window.innerHeight);
      heroText.style.transform = "translate3d(0," + (y * 0.16).toFixed(1) + "px,0)";
      heroText.style.opacity = Math.max(0, 1 - y / (window.innerHeight * 0.85)).toFixed(3);
      courtWrap.style.transform = "translate3d(0," + (y * 0.1).toFixed(1) + "px,0)";
      courtFrame.style.transform = "translate3d(18px," + (18 + y * 0.04).toFixed(1) + "px,0)";
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(parallax); }
    }, { passive: true });
    parallax();
  }

  /* ---------- Sticky "Book a court" bar on phones ---------- */
  var mobileCta = $("#mobileCta");
  if (mobileCta) {
    var heroEl = $(".hero");
    var toggleCta = function () {
      var past = window.scrollY > (heroEl ? heroEl.offsetHeight * 0.6 : 400);
      var nearEnd = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 160;
      mobileCta.classList.toggle("show", past && !nearEnd);
    };
    window.addEventListener("scroll", toggleCta, { passive: true });
    toggleCta();
  }

  /* ---------- Court plan (facilities) ---------- */
  var map = $("#courtMap");
  if (map) {
    rerenders.push(function drawMap() {
      var svg = "";
      var L = function (x1, y1, x2, y2) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>'; };
      for (var i = 0; i < CONFIG.courts; i++) {
        var x = 40 + (i % 2) * 270, y = 20 + Math.floor(i / 2) * 165;
        svg += '<a href="booking.html?court=' + (i + 1) + '" class="map-court" aria-label="' + t("court") + " " + (i + 1) + '">' +
          '<rect class="surface" x="' + x + '" y="' + y + '" width="250" height="120" fill="#b85a35"/>' +
          '<g stroke="#fbf6ee" stroke-width="1.6" fill="none" opacity=".92">' +
          '<rect x="' + (x + 30) + '" y="' + (y + 16) + '" width="190" height="88"/>' +
          L(x + 30, y + 27, x + 220, y + 27) + L(x + 30, y + 93, x + 220, y + 93) +
          L(x + 73.8, y + 27, x + 73.8, y + 93) + L(x + 176.2, y + 27, x + 176.2, y + 93) +
          L(x + 73.8, y + 60, x + 176.2, y + 60) +
          L(x + 30, y + 60, x + 35, y + 60) + L(x + 215, y + 60, x + 220, y + 60) +
          "</g>" +
          '<line x1="' + (x + 125) + '" y1="' + (y + 8) + '" x2="' + (x + 125) + '" y2="' + (y + 112) + '" stroke="#0e2442" stroke-width="2.4"/>' +
          '<circle cx="' + (x + 7) + '" cy="' + (y + 7) + '" r="2.4" fill="#b3925a"/>' +
          '<circle cx="' + (x + 243) + '" cy="' + (y + 7) + '" r="2.4" fill="#b3925a"/>' +
          '<circle cx="' + (x + 7) + '" cy="' + (y + 113) + '" r="2.4" fill="#b3925a"/>' +
          '<circle cx="' + (x + 243) + '" cy="' + (y + 113) + '" r="2.4" fill="#b3925a"/>' +
          '<text x="' + x + '" y="' + (y + 142) + '" fill="#142b4f" font-family="Jost, sans-serif" font-size="11" letter-spacing="3.2">' + t("courtCaps") + " 0" + (i + 1) + "</text>" +
          '<text x="' + (x + 250) + '" y="' + (y + 142) + '" text-anchor="end" fill="#b3925a" font-family="Oswald, sans-serif" font-weight="500" font-size="13" letter-spacing="0.6">' + t("mapBook") + "</text>" +
          "</a>";
      }
      svg += '<rect x="40" y="515" width="520" height="56" fill="none" stroke="#b3925a" stroke-width="1"/>' +
        '<rect x="46" y="521" width="508" height="44" fill="rgba(255,255,255,.55)"/>' +
        '<text x="300" y="548" text-anchor="middle" fill="#142b4f" font-family="Jost, sans-serif" font-size="11.5" letter-spacing="4">' + t("clubhouse") + "</text>";
      map.innerHTML = svg;
    });
  }

  /* ---------- "Open slots today" teaser ---------- */
  var todayRows = $("#todayRows");
  if (todayRows) {
    rerenders.push(function drawToday() {
      var now = new Date();
      var isTmrw = now.getHours() >= CONFIG.closeHour - 1;
      var day = isTmrw ? addDays(now, 1) : now;
      var dk = dateKey(day);
      $("#todayTitle").textContent = isTmrw ? t("openTomorrow") : t("openToday");
      $("#todayLabel").textContent = (isTmrw ? t("tomorrow") : t("today")) + " · " + fmtDay(day, { weekday: "short", day: "numeric", month: "short" });
      var html = "";
      for (var c = 1; c <= CONFIG.courts; c++) {
        var free = [];
        for (var h = CONFIG.openHour; h < CONFIG.closeHour && free.length < 4; h++) {
          if (status(dk, c, h) === "free") free.push(h);
        }
        html += '<div class="today-row"><b>' + t("court") + " " + c + '</b><div class="today-slots">' +
          (free.length ? free.map(function (h) {
            return '<a href="booking.html?date=' + dk + "&court=" + c + "&hour=" + h + '">' + hh(h) + "</a>";
          }).join("") : "<em>" + t("fullyBooked") + "</em>") +
          "</div></div>";
      }
      todayRows.innerHTML = html;
    });
  }

  /* ---------- Google reviews ---------- */
  var reviewGrid = $("#reviewGrid");
  if (reviewGrid && window.NASHIRA_REVIEWS) {
    rerenders.push(function drawReviews() {
      $$(".review-card", reviewGrid).forEach(function (el) { el.remove(); });
      window.NASHIRA_REVIEWS.forEach(function (r, i) {
        var text = r.text[lang] || r.text[r.lang];
        var note = lang === r.lang || !r.text[lang] ? t("googleReview") : t("translatedFrom", r.lang);
        var fig = document.createElement("figure");
        fig.className = "review-card reveal in";
        fig.innerHTML =
          '<div class="stars" role="img" aria-label="' + r.rating + ' / 5">' + "★★★★★".slice(0, r.rating) + "</div>" +
          "<blockquote>" + esc(text) + "</blockquote>" +
          '<figcaption><span class="avatar" aria-hidden="true">' + esc(r.name.charAt(0)) + "</span>" +
          "<span><b>" + esc(r.name) + "</b><small>" + note + "</small></span></figcaption>";
        reviewGrid.appendChild(fig);
      });
    });
  }

  /* ---------- Enquiry form → WhatsApp ---------- */
  var enq = $("#enquiry");
  if (enq) {
    var WA_NUMBER = CONFIG.whatsapp;
    var enqForm = $("#enqForm"), enqDone = $("#enqDone"), enqLastFocus = null;
    var ageField = $("#eAgeField");
    var syncAge = function () {
      var c = $('input[name="eFor"]:checked');
      ageField.hidden = !c || c.value !== "child";
    };
    var openEnq = function (interest) {
      enqLastFocus = document.activeElement;
      enqForm.hidden = false; enqDone.hidden = true;
      $(".enquiry-card").scrollTop = 0;
      if (interest && $('#eInterest option[value="' + interest + '"]')) $("#eInterest").value = interest;
      if (interest === "junior") $('input[name="eFor"][value="child"]').checked = true;
      syncAge();
      enq.classList.add("open");
      document.body.style.overflow = "hidden";
      setTimeout(function () { $("#eInterest").focus(); }, 60);
    };
    var closeEnq = function () {
      enq.classList.remove("open");
      document.body.style.overflow = "";
      if (enqLastFocus && enqLastFocus.focus) enqLastFocus.focus();
    };
    $$("[data-enquire]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); openEnq(b.getAttribute("data-enquire")); });
    });
    $("#enqClose").addEventListener("click", closeEnq);
    $("#enqDoneClose").addEventListener("click", closeEnq);
    enq.addEventListener("click", function (e) { if (e.target === enq) closeEnq(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && enq.classList.contains("open")) closeEnq(); });
    $$('input[name="eFor"]').forEach(function (r) { r.addEventListener("change", syncAge); });
    $("#eInterest").addEventListener("change", function () {
      if (this.value === "junior") { $('input[name="eFor"][value="child"]').checked = true; syncAge(); }
    });

    var labelOf = function (id) { var l = $('label[for="' + id + '"]'); return l ? l.textContent.trim() : ""; };
    var legendOf = function (name) {
      var i = $('input[name="' + name + '"]');
      var lg = i && i.closest("fieldset") && $("legend", i.closest("fieldset"));
      return lg ? lg.textContent.trim() : "";
    };
    var chipText = function (input) { return input.nextElementSibling.textContent.trim(); };

    enqForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#eName"), phone = $("#ePhone"), consent = $("#eConsent");
      var ok = true;
      [name, phone].forEach(function (f) { f.parentNode.classList.remove("err"); });
      $("#eConsentWrap").classList.remove("err");
      if (name.value.trim().length < 2) { name.parentNode.classList.add("err"); ok = false; }
      if (phone.value.replace(/\D/g, "").length < 7) { phone.parentNode.classList.add("err"); ok = false; }
      if (!consent.checked) { $("#eConsentWrap").classList.add("err"); ok = false; }
      if (!ok) { toast(t("checkFields")); return; }

      var sel = $("#eInterest");
      var who = $('input[name="eFor"]:checked'), level = $('input[name="eLevel"]:checked');
      var times = $$('input[name="eWhen"]:checked').map(chipText);
      var lines = [t("enqHello"), ""];
      lines.push(labelOf("eInterest") + ": " + sel.options[sel.selectedIndex].text.trim());
      lines.push(legendOf("eFor") + ": " + chipText(who) + (who.value === "child" && $("#eAge").value ? " (" + labelOf("eAge") + ": " + $("#eAge").value + ")" : ""));
      lines.push(legendOf("eLevel") + ": " + chipText(level));
      if (times.length) lines.push(legendOf("eWhen") + ": " + times.join(", "));
      lines.push(labelOf("eName") + ": " + name.value.trim());
      lines.push(labelOf("ePhone") + ": " + phone.value.trim());
      if ($("#eMsg").value.trim()) lines.push("", $("#eMsg").value.trim());

      var url = "https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(lines.join("\n"));
      $("#enqRetry").href = url;
      $("#enqDoneTitle").textContent = t("enqThanks", name.value.trim().split(" ")[0]);
      window.open(url, "_blank", "noopener");

      enqForm.hidden = true; enqDone.hidden = false;
      $(".enquiry-card").scrollTop = 0;
      enqForm.reset(); syncAge();
      $("#enqDoneClose").focus();
    });
  }

  /* ---------- Booking calendar ---------- */
  var grid = $("#slotGrid");
  if (grid) initBooking();

  function initBooking() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var days = [];
    for (var di = 0; di < CONFIG.daysAhead; di++) days.push(addDays(today, di));
    // after the last slot has started, open on tomorrow
    var dayIdx = new Date().getHours() >= CONFIG.closeHour - 1 ? 1 : 0;
    var selected = {}; // "date|court|hour" -> {date, court, hour}

    var params = new URLSearchParams(location.search);
    var pDate = params.get("date"), pCourt = +params.get("court"), pHour = +params.get("hour");
    if (pDate) days.forEach(function (d, i) { if (dateKey(d) === pDate) dayIdx = i; });

    /* booking type: court hire, private lesson (court + coach) or free trial lesson (one slot, no charge) */
    var TYPES = ["court", "lesson", "trial"];
    var bookType = TYPES.indexOf(params.get("type")) > -1 ? params.get("type") : "court";
    var bookingSection = $(".booking"), typeTabs = $("#typeTabs");
    function slotPrice(h) {
      if (bookType === "trial") return 0;
      return priceFor(h) + (bookType === "lesson" ? CONFIG.coachPerHour : 0);
    }
    function priceLabel(h) { return bookType === "trial" ? t("freeLabel") : money(slotPrice(h)); }
    function totalLabel(sum) { return bookType === "trial" && !sum ? t("freeLabel") : money(sum); }
    function itemTitle(s) {
      var head = bookType === "lesson" ? t("lessonShort") + " · " : bookType === "trial" ? t("trialShort") + " · " : "";
      return head + t("court") + " " + s.court + " · " + hh(s.hour) + "–" + hh(s.hour + 1);
    }
    function renderType() {
      if (bookingSection) bookingSection.setAttribute("data-type", bookType);
      if (typeTabs) $$("button", typeTabs).forEach(function (b) {
        var on = b.getAttribute("data-type") === bookType;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var note = $("#typeNote");
      if (note) note.textContent = bookType === "lesson" ? t("typeNoteLesson", money(CONFIG.priceDay + CONFIG.coachPerHour))
        : bookType === "trial" ? t("typeNoteTrial") : t("typeNoteCourt");
    }

    var strip = $("#dateStrip");
    function renderDates() {
      strip.innerHTML = days.map(function (d, i) {
        var label = i === 0 ? t("todayShort") : i === 1 ? t("tomorrowShort") : fmtDay(d, { weekday: "short" });
        return '<button class="date-chip' + (i === dayIdx ? " on" : "") + '" data-i="' + i + '" aria-pressed="' + (i === dayIdx) + '">' +
          "<small>" + label + "</small><strong>" + d.getDate() + "</strong><span>" + fmtDay(d, { month: "short" }) + "</span></button>";
      }).join("");
      var on = $(".date-chip.on", strip);
      if (on) strip.scrollLeft = on.offsetLeft - strip.offsetLeft - 40;
    }
    strip.addEventListener("click", function (e) {
      var b = e.target.closest(".date-chip");
      if (!b) return;
      dayIdx = +b.getAttribute("data-i");
      renderDates(); renderGrid();
    });
    $("#datePrev").addEventListener("click", function () { strip.scrollLeft -= 240; });
    $("#dateNext").addEventListener("click", function () { strip.scrollLeft += 240; });

    var moon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

    function renderGrid() {
      var dk = dateKey(days[dayIdx]);
      var html = '<div class="gh">' + t("time") + "</div>";
      for (var c = 1; c <= CONFIG.courts; c++) html += '<div class="gh">' + t("court") + "<b>" + c + "</b></div>";
      var freeCount = 0, total = 0;
      for (var h = CONFIG.openHour; h < CONFIG.closeHour; h++) {
        html += '<div class="gt">' + (h >= CONFIG.peakFrom ? moon : "") + hh(h) + "</div>";
        for (var c2 = 1; c2 <= CONFIG.courts; c2++) {
          var st = status(dk, c2, h), key = dk + "|" + c2 + "|" + h;
          var isSel = !!selected[key];
          total++;
          if (st === "free") freeCount++;
          var label = t("court") + " " + c2 + ", " + hh(h) + " – " +
            (st === "free" ? t("available") + ", " + priceLabel(h) : st === "mine" ? t("yourBooking") : t("unavailable"));
          html += '<button class="slot ' + st + (isSel ? " sel" : "") + '" data-c="' + c2 + '" data-h="' + h + '"' +
            (st !== "free" ? " disabled" : "") + ' aria-pressed="' + isSel + '" aria-label="' + label + '">' +
            (st === "free" ? '<span class="p">' + (isSel ? "✓ " : "") + priceLabel(h) + "</span>" : st === "mine" ? t("yours") : "") +
            "</button>";
        }
      }
      grid.innerHTML = html;
      $("#dayTitle").textContent = fmtDay(days[dayIdx], { weekday: "long", day: "numeric", month: "long" });
      $("#freeCount").textContent = t("freeCount", freeCount, total);
      renderList(dk);
    }

    /* phones: "by time" (pick an hour, see free courts) or "by court" (pick a court, see its hours) */
    var courtTabs = $("#courtTabs"), slotList = $("#slotList"), viewToggle = $("#viewToggle");
    var listCourt = pCourt >= 1 && pCourt <= CONFIG.courts ? pCourt : 1;
    var listMode = pCourt ? "court" : "time";
    var listHour = pHour >= CONFIG.openHour && pHour < CONFIG.closeHour ? pHour : null;
    function freeCourtsAt(dk, h) {
      var n = 0;
      for (var c = 1; c <= CONFIG.courts; c++) if (status(dk, c, h) === "free") n++;
      return n;
    }
    function renderList(dk) {
      if (!slotList) return;
      if (viewToggle) $$("button", viewToggle).forEach(function (b) {
        var on = b.getAttribute("data-view") === listMode;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (listMode === "time") return renderByTime(dk);
      var tabs = "";
      for (var c = 1; c <= CONFIG.courts; c++) {
        var free = 0;
        for (var h = CONFIG.openHour; h < CONFIG.closeHour; h++) if (status(dk, c, h) === "free") free++;
        tabs += '<button class="court-tab' + (c === listCourt ? " on" : "") + '" data-court="' + c + '" aria-pressed="' + (c === listCourt) + '">' +
          t("court") + " " + c + "<small>" + t("freeN", free) + "</small></button>";
      }
      courtTabs.innerHTML = tabs;
      var html = "";
      for (var h2 = CONFIG.openHour; h2 < CONFIG.closeHour; h2++) {
        var st = status(dk, listCourt, h2), isSel = !!selected[dk + "|" + listCourt + "|" + h2];
        html += '<button class="slot ' + st + (isSel ? " sel" : "") + '" data-c="' + listCourt + '" data-h="' + h2 + '"' +
          (st !== "free" ? " disabled" : "") + ' aria-pressed="' + isSel + '">' +
          "<b>" + (h2 >= CONFIG.peakFrom ? moon : "") + hh(h2) + "</b>" +
          '<span class="p">' + (st === "free" ? (isSel ? "✓ " : "") + priceLabel(h2) : st === "mine" ? t("yours") : t("taken")) + "</span></button>";
      }
      slotList.innerHTML = html;
    }
    function renderByTime(dk) {
      var hours = [];
      for (var h = CONFIG.openHour; h < CONFIG.closeHour; h++) if (!isPast(dk, h)) hours.push(h);
      if (listHour === null || hours.indexOf(listHour) < 0) {
        listHour = hours.filter(function (h) { return freeCourtsAt(dk, h) > 0; })[0];
        if (listHour == null) listHour = hours[0];
      }
      courtTabs.innerHTML = hours.map(function (h) {
        return '<button class="court-tab' + (h === listHour ? " on" : "") + '" data-hour="' + h + '" aria-pressed="' + (h === listHour) + '">' +
          (h >= CONFIG.peakFrom ? moon : "") + hh(h) + "<small>" + t("freeN", freeCourtsAt(dk, h)) + "</small></button>";
      }).join("");
      var on = $(".court-tab.on", courtTabs);
      if (on) courtTabs.scrollLeft = on.offsetLeft - courtTabs.offsetLeft - 18;
      if (listHour == null) { slotList.innerHTML = ""; return; }
      var html = "";
      for (var c = 1; c <= CONFIG.courts; c++) {
        var st = status(dk, c, listHour), isSel = !!selected[dk + "|" + c + "|" + listHour];
        html += '<button class="slot ' + st + (isSel ? " sel" : "") + '" data-c="' + c + '" data-h="' + listHour + '"' +
          (st !== "free" ? " disabled" : "") + ' aria-pressed="' + isSel + '">' +
          "<b>" + t("court") + " " + c + "</b>" +
          '<span class="p">' + (st === "free" ? (isSel ? "✓ " : "") + priceLabel(listHour) : st === "mine" ? t("yours") : t("taken")) + "</span></button>";
      }
      slotList.innerHTML = html;
    }
    if (courtTabs) {
      courtTabs.addEventListener("click", function (e) {
        var b = e.target.closest(".court-tab");
        if (!b) return;
        if (b.hasAttribute("data-hour")) listHour = +b.getAttribute("data-hour");
        else listCourt = +b.getAttribute("data-court");
        renderList(dateKey(days[dayIdx]));
      });
    }
    if (viewToggle) {
      viewToggle.addEventListener("click", function (e) {
        var b = e.target.closest("[data-view]");
        if (!b || b.getAttribute("data-view") === listMode) return;
        listMode = b.getAttribute("data-view");
        renderList(dateKey(days[dayIdx]));
      });
    }

    function onSlot(e) {
      var b = e.target.closest(".slot.free");
      if (!b) return;
      var c = +b.getAttribute("data-c"), h = +b.getAttribute("data-h");
      var dk = dateKey(days[dayIdx]), key = dk + "|" + c + "|" + h;
      if (selected[key]) delete selected[key];
      else {
        if (bookType === "trial") selected = {};
        selected[key] = { date: dk, court: c, hour: h };
      }
      renderGrid(); renderSummary();
    }
    grid.addEventListener("click", onSlot);
    if (slotList) slotList.addEventListener("click", onSlot);

    if (typeTabs) {
      typeTabs.addEventListener("click", function (e) {
        var b = e.target.closest("[data-type]");
        if (!b || b.getAttribute("data-type") === bookType) return;
        bookType = b.getAttribute("data-type");
        if (bookType === "trial") {
          var keep = selArray()[0];
          selected = {};
          if (keep) selected[keep.date + "|" + keep.court + "|" + keep.hour] = keep;
          $$("#extras input").forEach(function (i) { i.checked = false; });
        }
        if (history.replaceState) {
          var u = new URL(location.href);
          if (bookType === "court") u.searchParams.delete("type"); else u.searchParams.set("type", bookType);
          history.replaceState(null, "", u);
        }
        renderType(); renderGrid(); renderSummary();
      });
    }

    /* summary */
    var selList = $("#selList"), selEmpty = $("#selEmpty"), totalEl = $("#total"), confirmBtn = $("#confirmBtn");

    /* sticky "n hours · ₺total · Continue" bar while the summary is off screen (phones/tablets) */
    var bookBar = $("#bookBar"), summaryEl = $(".summary"), summaryInView = false;
    function updateBar() {
      var show = !!Object.keys(selected).length && !summaryInView;
      bookBar.classList.toggle("show", show);
      document.body.classList.toggle("bar-on", show);
    }
    if (bookBar && summaryEl) {
      var checkSummary = function () {
        var r = summaryEl.getBoundingClientRect();
        var inView = r.top < window.innerHeight * 0.6 && r.bottom > 140;
        if (inView !== summaryInView) { summaryInView = inView; updateBar(); }
      };
      window.addEventListener("scroll", checkSummary, { passive: true });
      window.addEventListener("resize", checkSummary);
      checkSummary();
      $("#bbGo").addEventListener("click", function () {
        summaryEl.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
      });
    }
    function selArray() {
      return Object.keys(selected).map(function (k) { return selected[k]; }).sort(function (a, b) {
        return a.date < b.date ? -1 : a.date > b.date ? 1 : a.hour - b.hour || a.court - b.court;
      });
    }
    function computeTotal(items) {
      var sum = 0;
      items.forEach(function (s) { sum += slotPrice(s.hour); });
      if (items.length && bookType !== "trial") {
        if ($("#xRackets").checked) sum += CONFIG.rackets;
        if ($("#xBalls").checked) sum += CONFIG.balls;
      }
      return sum;
    }
    function renderSummary() {
      var items = selArray();
      selEmpty.style.display = items.length ? "none" : "block";
      selList.innerHTML = items.map(function (s) {
        return "<li><div><b>" + itemTitle(s) + "</b><small>" +
          fmtDay(parseKey(s.date), { weekday: "short", day: "numeric", month: "short" }) + (s.hour >= CONFIG.peakFrom ? " · " + t("floodlit") : "") +
          "</small></div><span>" + priceLabel(s.hour) + '</span><button class="rm" data-k="' + s.date + "|" + s.court + "|" + s.hour +
          '" aria-label="' + t("remove") + '">×</button></li>';
      }).join("");
      totalEl.textContent = totalLabel(computeTotal(items));
      if (bookBar) {
        $("#bbCount").textContent = bookType === "trial" ? t("trialShort") : t("barCount", items.length);
        $("#bbTotal").textContent = totalLabel(computeTotal(items));
        updateBar();
      }
      confirmBtn.disabled = !items.length;
      confirmBtn.textContent = !items.length ? t("selectSlot")
        : bookType === "lesson" ? t("lessonN", items.length)
        : bookType === "trial" ? t("trialBtn") : t("confirmN", items.length);
      $("#xRacketsPrice").textContent = "+" + money(CONFIG.rackets);
      $("#xBallsPrice").textContent = "+" + money(CONFIG.balls);
    }
    selList.addEventListener("click", function (e) {
      var b = e.target.closest(".rm");
      if (!b) return;
      delete selected[b.getAttribute("data-k")];
      renderGrid(); renderSummary();
    });
    $$("#extras input").forEach(function (i) { i.addEventListener("change", renderSummary); });

    /* submit */
    $("#bookForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var items = selArray();
      if (!items.length) return;
      var name = $("#fName"), phone = $("#fPhone"), email = $("#fEmail");
      var ok = true;
      [name, phone, email].forEach(function (f) { f.parentNode.classList.remove("err"); });
      if (name.value.trim().length < 2) { name.parentNode.classList.add("err"); ok = false; }
      if (phone.value.replace(/\D/g, "").length < 7) { phone.parentNode.classList.add("err"); ok = false; }
      if (email.value.trim() && !/^\S+@\S+\.\S+$/.test(email.value.trim())) { email.parentNode.classList.add("err"); ok = false; }
      if (!ok) { toast(t("checkFields")); return; }

      var ref = "NSH-" + Math.random().toString(36).slice(2, 7).toUpperCase();
      var totalSum = computeTotal(items);

      /* The request goes to the club on WhatsApp; the club confirms it there. */
      var labelText = function (id) { return $('label[for="' + id + '"]').textContent.trim().replace(/\s*\(.*\)$/, "").replace(/\?$/, ""); };
      var extras = $$("#extras input:checked").map(function (i) {
        return $("span > span", i.parentNode).textContent.trim();
      });
      var optText = function (id) { var sel = $("#" + id); return sel.options[sel.selectedIndex].text.trim(); };
      var hello = bookType === "lesson" ? t("lessonHello") : bookType === "trial" ? t("trialHello") : t("bookHello");
      var lines = [hello, "", t("ref") + ": " + ref, ""];
      items.forEach(function (s) {
        lines.push("• " + fmtDay(parseKey(s.date), { weekday: "short", day: "numeric", month: "short" }) + " · " +
          hh(s.hour) + "–" + hh(s.hour + 1) + " · " + t("court") + " " + s.court + (bookType === "trial" ? "" : " · " + money(slotPrice(s.hour))));
      });
      lines.push("");
      if (bookType === "lesson") lines.push(labelText("fCoach") + ": " + optText("fCoach"));
      if (bookType !== "court") {
        lines.push(labelText("fFor") + ": " + optText("fFor"));
        lines.push(labelText("fLevel") + ": " + optText("fLevel"));
      } else {
        lines.push(labelText("fPlayers") + ": " + optText("fPlayers"));
      }
      if (extras.length && bookType !== "trial") lines.push(t("extras") + ": " + extras.join(", "));
      if (bookType !== "trial") lines.push(t("totalPay") + ": " + money(totalSum));
      lines.push("");
      lines.push(labelText("fName") + ": " + name.value.trim());
      lines.push(labelText("fPhone") + ": " + phone.value.trim());
      if (email.value.trim()) lines.push(labelText("fEmail") + ": " + email.value.trim());
      var waUrl = "https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(lines.join("\n"));
      window.open(waUrl, "_blank", "noopener");
      $("#mRetry").href = waUrl;

      mine = mine.concat(items.map(function (s) { return { ref: ref, date: s.date, court: s.court, hour: s.hour }; }));
      saveMine(mine); // kept in memory for this visit even if storage is blocked

      $("#mRef").textContent = ref;
      $("#mTitle").textContent = t("mTitle", name.value.trim().split(" ")[0]);
      $("#mList").innerHTML = items.map(function (s) {
        return "<li><span>" + fmtDay(parseKey(s.date), { weekday: "short", day: "numeric", month: "short" }) + " · " + hh(s.hour) +
          "</span><span>" + (bookType === "lesson" ? t("lessonShort") + " · " : bookType === "trial" ? t("trialShort") + " · " : "") + t("court") + " " + s.court + "</span></li>";
      }).join("") + (bookType === "trial" ? "" : "<li><span><b>" + t("totalPay") + "</b></span><span><b>" + money(totalSum) + "</b></span></li>");
      openModal();

      selected = {};
      this.reset();
      $$("#extras input").forEach(function (i) { i.checked = false; });
      renderGrid(); renderSummary();
    });

    var modal = $("#modal");
    function openModal() { modal.classList.add("open"); $("#mClose").focus(); }
    function closeModal() { modal.classList.remove("open"); }
    $("#mClose").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });

    /* preselect from links like booking.html?date=…&court=3&hour=18 */
    if (pCourt && pHour && pDate) {
      var dk0 = dateKey(days[dayIdx]);
      if (status(dk0, pCourt, pHour) === "free") selected[dk0 + "|" + pCourt + "|" + pHour] = { date: dk0, court: pCourt, hour: pHour };
    }

    rerenders.push(function () { renderType(); renderDates(); renderGrid(); renderSummary(); });

    if (pCourt) {
      setTimeout(function () {
        var target = $('.slot[data-c="' + pCourt + '"]' + (pHour ? '[data-h="' + pHour + '"]' : ""), grid);
        var sc = $(".slot-scroller");
        if (target && sc) sc.scrollLeft = Math.max(0, target.offsetLeft - 120);
      }, 50);
    }
  }

  /* ---------- Go ---------- */
  applyLang();
})();
