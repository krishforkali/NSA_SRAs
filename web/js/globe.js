/* globe.html: globe intro -> fly to Assam -> pin -> story panel -> explore.
 * Data: data/site_data.js, globe_layers.js (overlays as data URLs, so file:// works),
 * status_grid.js + db_grids.js (click popup), optical.js. Text: js/i18n.js + js/i18n-globe.js. */
(function () {
  "use strict";
  const D = window.FLOOD_DATA, I = window.I18N, GL = window.GLOBE_LAYERS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PHASES = ["before", "peak", "after"];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Q = new URLSearchParams(location.search);
  const PIN_AT = [94.63, 26.98];            // Sivasagar town
  const PITCH_M2 = 105 * 68;                 // one football pitch

  /* ---------------------------------------------------------------- language */
  let lang = "en";
  try { const s = localStorage.getItem("lang"); if (s && I[s]) lang = s; } catch (e) { /* private mode */ }
  if (I[Q.get("lang")]) lang = Q.get("lang");
  const t = (k, v) => {
    const s = (I[lang] && I[lang][k] != null) ? I[lang][k] : (I.en[k] != null ? I.en[k] : k);
    return v ? s.replace(/\{(\w+)\}/g, (m, n) => (n in v ? v[n] : m)) : s;
  };
  const renderers = [];
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t("g.title");
    $$("[data-i18n]").forEach(el => (el.textContent = t(el.dataset.i18n)));
    $$("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $$(".g-lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    renderers.forEach(f => f());
  }
  function setLang(l) {
    if (!I[l] || l === lang) return;
    lang = l;
    try { localStorage.setItem("lang", lang); } catch (e) { /* ignore */ }
    applyLang();
  }
  $$(".g-lang button").forEach(b => b.addEventListener("click", () => setLang(b.dataset.lang)));

  function fatal(key) {
    applyLang();
    const f = $("#fatal"); f.hidden = false;
    f.innerHTML = `<div><p>${t(key)}</p><p><a class="g-btn" href="index.html">${t("g.learn")}</a></p></div>`;
    $("#loading").classList.add("off");
  }
  const webgl = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })();
  if (!window.maplibregl || !webgl) return fatal("g.nowebgl");
  if (!D || !GL) return fatal("g.nodata");

  const M = D.meta, S = D.stats, CS = S.conservative;

  /* ---------------------------------------------------------------- helpers */
  const nf = (v, d = 0) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const dbf = (v, d = 1) => nf(v, d).replace("-", "−");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtDate = (iso, o) => new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "hi" ? "hi-IN" : "en-GB",
    Object.assign({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }, o));
  const short = iso => fmtDate(iso, { year: undefined });
  const newly = c => c.flooded_persisting + c.flooded_receded;
  const range = f => { const hi = f(S.total.classes_km2), lo = CS ? f(CS.total.classes_km2) : hi; return [Math.min(lo, hi), Math.max(lo, hi)]; };
  const rangeTxt = ([lo, hi]) => Math.round(lo) === Math.round(hi) ? nf(hi) : `${nf(lo)}–${nf(hi)}`;
  const W = S.total.water_km2;
  const vars = () => ({
    before: fmtDate(M.dates.before), peak: fmtDate(M.dates.peak), after: fmtDate(M.dates.after),
    ratio: nf(W.peak / Math.max(W.before, 1), 1),
  });

  /* ---------------------------------------------------------------- map */
  const [[bS, bW], [bN, bE]] = M.bounds;
  const corners = [[bW, bN], [bE, bN], [bE, bS], [bW, bS]];
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const globeZoom = () => Math.max(0.4, Math.log2(0.8 * Math.min(innerWidth, innerHeight) * Math.PI / 512));
  const OVER = Object.keys(GL.layers);       // radar_*, water_*, classes, classes_careful
  const sources = {
    sat: { type: "raster", tiles: [ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 18,
           attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
    ref: { type: "raster", tiles: [ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 16,
           attribution: "Labels © Esri" },
    districts: { type: "geojson", data: D.districts },
    // elevation for the 3D-terrain stop (AWS Terrain Tiles, Terrarium encoding; CORS-enabled)
    dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
           encoding: "terrarium", tileSize: 256, maxzoom: 13, attribution: "Elevation: Mapzen Terrain Tiles (AWS)" },
  };
  OVER.forEach(k => (sources[k] = { type: "image", url: GL.layers[k], coordinates: corners }));
  if (D.rivers) sources.rivers = { type: "geojson", data: D.rivers };
  const fade = d => ({ duration: d, delay: 0 });
  const layers = [{ id: "sat", type: "raster", source: "sat", paint: { "raster-fade-duration": 250 } }];
  OVER.forEach(k => layers.push({ id: k, type: "raster", source: k,
    paint: { "raster-opacity": 0, "raster-opacity-transition": fade(600), "raster-fade-duration": 0 } }));
  layers.push(
    { id: "d-halo", type: "line", source: "districts", paint: { "line-color": "#050a16", "line-width": 5, "line-opacity": 0, "line-opacity-transition": fade(1200) } },
    { id: "d-line", type: "line", source: "districts", paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0, "line-opacity-transition": fade(1200) } });
  if (D.rivers) layers.push({ id: "rivers", type: "line", source: "rivers",
    paint: { "line-color": "#9fd0ff", "line-width": 2, "line-opacity": 0, "line-opacity-transition": fade(600) } });
  layers.push({ id: "ref", type: "raster", source: "ref", paint: { "raster-opacity": 0.9 } });

  const start = { center: [62, 18], zoom: globeZoom() };
  let map;
  try {
    map = new maplibregl.Map({
      container: "map", center: start.center, zoom: start.zoom, maxPitch: 60, attributionControl: { compact: true },
      style: { version: 8, projection: { type: "globe" }, sources, layers,
               // atmosphere glow only around the whole globe; gone well before the tilted Assam view
               sky: { "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 3, 1, 4.5, 0] } },
    });
  } catch (e) { return fatal("g.nowebgl"); }
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  if (Q.has("debug")) {
    const log = ev => () => console.log("DBG " + ev, screen, JSON.stringify(map.getCenter()), map.getZoom().toFixed(2), map.getPitch().toFixed(0));
    ["load", "moveend", "idle"].forEach(ev => map.on(ev, log(ev)));
  }

  // district bounds and label positions
  let dW = 180, dS = 90, dE = -180, dN = -90;
  const labelAt = [];
  D.districts.features.forEach(f => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestA = 0;
    polys.forEach(p => {
      const r = p[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [x0, y0] = r[j], [x1, y1] = r[i], k = x0 * y1 - x1 * y0;
        a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
        dW = Math.min(dW, x1); dE = Math.max(dE, x1); dS = Math.min(dS, y1); dN = Math.max(dN, y1);
      }
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = r; }
    });
    labelAt.push([f.properties.name, best ? poleOf(best) : null]);
  });
  // label point = the spot deepest inside the district (a centroid can fall outside odd shapes)
  function poleOf(ring) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ring.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const k = Math.cos((y0 + y1) / 2 * Math.PI / 180);
    const inside = (x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const edge = (x, y) => {
      let d = Infinity;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j][0] * k, ay = ring[j][1], dx = ring[i][0] * k - ax, dy = ring[i][1] - ay, px = x * k;
        const u = Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const ex = ax + u * dx - px, ey = ay + u * dy - y; d = Math.min(d, ex * ex + ey * ey);
      }
      return d;
    };
    let best = null, bd = -1;
    const scan = (ax, bx, ay, by, n) => { for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) {
      const x = ax + (bx - ax) * a / n, y = ay + (by - ay) * b / n;
      if (!inside(x, y)) continue; const d = edge(x, y); if (d > bd) { bd = d; best = [x, y]; } } };
    scan(x0, x1, y0, y1, 28);
    if (best) { const sx = (x1 - x0) / 28, sy = (y1 - y0) / 28; scan(best[0] - sx, best[0] + sx, best[1] - sy, best[1] + sy, 8); }
    return best;
  }
  const DB = new maplibregl.LngLatBounds([dW, dS], [dE, dN]);

  /* ---------------------------------------------------------------- loading indicator */
  const loading = $("#loading");
  // shown for the first load and while overlays/tiles load in Assam; not during the globe's slow spin,
  // which fetches tiles continuously (and never goes idle)
  let loadTimer = 0, firstDone = false;
  const doneLoading = () => { clearTimeout(loadTimer); loading.classList.add("off"); };
  map.on("dataloading", () => {
    if (firstDone && (screen === "globe" || screen === "flying")) return;
    clearTimeout(loadTimer); loadTimer = setTimeout(() => loading.classList.remove("off"), 500);
  });
  map.on("idle", doneLoading);
  map.once("style.load", () => setTimeout(() => { firstDone = true; if (screen === "globe") doneLoading(); }, 3000));

  /* ---------------------------------------------------------------- state + layers */
  const state = { date: "peak", radar: true, water: true, classes: false, districts: true, rivers: true, opacity: 0.85 };
  let screen = "globe";
  const setBody = () => {
    document.body.classList.toggle("screen-globe", screen === "globe");
    document.body.classList.toggle("screen-assam", screen === "assam");
    document.body.classList.toggle("screen-explore", screen === "explore");
  };
  function paint(id, prop, v, dur) {
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, prop + "-transition", fade(reduce ? 0 : dur));
    map.setPaintProperty(id, prop, v);
  }
  function applyLayers(dur = 600) {
    const on = screen !== "globe";
    PHASES.forEach(p => {
      paint("radar_" + p, "raster-opacity", on && state.radar && p === state.date ? (state.classes ? 0.6 : 1) : 0, dur);
      paint("water_" + p, "raster-opacity", on && state.water && p === state.date ? 0.9 : 0, dur);
    });
    paint("classes", "raster-opacity", on && state.classes ? (state.classOpacity || state.opacity) : 0, dur);
    paint("classes_careful", "raster-opacity", 0, dur);
    paint("d-line", "line-opacity", on && state.districts ? 1 : 0, 1200);
    paint("d-halo", "line-opacity", on && state.districts ? 0.6 : 0, 1200);
    paint("rivers", "line-opacity", on && state.rivers ? 0.95 : 0, dur);
    // district names: hidden while the pin label invites the first tap (they sit right next to it)
    const showNames = on && state.districts && screen !== "assam";
    dLabels.forEach(m => (dSpan(m).style.opacity = showNames ? 1 : 0));
    updateLegend();
  }
  // legend: only when a radar/water/flood layer is on the map, and only the rows for those layers
  function updateLegend() {
    const shown = screen !== "globe" && !(screen === "assam" && panel.hidden);
    const k = { water: state.water, classes: state.classes, radar: state.radar };
    $("#legend").hidden = !(shown && (k.water || k.classes || k.radar));
    $$("#legend .lg").forEach(el => (el.hidden = !k[el.dataset.k]));
  }
  // district labels: hide any that would collide with another label, the pin or the UI boxes
  let labRaf = 0;
  function layoutLabels() {
    labRaf = 0;
    const pad = 4, hit = (a, b) => !(a.right + pad < b.left || b.right + pad < a.left || a.bottom + pad < b.top || b.bottom + pad < a.top);
    const ui = ["#tour-card", "#legend", "#tour", ".g-titles", ".g-right", "#panel", "#explore", "#back"]
      .map(s => $(s)).filter(el => el && !el.hidden && el.offsetParent !== null)
      .concat($$(".maplibregl-popup"))                       // click popups and coming-soon cards
      .map(el => el.getBoundingClientRect());
    const boxes = [$(".pin-label", pinEl), $(".pin-dot", pinEl)].map(el => el.getBoundingClientRect()).filter(r => r.width > 0);
    dLabels.forEach(m => {
      const el = dSpan(m); el.classList.remove("clash");
      if (el.style.opacity === "0" || !m.getElement().isConnected) return;
      const r = el.getBoundingClientRect(); if (!r.width) return;
      if (boxes.some(b => hit(r, b)) || ui.some(b => hit(r, b))) el.classList.add("clash"); else boxes.push(r);
    });
  }
  map.on("render", () => { if (!labRaf) labRaf = requestAnimationFrame(layoutLabels); });

  /* ---------------------------------------------------------------- screen 1: spinning globe */
  let spinning = false, raf = 0, last = 0, resumeT = 0;
  function spin(on) {
    spinning = on && !reduce && (screen === "globe" || (screen === "tour" && tour.i === 0));
    cancelAnimationFrame(raf);
    if (spinning) { last = performance.now(); raf = requestAnimationFrame(step); }
  }
  function step(ts) {
    if (!spinning) return;
    const dt = Math.min(64, ts - last); last = ts;
    const c = map.getCenter();
    map.jumpTo({ center: [c.lng + dt * 0.0035, c.lat] });
    raf = requestAnimationFrame(step);
  }
  let autoT = 0, autoN = 0;
  function stopAuto() { clearInterval(autoT); autoT = 0; $("#auto").textContent = ""; }
  function startAuto() {
    autoN = 4;
    const tick = () => { if (autoN <= 0) { stopAuto(); flyIn(); } else { $("#auto").textContent = t("g.auto", { n: autoN }); autoN--; } };
    tick(); autoT = setInterval(tick, 1000);
  }
  renderers.push(() => { if (autoT) $("#auto").textContent = t("g.auto", { n: autoN + 1 }); });
  ["mousedown", "touchstart", "wheel"].forEach(ev => map.on(ev, () => {
    if (screen !== "globe") return;
    stopAuto(); spin(false);
    clearTimeout(resumeT); resumeT = setTimeout(() => spin(true), 6000);
  }));
  $("#fly").addEventListener("click", () => flyIn());
  $("#watch-globe").addEventListener("click", () => startTour());   // a click, so the audio may play

  /* ---------------------------------------------------------------- screen 2: fly in, pin */
  const pinEl = document.createElement("div");
  // MapLibre sets the marker element's own opacity (globe occlusion), so fades go on an inner wrapper
  pinEl.className = "pin";
  pinEl.innerHTML = '<div class="pin-fade"><span class="pin-ring"></span><span class="pin-ring r2"></span><span class="pin-dot"></span>' +
    '<button class="pin-hit"></button><span class="pin-label"></span></div>';
  const pinIn = $(".pin-fade", pinEl);
  const pin = new maplibregl.Marker({ element: pinEl, pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat(PIN_AT);
  const pinBtn = $(".pin-hit", pinEl);
  // on the globe, the Assam pin flies in first and then opens the story panel
  let openAfterArrive = false;
  pinBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (screen === "globe") { openAfterArrive = true; flyIn(); } else openPanel("story");
  });

  /* ---- "coming soon" pins for other surface changes NISAR can see */
  const SOON = [
    { k: "wildfire", at: [-118.55, 34.07] },
    { k: "glacier", at: [-49.9, 69.17] },
    { k: "wetland", at: [89.2, 21.9] },
    { k: "earthquake", at: [37.2, 37.6] },
    { k: "subsidence", at: [106.85, -6.2] },
  ];
  const soonPop = new maplibregl.Popup({ offset: 14, className: "soon-pop", maxWidth: "290px", focusAfterOpen: true });
  const soonPins = SOON.map(p => {
    const el = document.createElement("div");
    el.className = "gpin";
    el.innerHTML = '<span class="gdot"></span><span class="glab"></span><button></button>';
    $("button", el).addEventListener("click", e => {
      e.stopPropagation(); stopAuto(); spin(false); clearTimeout(resumeT);
      soonPop.setLngLat(p.at).setHTML(`<div class="soon-card"><h4>${esc(t("soon." + p.k + ".t"))}</h4>` +
        `<p class="pl">${esc(t("soon." + p.k + ".p"))}</p><p>${esc(t("soon." + p.k + ".s"))}</p>` +
        `<span class="badge">${esc(t("soon"))}</span></div>`).addTo(map);
    });
    return { p, el, m: new maplibregl.Marker({ element: el, pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat(p.at) };
  });
  renderers.push(() => {
    soonPins.forEach(({ p, el }) => { $(".glab", el).textContent = t("soon." + p.k + ".t"); $("button", el).setAttribute("aria-label", `${t("soon." + p.k + ".t")}: ${t("soon")}`); });
    soonPop.remove();
  });
  renderers.push(() => { $(".pin-label", pinEl).textContent = t("g.pin"); pinBtn.setAttribute("aria-label", t("g.pin.aria")); });

  const dLabels = labelAt.map(([name]) => {
    const el = document.createElement("div"); el.dataset.name = name;
    el.innerHTML = '<span class="dlabel" style="opacity:0"></span>';
    return new maplibregl.Marker({ element: el, pitchAlignment: "viewport" });
  });
  const dSpan = m => m.getElement().firstChild;
  labelAt.forEach(([, at], i) => at && dLabels[i].setLngLat(at));
  renderers.push(() => dLabels.forEach(m => (dSpan(m).textContent = t("district." + m.getElement().dataset.name))));

  // zoom at which the districts fill the space left inside `pad`, worked out in Web Mercator.
  // (map.cameraForBounds measures in the current projection, which is still the globe when we
  //  start from space, and then picks a zoom that is far too low.)
  function fitZoom(pad, pitch = 0) {
    const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    // a tilted camera squashes north-south distances by roughly cos(pitch), so more height fits
    const w = Math.max(100, innerWidth - pad.left - pad.right),
          h = Math.max(100, innerHeight - pad.top - pad.bottom) / Math.cos(pitch * Math.PI / 180);
    const fx = (DB.getEast() - DB.getWest()) / 360, fy = (mercY(DB.getNorth()) - mercY(DB.getSouth())) / (2 * Math.PI);
    return Math.min(Math.log2(w / (fx * 512)), Math.log2(h / (fy * 512)));
  }
  function assamCamera() {
    const mobile = innerWidth <= 760;
    const pad = mobile ? { top: 90, bottom: 110, left: 20, right: 20 } : { top: 110, bottom: 120, left: 80, right: 80 };
    return { center: DB.getCenter(), zoom: fitZoom(pad) - 0.25, pitch: 40, bearing: -12 };
  }
  function flyIn(instant) {
    if (screen !== "globe") return;
    stopAuto(); spin(false); clearTimeout(resumeT);
    screen = "flying"; document.body.classList.remove("screen-globe");
    const cam = assamCamera();
    if (reduce || instant) { map.jumpTo(cam); arrive(); return; }
    map.flyTo(Object.assign({ duration: 7000, curve: 1.5, essential: true }, cam));
    map.once("moveend", arrive);
  }
  function arrive() {
    screen = "assam"; setBody();
    state.radar = false; state.water = false; state.classes = false; state.districts = true;
    applyLayers(1200);
    pin.addTo(map); dLabels.forEach(m => m.addTo(map));
    requestAnimationFrame(() => requestAnimationFrame(() => pinIn.classList.add("on")));
    $("#hint").hidden = false; $("#back").hidden = false;
    if (openAfterArrive) { openAfterArrive = false; openPanel("story"); }
  }

  /* ---------------------------------------------------------------- screen 3: the panel */
  const panel = $("#panel");
  let lastFocus = null, tab = "story";
  function setTab(k) {
    tab = k;
    ["story", "clouds", "numbers"].forEach(n => {
      const b = $("#t-" + n), on = n === k;
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      $("#s-" + n).hidden = !on;
    });
  }
  $$(".p-tabs button").forEach((b, i, all) => {
    b.addEventListener("click", () => setTab(b.id.slice(2)));
    b.addEventListener("keydown", e => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const n = all[(i + d + all.length) % all.length]; n.focus(); n.click(); e.preventDefault();
    });
  });
  function mapPadding() {
    if (!document.body.classList.contains("panel-open")) return { top: 0, right: 0, bottom: 0, left: 0 };
    return innerWidth <= 760 ? { top: 0, right: 0, bottom: Math.round(panel.offsetHeight * 0.85), left: 0 }
      : { top: 0, right: panel.offsetWidth, bottom: 0, left: 0 };
  }
  function openPanel(k) {
    if (screen === "globe" || screen === "flying") flyIn(true);
    lastFocus = document.activeElement;
    stopPlay(); hideSoon();
    panel.hidden = false; document.body.classList.add("panel-open");
    document.body.classList.remove("ex-open"); $("#explore").hidden = true; $("#ex-toggle").hidden = true;
    $("#hint").hidden = true;
    popup.remove();
    screen = "assam"; setBody();
    Object.assign(state, { radar: true, water: true, classes: false, districts: true });
    setTab(k || "story");
    setDate(state.date || "peak");
    requestAnimationFrame(() => { sheetSize(); map.easeTo({ padding: mapPadding(), duration: reduce ? 0 : 600 }); $("#panel-title").focus(); });
  }
  function closePanel(toExplore = true) {
    if (panel.hidden) return;
    stopPlay();
    panel.hidden = true; document.body.classList.remove("panel-open");
    map.easeTo({ padding: mapPadding(), duration: reduce ? 0 : 600 });
    if (toExplore) enterExplore();
    else if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  $("#close").addEventListener("click", () => closePanel(true));
  $("#to-explore").addEventListener("click", () => closePanel(true));
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (screen === "tour") endTour(); else if (!panel.hidden) closePanel(true);
  });
  const hideSoon = () => ($("#soon").textContent = "");
  $("#watch").addEventListener("click", () => startTour());

  // mobile bottom sheet: keep the legend just above it
  function sheetSize() {
    const h = panel.hidden ? 0 : panel.offsetHeight;
    document.documentElement.style.setProperty("--sheet-h", h + "px");
  }
  if (window.ResizeObserver) new ResizeObserver(sheetSize).observe(panel);
  addEventListener("resize", () => { sheetSize(); if (screen === "globe") map.jumpTo({ zoom: globeZoom() }); });

  /* ---- tab 1: date switch + play */
  function dateButtons(el) {
    el.innerHTML = PHASES.map(p => `<button data-date="${p}" aria-pressed="${p === state.date}">${esc(t("phase." + p))}<small>${esc(short(M.dates[p]))}</small></button>`).join("");
    $$("button", el).forEach(b => b.addEventListener("click", () => { stopPlay(); setDate(b.dataset.date); }));
  }
  function renderStoryText() {
    const p = state.date, v = vars();
    $("#p-date").textContent = `${t("phase." + p)} · ${fmtDate(M.dates[p])}`;
    $("#p-text").textContent = t("g.step." + p, Object.assign({ w: nf(W[p]) }, v));
  }
  function setDate(p, dur = 600) {
    state.date = p;
    applyLayers(dur);
    dateButtons($("#p-dates")); dateButtons($("#ex-dates"));
    renderStoryText();
  }
  let playT = [];
  function stopPlay() {
    playT.forEach(clearTimeout); playT = [];
    $("#play").setAttribute("aria-pressed", "false"); $("#play").textContent = t("g.play");
  }
  $("#play").addEventListener("click", () => {
    if (playT.length) return stopPlay();
    $("#play").setAttribute("aria-pressed", "true"); $("#play").textContent = t("g.pause");
    const hold = 3600;
    setDate("before", 2000);
    playT.push(setTimeout(() => setDate("peak", 2000), hold));
    playT.push(setTimeout(() => setDate("after", 2000), 2 * hold));
    playT.push(setTimeout(stopPlay, 3 * hold));
  });
  renderers.push(() => { if (!playT.length) $("#play").textContent = t("g.play"); dateButtons($("#p-dates")); dateButtons($("#ex-dates")); renderStoryText(); });

  /* ---- tab 2: clouds vs radar */
  const sw = $("#swipe");
  $("#swipe-range").addEventListener("input", e => sw.style.setProperty("--pos", e.target.value + "%"));
  $("#swipe-opt").addEventListener("error", e => (e.target.hidden = true));
  renderers.push(() => {
    $("#clouds-p").textContent = t("g.clouds.p", vars());
    const O = window.OPTICAL || {};
    $("#clouds-cap").textContent = t("clouds.caption", { sensor: O.sensor || "MODIS", peak: vars().peak });
  });

  /* ---- tab 3: key numbers */
  renderers.push(() => {
    const v = vars(), nr = range(newly), wr = range(c => c.flooded_persisting);
    const fields = km2 => nf(Math.floor(km2 * 1e6 / PITCH_M2 / 1000) * 1000);
    const cw = CS ? CS.total.water_km2 : W;
    $("#stats").innerHTML = `
      <div class="stat"><div class="label"><span class="sw water"></span>${esc(t("g.n.water"))}</div>
        <div class="value">${nf(W.before)} → ${nf(W.peak)} <span class="unit">${t("unit.km2")}</span></div>
        <div class="sub">${esc(t("g.n.water.sub", { before: short(M.dates.before), peak: short(M.dates.peak), lo1: nf(cw.before), lo2: nf(cw.peak) }))}</div></div>
      <div class="stat"><div class="label"><span class="sw flooded_receded"></span>${esc(t("g.n.new"))}</div>
        <div class="value">${rangeTxt(nr)} <span class="unit">${t("unit.km2")}</span></div>
        <div class="sub">${esc(t("g.n.new.sub", { f1: fields(nr[0]), f2: fields(nr[1]) }))}</div>
        <div class="note">${esc(t("g.n.new.note"))}</div></div>
      <div class="stat"><div class="label"><span class="sw flooded_persisting"></span>${esc(t("g.n.wet", v))}</div>
        <div class="value">${rangeTxt(wr)} <span class="unit">${t("unit.km2")}</span></div>
        <div class="sub">${esc(t("g.n.wet.sub"))}</div></div>`;
  });

  /* ---------------------------------------------------------------- explore mode */
  function enterExplore() {
    screen = "explore"; setBody();
    $("#explore").hidden = false; $("#ex-toggle").hidden = false; $("#back").hidden = false; $("#hint").hidden = true;
    renderLayerChecks(); applyLayers();
    const h = $("#ex-title"); h.tabIndex = -1;
    if (innerWidth > 760) h.focus(); else $("#ex-toggle").focus();
  }
  $("#ex-toggle").addEventListener("click", e => {
    const open = !document.body.classList.contains("ex-open");
    document.body.classList.toggle("ex-open", open); e.currentTarget.setAttribute("aria-expanded", String(open));
  });
  const LAYERS = ["radar", "water", "classes", "districts", ...(D.rivers ? ["rivers"] : [])];
  function renderLayerChecks() {
    $("#ex-layers").innerHTML = LAYERS.map(k =>
      `<label class="g-check"><input type="checkbox" data-k="${k}"${state[k] ? " checked" : ""}><span>${esc(t("layer." + k))}</span></label>`).join("");
    $$("#ex-layers input").forEach(c => c.addEventListener("change", () => { state[c.dataset.k] = c.checked; applyLayers(); }));
  }
  renderers.push(renderLayerChecks);
  $("#ex-opacity").addEventListener("input", e => { state.opacity = +e.target.value; if (state.classes) paint("classes", "raster-opacity", state.opacity, 0); });

  // click any pixel: what the radar saw there (same logic as the Learn-more page)
  let stData = null, grids = null, dbLUT = null;
  const ST = window.FLOOD_STATUS, G = window.FLOOD_GRIDS;
  if (ST) {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas"); c.width = ST.w; c.height = ST.h;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
      stData = x.getImageData(0, 0, ST.w, ST.h).data;
    };
    im.src = ST.png;
  }
  function decodeGrids() {
    if (grids || !G) return;
    const dec = b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
    grids = Object.fromEntries(PHASES.map(p => [p, dec(G.phases[p])]));
    dbLUT = new Float32Array(256); for (let c = 1; c < 256; c++) dbLUT[c] = G.db0 + (c - 1) * G.step;
  }
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  function statusAt(ll) {
    if (!stData) return { loading: true };
    const fx = (ll.lng - bW) / (bE - bW), fy = (mercY(bN) - mercY(ll.lat)) / (mercY(bN) - mercY(bS));
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
    const i = (Math.floor(fy * ST.h) * ST.w + Math.floor(fx * ST.w)) * 4, bits = stData[i];
    if (!(bits & 1)) return null;
    decodeGrids();
    const dbv = PHASES.map(p => { if (!grids) return null; const c = grids[p][Math.floor(fy * G.h) * G.w + Math.floor(fx * G.w)]; return c ? dbLUT[c] : null; });
    return { main: PHASES.map((_, k) => (bits >> (1 + k)) & 1), care: PHASES.map((_, k) => (bits >> (4 + k)) & 1), cls: stData[i + 1], clsC: stData[i + 2], dbv };
  }
  const verdict = (cls, w) => t(cls ? "pop.v" + cls : (w.some(Boolean) ? "pop.v0w" : "pop.v0"), vars());
  const popup = new maplibregl.Popup({ maxWidth: "320px", focusAfterOpen: false });
  function popupAt(ll) {
    const s = statusAt(ll);
    let html;
    if (!s) html = `<div class="pop"><p>${esc(t("pop.outside"))}</p></div>`;
    else if (s.loading) html = `<div class="pop"><p>${esc(t("pop.loading"))}</p></div>`;
    else {
      const rows = PHASES.map((p, k) => `<tr><td>${fmtDate(M.dates[p])}</td>
        <td><span class="st"><span class="dot${s.main[k] ? " w" : ""}"></span>${esc(t(s.main[k] ? "pop.water" : "pop.dry"))}</span></td>
        <td class="num">${s.dbv[k] != null ? dbf(s.dbv[k]) + " dB" : ""}</td></tr>`).join("");
      const vm = verdict(s.cls, s.main), vc = verdict(s.clsC, s.care);
      html = `<div class="pop"><h4>${esc(t("pop.title"))}</h4><table>${rows}</table><p>${esc(vm)}</p>` +
        (CS ? `<p class="sub">${esc(t("pop.careful", { v: vm === vc ? t("pop.same") : vc }))}</p>` : "") +
        `<p class="sub">${nf(ll.lat, 4)}° N, ${nf(ll.lng, 4)}° E</p></div>`;
    }
    popup.setLngLat(ll).setHTML(html).addTo(map);
  }
  map.on("click", e => { if (screen === "explore") popupAt(e.lngLat); });
  renderers.push(() => popup.remove());

  /* ---------------------------------------------------------------- guided tour
   * Six stops. Each stop moves the camera, sets the layers/date, shows subtitles in a slim bar
   * (split into chunks of at most two lines that follow the narration) and an optional card on the
   * left, and plays data/narration/<lang>_<n>.mp3. The next stop starts only when the narration has
   * ended, the camera has arrived and at least 6 s have passed - never on a fixed timer.
   * Missing clip (or one that hasn't started after 10 s) -> the browser's speechSynthesis reads the
   * subtitle in the same language; no suitable voice -> wait 8 s. Muting keeps the clip playing
   * silently, so pacing is unchanged. The tour only starts from a click ("Watch the story"). */
  const TOUR = [
    { cam: "globe", show: { districts: false } },
    { cam: "districts", date: "before", show: { radar: true, water: true } },
    { cam: "hills", date: "peak", show: {}, card: "rain", terrain: true },
    { cam: "flood", date: "peak", show: { radar: true, classes: true }, classOpacity: 1, fade: 2000, card: "big" },
    { cam: "fields", date: "peak", show: { classes: true }, classOpacity: 1, card: "pics" },
    { cam: "districts", date: "after", show: { radar: true, water: true }, fade: 2000, card: "end" },
  ];
  const SOURCED = [0, 2];                  // stops 1 and 3 quote news reports
  const MIN_STOP_MS = 6000, NO_VOICE_MS = 8000, LOAD_WAIT_MS = 10000;
  const tour = { i: -1, token: 0, paused: false, audioDone: false, camDone: false, minDone: false,
                 mode: "audio", muted: false, timer: 0, minT: 0, waitT: 0, loadT: 0, waitTick: 0,
                 waitStart: 0, speechFrac: 0, chunks: [], chunkIdx: -1 };
  const audio = new Audio(); audio.preload = "auto";
  const preAudio = new Audio(); preAudio.preload = "auto"; preAudio.muted = true;
  const synth = window.speechSynthesis;
  const testMissing = Q.has("debug") ? +Q.get("missingclip") : 0;   // test hook for the fallback
  const holdForTest = Q.has("debug") && Q.has("hold");               // test hook: stay on one stop (screenshots)
  const clip = n => n === testMissing ? "data/narration/_missing_test.mp3" : `data/narration/${lang}_${n}.mp3`;
  const tlog = Q.has("debug") ? (...a) => console.log("TOUR", (performance.now() / 1000).toFixed(1) + "s", ...a) : () => {};
  const tourEl = $("#tour"), cardEl = $("#tour-card");
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty("--bar-h", tourEl.offsetHeight + "px")).observe(tourEl);

  /* ---- camera per stop; padding keeps the subject clear of the title, left card and subtitle bar */
  function setTerrainOn(on) {
    try { map.setTerrain(on ? { source: "dem", exaggeration: 1.6 } : null); } catch (e) { tlog("terrain unavailable", e.message); }
  }
  function tourPad(card) {
    const mobile = innerWidth <= 760, bar = (tourEl.offsetHeight || 120) + 24;
    if (mobile) return { top: card ? 250 : 110, bottom: bar, left: 16, right: 16 };
    const side = Math.round(innerWidth * 0.15);
    return { top: 120, bottom: bar, left: card ? Math.max(side, 380) : side, right: side };
  }
  function camFor(name, card) {
    const pad = tourPad(card), zero = { top: 0, right: 0, bottom: 0, left: 0 };
    if (name === "globe") return { center: [PIN_AT[0] - 25, 18], zoom: globeZoom(), pitch: 0, bearing: 0, padding: zero };
    if (name === "districts")            // the three districts fill ~70% of the screen
      return { center: DB.getCenter(), zoom: fitZoom(pad, 45), pitch: 45, bearing: -10, padding: pad };
    if (name === "hills") return { center: [94.88, 26.62], zoom: 9.4, pitch: 65, bearing: 150, padding: pad };
    if (name === "flood") return { center: [94.36, 26.72], zoom: 10.5, pitch: 40, bearing: -15, padding: pad };
    if (name === "fields") return { center: [94.58, 26.94], zoom: 11, pitch: 45, bearing: -20, padding: pad };
  }
  function moveCamera(s, my) {
    const c = camFor(s.cam, !!s.card);
    return new Promise(res => {
      if (reduce) { map.jumpTo(c); return res(); }          // prefers-reduced-motion: jump, don't fly
      const far = s.cam === "globe" || map.getZoom() < 4, dur = far ? 6500 : 4000;
      map.flyTo(Object.assign({ duration: dur, curve: 1.5, essential: true }, c));
      tlog("camera", s.cam, "flying", dur + "ms");
      map.once("moveend", () => res());
      setTimeout(res, dur + 800);   // camera safety net only (a no-op flight may not fire moveend)
    }).then(() => {
      if (my !== tour.token) return;
      if (s.cam === "globe") spin(true);
      // stop 3: a slow drift across the hills while the narration plays
      if (s.cam === "hills" && !reduce) map.easeTo({ bearing: c.bearing + 18, duration: 22000, easing: x => x, essential: true });
    });
  }

  /* ---- cards (left side) */
  function rainCard() {
    const R = window.RAINFALL_DATA;
    if (!R || !R.days) return "";
    const W = 320, H = 170, top = 26, bottom = 18, n = R.days.length, bw = W / n, max = Math.max(...R.mm), pk = R.days.indexOf(M.dates.peak);
    let s = `<h3>${esc(t("tour.rain"))}</h3><svg class="tour-rain" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("tour.rain"))}">`;
    [0.5, 1].forEach(f => { const y = H - bottom - f * (H - top - bottom); s += `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text x="${W}" y="${y - 2}" text-anchor="end">${nf(max * f)}</text>`; });
    R.mm.forEach((v, i) => { const h = v / max * (H - top - bottom); s += `<rect class="bar${i === pk ? " hot" : ""}" x="${i * bw + 0.3}" y="${H - bottom - h}" width="${Math.max(1, bw - 0.6)}" height="${h}"/>`; });
    R.days.forEach((d, i) => { if (d.endsWith("-01")) s += `<text x="${i * bw}" y="${H - 4}">${fmtDate(d, { day: undefined, year: undefined })}</text>`; });
    if (pk >= 0) {
      const x = pk * bw + bw / 2, anchor = x > W - 80 ? "end" : x < 60 ? "start" : "middle";
      s += `<text class="lab" x="${x}" y="15" text-anchor="${anchor}">${esc(t("tour.rain.peak", { d: short(M.dates.peak), mm: nf(R.mm[pk]) }))}</text>`;
    }
    return s + "</svg>";
  }
  function bigCard() {
    const nr = range(newly), fields = km2 => nf(Math.floor(km2 * 1e6 / PITCH_M2 / 1000) * 1000);
    return `<div class="tour-big"><b>${rangeTxt(nr)}<span class="u">${t("unit.km2")}</span></b><span class="w">${esc(t("tour.big"))}</span>` +
      `<span class="f">${esc(t("g.n.new.sub", { f1: fields(nr[0]), f2: fields(nr[1]) }))}</span></div>`;
  }
  function picsCard() {
    // three radar "looks": dark calm water, grey speckled land, bright flooded paddy (double bounce)
    const tile = (bg, inner) => `<svg viewBox="0 0 120 70" aria-hidden="true"><rect width="120" height="70" fill="${bg}"/>${inner}</svg>`;
    let speck = ""; for (let k = 0; k < 60; k++) { const x = (k * 37) % 118, y = (k * 23) % 68, g = 100 + (k * 53) % 90; speck += `<rect x="${x}" y="${y}" width="3" height="3" fill="rgb(${g},${g},${g})"/>`; }
    let stems = ""; for (let k = 0; k < 9; k++) stems += `<path d="M${10 + k * 12} 62 v-22" stroke="#5f8f3a" stroke-width="2"/>`;
    return `<div class="tour-pics">
      <figure>${tile("#0b0f16", '<path d="M10 46 q25 -3 50 0 t50 0" stroke="#1d2a3a" stroke-width="2" fill="none"/>')}<figcaption>${esc(t("tour.pic.water"))}</figcaption></figure>
      <figure>${tile("#7d7d7d", speck)}<figcaption>${esc(t("tour.pic.land"))}</figcaption></figure>
      <figure>${tile("#e9ecef", '<rect y="56" width="120" height="14" fill="#c9d9ea"/>' + stems)}<figcaption>${esc(t("tour.pic.paddy"))}</figcaption></figure>
    </div>`;
  }
  function endCard() {
    return `<div class="tour-end"><button class="g-btn" id="tour-explore">${esc(t("tour.end.tap"))}</button>` +
      `<a class="g-btn ghost" href="index.html">${esc(t("g.learn"))}</a></div>`;
  }

  /* ---- subtitles: chunks of at most two lines, advanced with the narration */
  function chunksOf(text) {
    const MAXC = innerWidth <= 760 ? 80 : 150;
    const sentences = text.match(/[^.?!।]+[.?!।]+["”’]?\s*|[^.?!।]+$/g) || [text];
    const out = [];
    sentences.forEach(s0 => {
      let s = s0.trim();
      while (s.length > MAXC) {
        let cut = s.lastIndexOf(", ", MAXC);
        if (cut < MAXC * 0.4) cut = s.lastIndexOf(" ", MAXC);
        if (cut <= 0) break;
        out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
      }
      if (s) out.push(s);
    });
    const merged = [];
    out.forEach(c => { const l = merged[merged.length - 1]; if (l && l.length + c.length + 1 <= MAXC) merged[merged.length - 1] = l + " " + c; else merged.push(c); });
    return merged;
  }
  function narrationFrac() {
    if (tour.audioDone) return 1;
    if (tour.mode === "audio") return audio.duration > 0 ? Math.min(1, audio.currentTime / audio.duration) : 0;
    if (tour.mode === "speech") return tour.speechFrac;
    if (tour.mode === "wait") return Math.min(1, (performance.now() - tour.waitStart) / NO_VOICE_MS);
    return 0;
  }
  function showChunk(f) {
    const ch = tour.chunks; if (!ch.length) return;
    const total = ch.reduce((a, c) => a + c.length, 0);
    let acc = 0, idx = ch.length - 1;
    for (let k = 0; k < ch.length; k++) { acc += ch[k].length; if (f < acc / total) { idx = k; break; } }
    if (idx === tour.chunkIdx) return;
    tour.chunkIdx = idx;
    const el = $("#tour-text");
    if (reduce || el.textContent === "") { el.textContent = ch[idx]; return; }
    el.classList.add("swap");
    setTimeout(() => { el.textContent = tour.chunks[tour.chunkIdx] || ""; el.classList.remove("swap"); }, 200);
  }
  function progress() {
    const f = narrationFrac();
    const pct = Math.max(0, (tour.i + f) / TOUR.length * 100);
    $("#tour-fill").style.width = pct + "%";
    $("#tour-prog").setAttribute("aria-valuenow", Math.round(pct));
    showChunk(f);
  }
  audio.addEventListener("timeupdate", progress);
  if (Q.has("debug")) {
    window.__tourAudio = audio;
    ["playing", "stalled", "error", "loadedmetadata"].forEach(ev => audio.addEventListener(ev, () =>
      tlog("audio", ev, "src=" + audio.src.split("/").pop(), "t=" + audio.currentTime.toFixed(1), "dur=" + (audio.duration || 0).toFixed(1))));
  }

  /* ---- rendering */
  function renderTour() {
    if (tour.i < 0) return;
    const n = tour.i + 1, last = n === TOUR.length, s = TOUR[tour.i];
    document.body.classList.toggle("tour-stop-1", tour.i === 0);
    $("#tour-count").textContent = t("tour.count", { n, total: TOUR.length });
    tour.chunks = chunksOf(t("tour." + n)); tour.chunkIdx = -1; $("#tour-text").textContent = "";
    $("#tour-src").hidden = !SOURCED.includes(tour.i);
    const html = { rain: rainCard, big: bigCard, pics: picsCard, end: endCard }[s.card]?.() || "";
    cardEl.innerHTML = html; cardEl.hidden = !html;
    const ex = $("#tour-explore"); if (ex) ex.addEventListener("click", endTour);
    $("#tour-back").textContent = t("tour.back"); $("#tour-back").disabled = tour.i === 0;
    $("#tour-next").textContent = t(last ? "tour.finish" : "tour.next");
    $("#tour-play").textContent = t(tour.paused ? "tour.resume" : "tour.pause");
    $("#tour-play").setAttribute("aria-pressed", String(!tour.paused));
    $("#tour-replay").textContent = t("tour.replay");
    $("#tour-lang").textContent = t("tour.lang"); $("#tour-lang").setAttribute("aria-label", t("tour.lang.aria"));
    $("#tour-lang").lang = lang === "en" ? "hi" : "en";
    $("#tour-mute").textContent = tour.muted ? "🔇" : "🔊";
    $("#tour-mute").setAttribute("aria-pressed", String(tour.muted));
    $("#tour-mute").setAttribute("aria-label", t(tour.muted ? "tour.unmute" : "tour.mute"));
    progress();
  }
  const tourMsg = k => ($("#tour-msg").textContent = k ? t(k) : "");

  /* ---- timing: narration ended + camera arrived + >= 6 s */
  function narrationDone(my) {
    if (my !== tour.token) return;
    tlog("stop", tour.i + 1, "narration ended");
    tour.audioDone = true; clearInterval(tour.waitTick); progress(); maybeNext(my);
  }
  function maybeNext(my) {
    if (holdForTest) return;
    if (my !== tour.token || tour.paused || !tour.audioDone || !tour.camDone || !tour.minDone) return;
    if (tour.i === TOUR.length - 1) return;          // last stop: end card stays until the viewer taps
    clearTimeout(tour.timer);
    tour.timer = setTimeout(() => { if (my === tour.token && !tour.paused) playStop(tour.i + 1); }, 700);
  }
  function waitNoVoice(my) {
    tour.mode = "wait"; tourMsg("tour.wait"); tlog("no narration; waiting", NO_VOICE_MS, "ms");
    tour.waitStart = performance.now();
    clearTimeout(tour.waitT); tour.waitT = setTimeout(() => narrationDone(my), NO_VOICE_MS);
    clearInterval(tour.waitTick); tour.waitTick = setInterval(progress, 300);
  }
  function speakFallback(my) {
    if (my !== tour.token || tour.mode !== "audio") return;
    tour.mode = "speech"; tour.speechFrac = 0;
    clearTimeout(tour.loadT);
    audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio.load();
    if (!synth || !window.SpeechSynthesisUtterance) return waitNoVoice(my);
    const want = lang === "hi" ? "hi" : "en";
    const pick = () => { const v = synth.getVoices(); return v.find(x => x.lang.toLowerCase().startsWith(want + "-in")) || v.find(x => x.lang.toLowerCase().startsWith(want)); };
    const go = () => {
      if (my !== tour.token) return;
      const v = pick();
      if (!v) return waitNoVoice(my);
      const text = t("tour." + (tour.i + 1));
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 0.95; u.volume = tour.muted ? 0 : 1;
      u.onboundary = e => { tour.speechFrac = e.charIndex / text.length; progress(); };
      u.onend = () => narrationDone(my);
      u.onerror = e => { if (e.error !== "interrupted" && e.error !== "canceled") waitNoVoice(my); };
      tourMsg("tour.speech"); tlog("speechSynthesis", v.name);
      if (synth.speaking || synth.pending) synth.cancel();
      synth.speak(u);
    };
    if (synth.getVoices().length) go();
    else { let done = false; const once = () => { if (!done) { done = true; go(); } }; synth.addEventListener("voiceschanged", once, { once: true }); setTimeout(once, 1200); }
  }
  function playAudio(my) {
    const p = audio.play();
    if (p && p.catch) p.catch(err => {
      if (my !== tour.token) return;
      if (err && err.name === "NotAllowedError") { tour.paused = true; tourMsg("tour.blocked"); renderTour(); }
      else if (err && err.name !== "AbortError") speakFallback(my);
    });
  }
  function stopSound() {
    audio.pause(); audio.onended = audio.onerror = null;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    clearTimeout(tour.timer); clearTimeout(tour.minT); clearTimeout(tour.waitT); clearTimeout(tour.loadT); clearInterval(tour.waitTick);
  }
  function playStop(i) {
    stopSound();
    const my = ++tour.token;
    spin(false);
    Object.assign(tour, { i, audioDone: false, camDone: false, minDone: false, paused: false, mode: "audio", speechFrac: 0 });
    tourMsg("");
    const s = TOUR[i];
    setTerrainOn(!!s.terrain);
    Object.assign(state, { radar: false, water: false, classes: false, districts: true, classOpacity: s.classOpacity || 0 }, s.show);
    if (s.date) state.date = s.date;
    renderTour();                                // first: sizes the bar and card, which the camera padding uses
    applyLayers(s.fade || 1200);
    tlog("stop", i + 1, "start", clip(i + 1));
    tour.minT = setTimeout(() => { if (my === tour.token) { tour.minDone = true; maybeNext(my); } }, MIN_STOP_MS);
    moveCamera(s, my).then(() => { if (my !== tour.token) return; tlog("stop", i + 1, "camera arrived"); tour.camDone = true; maybeNext(my); });
    audio.onended = () => narrationDone(my);
    audio.onerror = () => { tlog("stop", i + 1, "clip missing"); speakFallback(my); };
    audio.src = clip(i + 1); audio.muted = tour.muted;
    playAudio(my);
    // a clip that hasn't started within 10 s counts as unavailable (e.g. stuck behind map loading)
    const armLoadWatch = () => {
      clearTimeout(tour.loadT);
      tour.loadT = setTimeout(() => {
        if (my !== tour.token || tour.mode !== "audio" || tour.audioDone) return;
        if (tour.paused) return armLoadWatch();
        if (audio.currentTime === 0 && !holdForTest) { tlog("stop", i + 1, "clip not started after 10 s"); speakFallback(my); }
      }, LOAD_WAIT_MS);
    };
    armLoadWatch();
    // warm up the next clip with one reused element (a new element per stop leaves loads pending)
    if (i + 1 < TOUR.length) { preAudio.src = clip(i + 2); preAudio.load(); }
  }
  function startTour() {
    stopPlay(); popup.remove(); soonPop.remove(); stopAuto(); clearTimeout(resumeT);
    if (!panel.hidden) { panel.hidden = true; document.body.classList.remove("panel-open"); }
    document.body.classList.remove("ex-open");
    $("#explore").hidden = true; $("#hint").hidden = true;
    if (!pinEl.isConnected) pin.addTo(map);
    dLabels.forEach(m => m.addTo(map));
    screen = "tour"; setBody();
    document.body.classList.add("tour-on");
    tourEl.hidden = false;
    playStop(0);
    $("#tour-play").focus();
  }
  function endTour() {
    if (screen !== "tour") return;
    tlog("tour closed -> explore");
    tour.token++; stopSound(); spin(false); setTerrainOn(false);
    tourEl.hidden = true; cardEl.hidden = true; tour.i = -1;
    document.body.classList.remove("tour-on", "tour-stop-1");
    if (!pinEl.isConnected) pin.addTo(map);
    pinIn.classList.add("on");
    Object.assign(state, { radar: true, water: true, classes: false, districts: true, classOpacity: 0 });
    const c = assamCamera();
    if (map.getZoom() < 6) { if (reduce) map.jumpTo(c); else map.flyTo(Object.assign({ duration: 4000, essential: true }, c)); }
    else map.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, pitch: 40, duration: reduce ? 0 : 800 });
    enterExplore();
  }
  function togglePause() {
    if (tour.paused) {
      tour.paused = false; tourMsg("");
      if (!tour.audioDone) {
        if (tour.mode === "audio") playAudio(tour.token);
        else if (tour.mode === "speech" && synth) synth.resume();
        else if (tour.mode === "wait") waitNoVoice(tour.token);
      }
      maybeNext(tour.token);
    } else {
      tour.paused = true; audio.pause(); clearTimeout(tour.timer); clearTimeout(tour.waitT); clearInterval(tour.waitTick);
      if (synth && tour.mode === "speech") synth.pause();
    }
    renderTour();
  }
  const prev = () => tour.i > 0 && playStop(tour.i - 1);
  const next = () => (tour.i < TOUR.length - 1 ? playStop(tour.i + 1) : endTour());
  $("#tour-play").addEventListener("click", togglePause);
  $("#tour-next").addEventListener("click", next);
  $("#tour-back").addEventListener("click", prev);
  $("#tour-replay").addEventListener("click", () => playStop(tour.i));
  $("#tour-lang").addEventListener("click", () => setLang(lang === "en" ? "hi" : "en"));
  $("#tour-close").addEventListener("click", endTour);
  $("#tour-mute").addEventListener("click", () => { tour.muted = !tour.muted; audio.muted = tour.muted; renderTour(); });
  // keyboard: Space = pause, arrows = previous / next (Esc handled above)
  document.addEventListener("keydown", e => {
    if (screen !== "tour" || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === " " || e.code === "Space") { e.preventDefault(); if (!e.repeat) togglePause(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  });
  document.addEventListener("keyup", e => { if (screen === "tour" && (e.key === " " || e.code === "Space")) e.preventDefault(); });
  // last stop: "Tap anywhere to explore"
  map.on("click", () => { if (screen === "tour" && tour.i === TOUR.length - 1) endTour(); });
  // language switch mid-tour: restart the current stop in the new language
  renderers.push(() => { if (screen === "tour" && tour.i >= 0) playStop(tour.i); });

  /* ---------------------------------------------------------------- back to the globe */
  $("#back").addEventListener("click", () => {
    closePanel(false); popup.remove();
    screen = "globe"; setBody();
    $("#explore").hidden = true; $("#ex-toggle").hidden = true; $("#back").hidden = true; $("#hint").hidden = true;
    document.body.classList.remove("ex-open");
    applyLayers(800);
    setTerrainOn(false);
    setTimeout(() => { if (screen === "globe") dLabels.forEach(m => m.remove()); }, 800);   // the Assam pin stays on the globe
    const target = { center: [PIN_AT[0], 20], zoom: globeZoom(), pitch: 0, bearing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
    if (reduce) { map.jumpTo(target); return; }
    map.flyTo(Object.assign({ duration: 4500, curve: 1.4, essential: true }, target));
    map.once("moveend", () => spin(true));
    $("#fly").focus();
  });

  /* ---------------------------------------------------------------- start */
  applyLang();
  // style.load: layers exist, so we can start at once instead of waiting for every tile
  // ("load" waits for the first complete render, which takes long on slow connections)
  let started = false;
  const onReady = () => { if (started) return; started = true; begin(); };
  map.once("style.load", onReady);
  if (map.isStyleLoaded && map.isStyleLoaded()) onReady();
  function begin() {
    const view = Q.get("view"), at = (Q.get("at") || "").split(",").map(Number);
    if (I18N_DATE(Q.get("date"))) state.date = Q.get("date");
    // the opening globe shows every pin: the glowing Assam one plus the grey "coming soon" ones
    soonPins.forEach(s => s.m.addTo(map));
    pin.addTo(map); requestAnimationFrame(() => pinIn.classList.add("on"));
    if (Q.get("tour")) {                      // ?tour=1 (or a stop number) starts the guided story
      startTour();
      const n = parseInt(Q.get("tour"), 10);
      if (n >= 2 && n <= TOUR.length) playStop(n - 1);
      return;
    }
    if (view === "assam" || Q.get("panel") || Q.get("explore") || at.length === 2 && at.every(isFinite)) {
      flyIn(true);
      if (Q.get("panel")) openPanel(Q.get("panel"));
      else if (Q.get("explore") || at.length === 2) {
        state.radar = true; state.water = true; enterExplore();
        if (at.length === 2 && at.every(isFinite)) {
          const go = () => { map.jumpTo({ center: [at[1], at[0]], zoom: 12 }); popupAt(new maplibregl.LngLat(at[1], at[0])); };
          if (stData) go(); else setTimeout(go, 800);
        }
      }
      return;
    }
    spin(true);
    if (!Q.has("noauto")) startAuto();
  }
  function I18N_DATE(d) { return PHASES.includes(d); }
})();
