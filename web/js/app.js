/* Upper Assam flood site.
 * Data comes from the fixed-name files in data/ written by flood_map.py --web and
 * fetch_ancillary.py. Text comes from js/i18n.js; team and GitHub link from js/config.js. */
(function () {
  "use strict";
  const D = window.FLOOD_DATA, I = window.I18N, CFG = window.SITE_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PHASES = ["before", "peak", "after"];
  const CLASS_KEYS = [null, "permanent", "flooded_receded", "flooded_persisting", "flooded_vegetation"];

  /* ---------------------------------------------------------------- language */
  let lang = "en";
  try { const s = localStorage.getItem("lang"); if (s && I[s]) lang = s; } catch (e) { /* private mode */ }
  // shareable links: ?lang=hi  ?mode=explore  ?step=4  ?at=26.94,94.58
  const Q = new URLSearchParams(location.search);
  if (I[Q.get("lang")]) lang = Q.get("lang");
  let onStatusReady = null;
  const t = (k, v) => {
    const s = (I[lang] && I[lang][k] != null) ? I[lang][k] : (I.en[k] != null ? I.en[k] : k);
    return v ? s.replace(/\{(\w+)\}/g, (m, n) => (n in v ? v[n] : m)) : s;
  };
  const renderers = [];
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t("brand");
    $$("[data-i18n]").forEach(el => (el.innerHTML = t(el.dataset.i18n)));
    $$("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $$("[data-i18n-ph]").forEach(el => el.setAttribute("placeholder", t(el.dataset.i18nPh)));
    $$(".lang .seg").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    renderers.forEach(f => f());
  }
  $$(".lang .seg").forEach(b => b.addEventListener("click", () => {
    lang = b.dataset.lang;
    try { localStorage.setItem("lang", lang); } catch (e) { /* ignore */ }
    applyLang();
  }));

  if (!D) {
    applyLang();
    const b = $("#placeholder-banner"); b.hidden = false; b.textContent = t("nodata");
    return;
  }
  const M = D.meta, S = D.stats, CS = S.conservative, G = window.FLOOD_GRIDS;
  if (M.placeholder) $("#placeholder-banner").hidden = false;
  const bust = "?v=" + encodeURIComponent(M.generated_utc);

  /* ---------------------------------------------------------------- helpers */
  const nf = (v, d = 0) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const db = (v, d = 0) => nf(v, d).replace("-", "−");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtDate = (iso, opts) => new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "hi" ? "hi-IN" : "en-GB",
    Object.assign({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }, opts));
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const dname = n => (I[lang]["district." + n] || I.en["district." + n] || n);
  const newly = c => c.flooded_persisting + c.flooded_receded;
  const range = f => {                       // [low, high] from the careful and main settings
    const hi = f(S.total.classes_km2), lo = CS ? f(CS.total.classes_km2) : hi;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  };
  const rangeTxt = ([lo, hi]) => Math.round(lo) === Math.round(hi) ? nf(hi) : `${nf(lo)}–${nf(hi)}`;
  const vars = () => {
    const [nLo, nHi] = range(newly), [wLo, wHi] = range(c => c.flooded_persisting);
    const W = S.total.water_km2;
    return {
      before: fmtDate(M.dates.before), peak: fmtDate(M.dates.peak), after: fmtDate(M.dates.after),
      d1: fmtDate(M.dates.before), d2: fmtDate(M.dates.peak), d3: fmtDate(M.dates.after),
      thr: db(M.threshold_db), thrC: CS ? db(M.conservative_threshold_db) : db(M.threshold_db),
      drop: nf(M.change_drop_db), px: nf(M.pixel_m), track: M.track, dir: t("dir." + M.direction),
      wB: nf(W.before), wP: nf(W.peak), wA: nf(W.after), ratio: nf(W.peak / Math.max(W.before, 1), 1),
      n1: dayDiff(M.dates.before, M.dates.peak), n2: dayDiff(M.dates.peak, M.dates.after),
      newLo: nf(nLo), newHi: nf(nHi), wetLo: nf(wLo), wetHi: nf(wHi),
    };
  };
  const tip = $("#tooltip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + "px"; tip.style.top = Math.max(8, top) + "px";
  }
  const hideTip = () => (tip.hidden = true);
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // map-pixel lookups share the PNG bounds (Web Mercator)
  const [[bS, bW], [bN, bE]] = M.bounds;
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const frac = ll => [(ll.lng - bW) / (bE - bW), (mercY(bN) - mercY(ll.lat)) / (mercY(bN) - mercY(bS))];

  // decoded slider grids (also used for the dB value in the click popup)
  let grids = null, dbLUT = null;
  if (G) {
    const dec = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
    grids = Object.fromEntries(PHASES.map(p => [p, dec(G.phases[p])]));
    dbLUT = new Float32Array(256);
    for (let c = 1; c < 256; c++) dbLUT[c] = G.db0 + (c - 1) * G.step;
  }
  // per-pixel status grid: a PNG inside a data URL, so reading its pixels works from file://
  let stData = null;
  const ST = window.FLOOD_STATUS;
  if (ST) {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = ST.w; c.height = ST.h;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(im, 0, 0);
      stData = x.getImageData(0, 0, ST.w, ST.h).data;
      if (onStatusReady) onStatusReady();
    };
    im.src = ST.png;
  }

  /* ---------------------------------------------------------------- 1. hero */
  renderers.push(() => {
    const v = vars(), A = S.total.valid_km2;
    $("#hero-lede").textContent = t("hero.lede", v);
    const nr = range(newly);
    const cards = [
      { k: "stat.new", r: nr, sub: t("stat.new.sub", { lo: nf(100 * nr[0] / A, 1), hi: nf(100 * nr[1] / A, 1), peak: v.peak }) },
      { k: "stat.rec", r: range(c => c.flooded_receded), sw: "flooded_receded", sub: t("stat.rec.sub", v) },
      { k: "stat.wet", r: range(c => c.flooded_persisting), sw: "flooded_persisting", sub: t("stat.wet.sub", v) },
    ];
    $("#stats").innerHTML = cards.map(c => `<div class="stat">
      <div class="label">${c.sw ? `<span class="sw ${c.sw}"></span>` : ""}${esc(t(c.k))}</div>
      <div class="value">${rangeTxt(c.r)} <span class="unit">${t("unit.km2")}</span></div>
      <div class="sub">${esc(c.sub)}</div></div>`).join("");
    const rn = $("#range-note"); rn.hidden = !CS; rn.textContent = t("range.note", v);
  });

  /* ---------------------------------------------------------------- 2. clouds vs radar */
  (function initSwipe() {
    const sw = $("#swipe"), rg = $("#swipe-range"), radar = $("#swipe-radar"), opt = $("#swipe-optical");
    let missing = false;
    radar.onload = () => (sw.style.aspectRatio = `${radar.naturalWidth} / ${radar.naturalHeight}`);
    radar.src = "data/backscatter_peak.png" + bust;
    opt.onerror = () => {
      missing = true; opt.remove();
      sw.insertAdjacentHTML("afterbegin", '<div class="swipe-missing" id="swipe-missing"></div>');
      $("#swipe-missing").textContent = t("clouds.missing");
    };
    opt.src = "data/optical_peak.jpg" + bust;
    rg.addEventListener("input", () => sw.style.setProperty("--pos", rg.value + "%"));
    renderers.push(() => {
      const v = vars(), O = window.OPTICAL || {};
      $("#clouds-p").textContent = t("clouds.p", v);
      $("#clouds-caption").textContent = missing ? "" : t("clouds.caption", { sensor: O.sensor || "MODIS", peak: v.peak });
      if (missing) $("#swipe-missing").textContent = t("clouds.missing");
    });
  })();

  /* ---------------------------------------------------------------- 3. the map */
  if (window.L) initMap();
  function initMap() {
    const B = L.latLngBounds(M.bounds);
    const map = L.map("map", { zoomSnap: 1 });
    const DB = L.geoJSON(D.districts).getBounds();
    const fit = () => {
      map.options.zoomSnap = 0;
      const z = map.getBoundsZoom(DB, false, L.point(16, 16));
      map.options.zoomSnap = 1;
      map.setView(DB.getCenter(), Math.round(z - 0.15));
    };
    fit();
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/";
    const baseDark = L.tileLayer(esri + "Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16, attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors" }).addTo(map);
    const baseSat = L.tileLayer(esri + "World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 17, attribution: "Imagery &copy; Esri" });
    L.control.scale({ imperial: false }).addTo(map);

    for (const [name, z] of [["radar", 410], ["water", 420], ["cls", 430], ["lines", 450]]) {
      map.createPane(name); map.getPane(name).style.zIndex = z;
    }
    const img = (name, pane) => L.imageOverlay(`data/${name}.png${bust}`, B, { pane, interactive: false });
    const bs = Object.fromEntries(PHASES.map(p => [p, img(`backscatter_${p}`, "radar")]));
    const wat = Object.fromEntries(PHASES.map(p => [p, img(`water_${p}`, "water")]));
    const clsMain = img("flood_classes", "cls");
    const clsCare = CS ? img("flood_classes_careful", "cls") : clsMain;
    const halo = L.geoJSON(D.districts, { pane: "lines", interactive: false, style: { color: "#111827", weight: 4, opacity: 0.35, fill: false } });
    const dist = L.geoJSON(D.districts, { pane: "lines", interactive: false, style: { color: "#ffffff", weight: 1.8, opacity: 0.95, fill: false },
      onEachFeature: (f, l) => l.bindTooltip("", { permanent: true, direction: "center", className: "district-label" }) });
    const rivers = D.rivers ? L.geoJSON(D.rivers, { pane: "lines", style: { color: "#9fd0ff", weight: 2.2, opacity: 0.95 },
      onEachFeature: (f, l) => l.bindTooltip(esc(f.properties.name), { sticky: true }) }) : null;
    const pin = L.circleMarker([0, 0], { pane: "lines", radius: 9, color: "#fff", weight: 3, fillColor: "#fab219", fillOpacity: 1, interactive: false });

    const state = { date: "peak", radar: true, water: true, classes: false, careful: false, districts: true, rivers: true, sat: false };
    const show = (layer, on) => { if (!layer) return; if (on) { if (!map.hasLayer(layer)) layer.addTo(map); } else layer.remove(); };
    function apply() {
      show(baseSat, state.sat); show(baseDark, !state.sat);
      PHASES.forEach(p => {
        show(bs[p], state.radar && p === state.date);
        show(wat[p], state.water && p === state.date);
        bs[p].setOpacity(state.classes ? 0.6 : 1);
      });
      show(clsMain, state.classes && !state.careful);
      if (clsCare !== clsMain) show(clsCare, state.classes && state.careful);
      show(halo, state.districts); show(dist, state.districts);
      show(rivers, state.rivers);
    }

    /* ---- guided story */
    const SV = CFG.storyViews || {};
    const steps = [
      { st: { date: "before", radar: false, water: false, classes: false }, view: null },
      { st: { date: "before", radar: true, water: true, classes: false }, view: null },
      { st: { date: "peak", radar: true, water: true, classes: false }, view: null },
      { st: { date: "peak", radar: true, water: false, classes: true }, view: SV.sivasagar },
      { st: { date: "after", radar: true, water: true, classes: false }, view: null },
      { st: { date: "peak", radar: true, water: false, classes: true, careful: true }, view: SV.southJorhat },
    ];
    let step = 0, mode = "story";
    function renderStory() {
      const v = vars(), n = step + 1;
      $("#story-count").textContent = t("story.count", { n, total: steps.length });
      $("#story-dots").innerHTML = steps.map((_, i) => `<span class="${i <= step ? "on" : ""}"></span>`).join("");
      $("#story-title").textContent = t(`s${n}.t`, v);
      $("#story-text").textContent = t(`s${n}.p`, v);
      $("#story-back").disabled = step === 0;
      $("#story-next").textContent = t(step === steps.length - 1 ? "btn.explore" : "btn.next");
    }
    function go(i) {
      step = Math.max(0, Math.min(steps.length - 1, i));
      Object.assign(state, { careful: false, districts: true, rivers: true, sat: false }, steps[step].st);
      map.closePopup(); pin.remove();
      apply();
      const v = steps[step].view;
      if (v) map.setView([v[0], v[1]], v[2]); else fit();
      renderStory();
    }
    $("#story-back").addEventListener("click", () => go(step - 1));
    $("#story-next").addEventListener("click", () => (step === steps.length - 1 ? setMode("explore") : go(step + 1)));

    /* ---- explore freely */
    const LAYERS = ["radar", "water", "classes", "districts", ...(rivers ? ["rivers"] : []), "sat"];
    function renderControls() {
      $("#date-tabs").innerHTML = PHASES.map(p =>
        `<button class="seg" data-date="${p}" aria-pressed="${p === state.date}">${esc(t("phase." + p))}<small>${fmtDate(M.dates[p], { year: undefined })}</small></button>`).join("");
      $("#layer-checks").innerHTML = LAYERS.map(k =>
        `<label class="check"><input type="checkbox" data-layer="${k}"${state[k] ? " checked" : ""}><span>${esc(t("layer." + k))}</span></label>`).join("");
      $$("#date-tabs .seg").forEach(b => b.addEventListener("click", () => { state.date = b.dataset.date; apply(); renderControls(); }));
      $$("#layer-checks input").forEach(c => c.addEventListener("change", () => { state[c.dataset.layer] = c.checked; apply(); }));
    }
    function setMode(m) {
      mode = m;
      $$(".modes .seg").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
      $("#story-panel").hidden = m !== "story";
      $("#explore-panel").hidden = m !== "explore";
      if (m === "story") go(step);
      else { state.careful = false; fit(); apply(); renderControls(); }
    }
    $$(".modes .seg").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));

    /* ---- click any pixel */
    function statusAt(ll) {
      if (!stData) return { loading: true };
      const [fx, fy] = frac(ll);
      if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
      const i = (Math.floor(fy * ST.h) * ST.w + Math.floor(fx * ST.w)) * 4;
      const bits = stData[i];
      if (!(bits & 1)) return null;
      const dbv = PHASES.map(p => {
        if (!grids) return null;
        const c = grids[p][Math.floor(fy * G.h) * G.w + Math.floor(fx * G.w)];
        return c ? dbLUT[c] : null;
      });
      return { main: PHASES.map((_, k) => (bits >> (1 + k)) & 1), care: PHASES.map((_, k) => (bits >> (4 + k)) & 1),
               cls: stData[i + 1], clsC: stData[i + 2], dbv };
    }
    const verdict = (cls, w) => t(cls ? "pop.v" + cls : (w.some(Boolean) ? "pop.v0w" : "pop.v0"), vars());
    function popupAt(ll) {
      const s = statusAt(ll);
      let html;
      if (!s) html = `<div class="pop"><p>${esc(t("pop.outside"))}</p></div>`;
      else if (s.loading) html = `<div class="pop"><p>${esc(t("pop.loading"))}</p></div>`;
      else {
        const rows = PHASES.map((p, k) => `<tr><td>${fmtDate(M.dates[p])}</td>
          <td><span class="st"><span class="dot${s.main[k] ? " w" : ""}"></span>${esc(t(s.main[k] ? "pop.water" : "pop.dry"))}</span></td>
          <td class="num">${s.dbv[k] != null ? db(s.dbv[k], 1) + " dB" : ""}</td></tr>`).join("");
        const vm = verdict(s.cls, s.main), vc = verdict(s.clsC, s.care);
        html = `<div class="pop"><h4>${esc(t("pop.title"))}</h4><table>${rows}</table><p>${esc(vm)}</p>` +
          (CS ? `<p class="sub">${esc(t("pop.careful", { v: vm === vc ? t("pop.same") : vc }))}</p>` : "") +
          `<p class="sub">${nf(ll.lat, 4)}° N, ${nf(ll.lng, 4)}° E</p></div>`;
      }
      L.popup({ maxWidth: 300 }).setLatLng(ll).setContent(html).openOn(map);
    }
    map.on("click", e => popupAt(e.latlng));

    /* ---- village search */
    const P = window.PLACES, search = $("#search"), out = $("#search-results");
    if (!P || !P.length) search.disabled = true;
    function runSearch() {
      const q = search.value.trim().toLowerCase();
      if (!P || !P.length) { out.innerHTML = `<p>${esc(t("search.off"))}</p>`; return; }
      if (q.length < 2) { out.innerHTML = ""; return; }
      const a = [], b = [];
      for (let i = 0; i < P.length && a.length < 8; i++) {
        const n = P[i][0].toLowerCase();
        if (n.startsWith(q)) a.push(i); else if (b.length < 8 && n.includes(q)) b.push(i);
      }
      const hits = a.concat(b).slice(0, 8);
      out.innerHTML = hits.length
        ? hits.map(i => `<button class="btn ghost" data-i="${i}">${esc(P[i][0])} <span class="muted">${nf(P[i][1], 2)}° N, ${nf(P[i][2], 2)}° E</span></button>`).join("")
        : `<p>${esc(t("search.none"))}</p>`;
      $$("button", out).forEach(btn => btn.addEventListener("click", () => {
        const p = P[+btn.dataset.i], ll = L.latLng(p[1], p[2]);
        map.setView(ll, 13); pin.setLatLng(ll).addTo(map); popupAt(ll);
        $("#map").scrollIntoView({ block: "nearest" });
      }));
    }
    search.addEventListener("input", runSearch);

    renderers.push(() => {
      dist.eachLayer(l => l.setTooltipContent(esc(dname(l.feature.properties.name))));
      map.closePopup();
      renderStory(); renderControls(); runSearch();
    });
    const qs = parseInt(Q.get("step"), 10);
    if (qs >= 1 && qs <= steps.length) step = qs - 1;
    setMode(Q.get("mode") === "explore" ? "explore" : "story");
    const at = (Q.get("at") || "").split(",").map(Number);
    if (at.length === 2 && at.every(isFinite)) {
      const open = () => { const ll = L.latLng(at[0], at[1]); map.setView(ll, 13); pin.setLatLng(ll).addTo(map); popupAt(ll); };
      if (stData) open(); else onStatusReady = open;
    }
  }

  /* ---------------------------------------------------------------- 4. be the scientist */
  let sciRedraw = () => {};
  if (window.L && G) initScientist(); else $("#scientist").hidden = true;
  function initScientist() {
    const W = G.w, H = G.h, rowA = G.row_km2;
    const B0 = -30, BW = 0.5, NB = 70, hist = {}, total = {};
    for (const p of PHASES) {
      const h = new Float64Array(NB), g = grids[p]; let tot = 0;
      for (let y = 0; y < H; y++) {
        const a = rowA[y], o = y * W;
        for (let x = 0; x < W; x++) {
          const c = g[o + x]; if (!c) continue;
          h[Math.min(NB - 1, Math.max(0, Math.floor((dbLUT[c] - B0) / BW)))] += a; tot += a;
        }
      }
      hist[p] = h; total[p] = tot;
    }
    // what an automatic (Otsu) split of the pooled histogram would pick
    const auto = (() => {
      const pooled = new Float64Array(NB);
      PHASES.forEach(p => hist[p].forEach((v, i) => (pooled[i] += v)));
      let tot = 0, sum = 0; pooled.forEach((v, i) => { tot += v; sum += v * (B0 + (i + 0.5) * BW); });
      let wB = 0, sB = 0, best = -1, th = 0;
      for (let i = 0; i < NB - 1; i++) {
        wB += pooled[i]; if (!wB) continue;
        const wF = tot - wB; if (!wF) break;
        sB += pooled[i] * (B0 + (i + 0.5) * BW);
        const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
        if (v > best) { best = v; th = B0 + (i + 1) * BW; }
      }
      return th;
    })();
    const presets = [
      { key: "auto", v: auto }, { key: "main", v: M.threshold_db },
      ...(CS ? [{ key: "careful", v: M.conservative_threshold_db }] : []),
      { key: "strict", v: CFG.strictThresholdDb != null ? CFG.strictThresholdDb : -18 },
    ];
    let thr = M.threshold_db, date = "peak";
    const selD = $("#sci-date"), slider = $("#sci-thr");
    slider.value = thr;

    const map = L.map("sci-map", { zoomSnap: 1 });
    const DB = L.geoJSON(D.districts).getBounds();
    map.options.zoomSnap = 0;
    const z = map.getBoundsZoom(DB, false, L.point(10, 10));
    map.options.zoomSnap = 1;
    map.setView(DB.getCenter(), Math.round(z - 0.15));
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 16, attribution: "Basemap &copy; Esri" }).addTo(map);
    const B = L.latLngBounds(M.bounds);
    const bsLayer = L.imageOverlay(`data/backscatter_${date}.png${bust}`, B, { interactive: false }).addTo(map);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), im = ctx.createImageData(W, H), px = im.data;
    const wLayer = L.imageOverlay(cv.toDataURL(), B, { interactive: false }).addTo(map);
    L.geoJSON(D.districts, { interactive: false, style: { color: "#ffffff", weight: 1.5, fill: false } }).addTo(map);

    const cellM = Math.round(Math.sqrt(rowA[Math.floor(H / 2)]) * 100) * 10;
    const official = v => Math.abs(v - M.threshold_db) < 0.05 ? S.total.water_km2[date]
      : CS && Math.abs(v - M.conservative_threshold_db) < 0.05 ? CS.total.water_km2[date] : null;
    const explain = v => t(v >= -12.5 ? "sci.e1" : v >= -16 ? "sci.e2" : v >= -17.5 ? "sci.e3" : "sci.e4");

    function drawHist() {
      const el = $("#sci-hist"), h = hist[date];
      const Wd = Math.max(260, el.clientWidth || 360), Hd = 210, padL = 6, padR = 6, padT = 52, axisH = 22;
      const x0 = -28, x1 = 2, sx = v => padL + (v - x0) / (x1 - x0) * (Wd - padL - padR);
      const maxV = Math.max(...h) || 1, sy = v => (Hd - axisH) - v / maxV * (Hd - axisH - padT);
      let s = `<svg viewBox="0 0 ${Wd} ${Hd}" width="${Wd}" height="${Hd}" role="img" aria-label="${esc(t("sci.hist.aria"))}">`;
      for (let i = 0; i < NB; i++) {
        const lo = B0 + i * BW; if (lo < x0 || lo + BW > x1) continue;
        const xa = sx(lo), w = Math.max(1, sx(lo + BW) - xa - 1), y = sy(h[i]);
        s += `<rect class="bar${lo + BW <= thr ? " wet" : ""}" x="${xa}" y="${y}" width="${w}" height="${Hd - axisH - y}" data-i="${i}"/>`;
      }
      s += `<line class="base" x1="${padL}" x2="${Wd - padR}" y1="${Hd - axisH}" y2="${Hd - axisH}"/>`;
      for (let v = -25; v <= 0; v += 5) s += `<text x="${sx(v)}" y="${Hd - 6}" text-anchor="middle">${db(v)}</text>`;
      presets.slice().sort((a, b) => a.v - b.v).forEach((p, k) => {
        const x = sx(p.v), ly = 12 + (k % 3) * 13;
        s += `<line class="mark" x1="${x}" x2="${x}" y1="${ly + 3}" y2="${Hd - axisH}"/>` +
             `<text class="lab" x="${x}" y="${ly}" text-anchor="middle">${esc(t("pre." + p.key))}</text>`;
      });
      s += `<line class="thr" x1="${sx(thr)}" x2="${sx(thr)}" y1="${padT - 6}" y2="${Hd - axisH}"/></svg>`;
      el.innerHTML = s;
      $$("rect", el).forEach(r => {
        const i = +r.dataset.i, lo = B0 + i * BW;
        const html = `<strong>${db(lo, 1)} … ${db(lo + BW, 1)} dB</strong><br>${nf(h[i], 1)} ${t("unit.km2")}`;
        r.addEventListener("pointermove", e => showTip(html, e.clientX, e.clientY));
        r.addEventListener("pointerleave", hideTip);
      });
    }
    let raf = 0;
    function render() {
      raf = 0;
      const g = grids[date]; let area = 0;
      for (let y = 0; y < H; y++) {
        const o = y * W; let n = 0;
        for (let x = 0; x < W; x++) {
          const i = o + x, c = g[i], j = i * 4;
          if (c && dbLUT[c] < thr) { px[j] = 42; px[j + 1] = 120; px[j + 2] = 214; px[j + 3] = 225; n++; }
          else px[j + 3] = 0;
        }
        area += n * rowA[y];
      }
      ctx.putImageData(im, 0, 0);
      wLayer.setUrl(cv.toDataURL());
      $("#sci-val").textContent = `${db(thr, 1)} dB`;
      $("#sci-area").textContent = `≈ ${nf(area)} ${t("unit.km2")}`;
      const off = official(thr);
      $("#sci-share").textContent = t("sci.share", { pct: nf(100 * area / total[date], 1), date: fmtDate(M.dates[date]), cell: cellM }) +
        (off != null ? " " + t("sci.full", { px: nf(M.pixel_m), v: nf(off) }) : "");
      $("#sci-explain").textContent = explain(thr);
      $$("#sci-presets .seg").forEach(b => b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.v - thr) < 0.05)));
      drawHist();
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };
    slider.addEventListener("input", () => { thr = +slider.value; schedule(); });
    selD.addEventListener("change", () => { date = selD.value; bsLayer.setUrl(`data/backscatter_${date}.png${bust}`); schedule(); });
    renderers.push(() => {
      selD.innerHTML = PHASES.map(p => `<option value="${p}">${esc(t("phase." + p))} · ${fmtDate(M.dates[p])}</option>`).join("");
      selD.value = date;
      $("#sci-presets").innerHTML = presets.map(p =>
        `<button class="seg" data-v="${p.v}" aria-pressed="false">${esc(t("pre." + p.key))} · ${p.key === "auto" ? "≈ " : ""}${db(p.v, p.key === "auto" ? 1 : 0)} dB</button>`).join("");
      $$("#sci-presets .seg").forEach(b => b.addEventListener("click", () => {
        thr = Math.round(+b.dataset.v * 10) / 10; slider.value = thr; schedule();
      }));
      render();
    });
    sciRedraw = drawHist;
  }

  /* ---------------------------------------------------------------- 6. rainfall chart slot */
  function drawRain() {
    const R = window.RAINFALL_DATA, el = $("#rain-chart");
    if (!R || !R.days || !R.days.length) {
      el.innerHTML = `<div class="slot">${esc(t("rain.missing"))}</div>`;
      $("#rain-caption").textContent = ""; return;
    }
    const Wd = Math.max(300, el.clientWidth || 700), Hd = 270, padL = 36, padR = 10, padT = 34, axisH = 26;
    const n = R.days.length, bw = (Wd - padL - padR) / n, max = niceMax(Math.max(...R.mm));
    const sy = v => (Hd - axisH) - v / max * (Hd - axisH - padT), sx = i => padL + i * bw;
    let s = `<svg viewBox="0 0 ${Wd} ${Hd}" width="${Wd}" height="${Hd}" role="img" aria-label="${esc(t("rain.aria"))}">`;
    for (let k = 0; k <= 4; k++) {
      const v = max / 4 * k, y = sy(v);
      s += `<line class="grid" x1="${padL}" x2="${Wd - padR}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${nf(v)}</text>`;
    }
    R.days.forEach((d, i) => {
      if (d.endsWith("-01")) s += `<text x="${sx(i)}" y="${Hd - 7}">${fmtDate(d, { day: undefined, year: undefined })}</text>` +
        `<line class="base" x1="${sx(i)}" x2="${sx(i)}" y1="${Hd - axisH}" y2="${Hd - axisH + 5}"/>`;
      const y = sy(R.mm[i]);
      if (R.mm[i] > 0) s += `<rect class="bar rain" x="${sx(i) + 0.5}" y="${y}" width="${Math.max(1, bw - 1)}" height="${Hd - axisH - y}"/>`;
    });
    PHASES.forEach((p, k) => {
      const i = R.days.indexOf(M.dates[p]); if (i < 0) return;
      const x = sx(i) + bw / 2, anchor = x > Wd - 60 ? "end" : x < padL + 40 ? "start" : "middle";
      s += `<line class="mark" x1="${x}" x2="${x}" y1="${padT - 8}" y2="${Hd - axisH}"/>` +
           `<text class="lab" x="${x}" y="${padT - 14 - (k % 2) * 0}" text-anchor="${anchor}">${esc(t("phase." + p))}</text>`;
    });
    s += `<line class="base" x1="${padL}" x2="${Wd - padR}" y1="${Hd - axisH}" y2="${Hd - axisH}"/>` +
         `<rect class="hit" x="${padL}" y="${padT}" width="${Wd - padL - padR}" height="${Hd - axisH - padT}"/></svg>`;
    el.innerHTML = s;
    const hit = $(".hit", el);
    const move = e => {
      const r = hit.getBoundingClientRect();
      const i = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * n)));
      showTip(`<strong>${fmtDate(R.days[i])}</strong><br>${t("rain.tip", { mm: nf(R.mm[i], 1) })}`, e.clientX, e.clientY);
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", hideTip);
    $("#rain-caption").textContent = t("rain.caption", { source: R.source });
  }
  renderers.push(drawRain);

  /* ---------------------------------------------------------------- 7. results */
  let resSel = "main";
  renderers.push(function drawResults() {
    const v = vars(), src = resSel === "careful" && CS ? CS : S;
    const tg = $("#res-toggle"); tg.hidden = !CS;
    tg.innerHTML = `<button class="seg" data-k="main" aria-pressed="${resSel === "main"}">${t("res.main", { thr: v.thr })}</button>` +
      `<button class="seg" data-k="careful" aria-pressed="${resSel === "careful"}">${t("res.careful", { thr: v.thrC })}</button>`;
    $$(".seg", tg).forEach(b => b.addEventListener("click", () => { resSel = b.dataset.k; drawResults(); }));
    const rows = src.districts.slice().sort((a, b) => newly(b.classes_km2) - newly(a.classes_km2)).concat([src.total]);
    const sw = k => `<span class="sw ${k}"></span>`;
    $("#res-table").innerHTML = `<table class="data"><thead><tr>
      <th>${t("col.district")}</th><th>${t("col.new")}</th>
      <th>${sw("flooded_persisting")}${t("col.wet", v)}</th><th>${sw("flooded_receded")}${t("col.rec", v)}</th>
      <th>${sw("permanent")}${t("col.perm")}</th><th>${sw("flooded_vegetation")}${t("col.veg")}</th><th>${t("col.area")}</th></tr></thead><tbody>` +
      rows.map(d => { const c = d.classes_km2, tot = d === src.total; return `<tr${tot ? ' class="total"' : ""}>
        <td>${esc(tot ? t("total.name") : dname(d.name))}</td><td>${nf(newly(c), 1)}</td><td>${nf(c.flooded_persisting, 1)}</td>
        <td>${nf(c.flooded_receded, 1)}</td><td>${nf(c.permanent, 1)}</td><td>${nf(c.flooded_vegetation, 1)}</td><td>${nf(d.valid_km2)}</td></tr>`; }).join("") +
      `</tbody></table>`;
  });
  const CHECKS = [[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"], [5, "warn"], [6, "no"], [7, "no"]];
  const ICON = { ok: "✓", warn: "!", no: "?" };
  renderers.push(() => {
    $("#checklist").innerHTML = CHECKS.map(([i, k]) =>
      `<li><span class="badge ${k}"><span aria-hidden="true">${ICON[k]}</span>${esc(t("check." + k))}</span><span>${esc(t("check." + i))}</span></li>`).join("");
  });

  /* ---------------------------------------------------------------- 8. notes, sources, team */
  renderers.push(() => {
    const v = vars();
    $("#notes-list").innerHTML = [1, 2, 3, 4, 5, 6].map(i => `<li>${esc(t("notes." + i, v))}</li>`).join("");
    $("#scene-table").innerHTML = `<table class="data"><thead><tr><th>${t("scene.date")}</th><th style="text-align:left">${t("scene.role")}</th><th style="text-align:left">${t("scene.file")}</th></tr></thead><tbody>` +
      PHASES.map(p => `<tr><td>${fmtDate(M.dates[p])}</td><td class="left">${esc(t("phase." + p))}</td><td class="mono">${esc(M.scenes[p])}</td></tr>`).join("") + `</tbody></table>`;
    const hide = (k, on) => { const el = $(`[data-i18n="${k}"]`); if (el) el.hidden = !on; };
    if (window.RAINFALL_DATA) $('[data-i18n="src.5"]').textContent = t("src.5", { source: window.RAINFALL_DATA.source });
    hide("src.2", !!window.OPTICAL); hide("src.4", !!(window.PLACES && window.PLACES.length)); hide("src.5", !!window.RAINFALL_DATA);
    const team = CFG.team || [];
    $("#team").innerHTML = team.length ? `<ul class="plain-list">${team.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`
      : `<p class="todo">${esc(t("team.empty"))}</p>`;
    $("#github").innerHTML = /^https:\/\//.test(CFG.github || "")
      ? `<a class="btn" href="${esc(CFG.github)}" rel="noopener">${esc(t("gh.link"))}</a>`
      : `<p class="todo">${esc(t("gh.empty"))}</p>`;
    $("#generated").textContent = t("generated", { when: M.generated_utc.replace("T", " ").replace("Z", " UTC") });
  });

  // sections fade up as they scroll into view
  if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
    $$("main > section").forEach(s => { s.classList.add("reveal"); io.observe(s); });
  }
  applyLang();
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawRain(); sciRedraw(); }, 150); });
})();
