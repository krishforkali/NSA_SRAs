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
  $$(".g-lang button").forEach(b => b.addEventListener("click", () => {
    lang = b.dataset.lang;
    try { localStorage.setItem("lang", lang); } catch (e) { /* ignore */ }
    applyLang();
  }));

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
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
    });
    labelAt.push([f.properties.name, best]);
  });
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
    paint("classes", "raster-opacity", on && state.classes ? state.opacity : 0, dur);
    paint("classes_careful", "raster-opacity", 0, dur);
    paint("d-line", "line-opacity", on && state.districts ? 1 : 0, 1200);
    paint("d-halo", "line-opacity", on && state.districts ? 0.6 : 0, 1200);
    paint("rivers", "line-opacity", on && state.rivers ? 0.95 : 0, dur);
    // district names: hidden while the pin label invites the first tap (they sit right next to it)
    const showNames = on && state.districts && screen !== "assam";
    dLabels.forEach(m => (dSpan(m).style.opacity = showNames ? 1 : 0));
    $("#legend").hidden = !(screen === "explore" || !panel.hidden);
  }

  /* ---------------------------------------------------------------- screen 1: spinning globe */
  let spinning = false, raf = 0, last = 0, resumeT = 0;
  function spin(on) {
    spinning = on && !reduce && screen === "globe";
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

  /* ---------------------------------------------------------------- screen 2: fly in, pin */
  const pinEl = document.createElement("div");
  // MapLibre sets the marker element's own opacity (globe occlusion), so fades go on an inner wrapper
  pinEl.className = "pin";
  pinEl.innerHTML = '<div class="pin-fade"><span class="pin-ring"></span><span class="pin-ring r2"></span><span class="pin-dot"></span>' +
    '<button class="pin-hit"></button><span class="pin-label"></span></div>';
  const pinIn = $(".pin-fade", pinEl);
  const pin = new maplibregl.Marker({ element: pinEl, pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat(PIN_AT);
  const pinBtn = $(".pin-hit", pinEl);
  pinBtn.addEventListener("click", e => { e.stopPropagation(); openPanel("story"); });
  renderers.push(() => { $(".pin-label", pinEl).textContent = t("g.pin"); pinBtn.setAttribute("aria-label", t("g.pin.aria")); });

  const dLabels = labelAt.map(([name]) => {
    const el = document.createElement("div"); el.dataset.name = name;
    el.innerHTML = '<span class="dlabel" style="opacity:0"></span>';
    return new maplibregl.Marker({ element: el, pitchAlignment: "viewport" });
  });
  const dSpan = m => m.getElement().firstChild;
  labelAt.forEach(([, at], i) => at && dLabels[i].setLngLat(at));
  renderers.push(() => dLabels.forEach(m => (dSpan(m).textContent = t("district." + m.getElement().dataset.name))));

  function assamCamera() {
    const mobile = innerWidth <= 760;
    const pad = mobile ? { top: 90, bottom: 110, left: 20, right: 20 } : { top: 110, bottom: 120, left: 80, right: 80 };
    const cam = map.cameraForBounds(DB, { padding: pad }) || { center: DB.getCenter(), zoom: 8 };
    return { center: cam.center, zoom: cam.zoom - 0.2, pitch: 40, bearing: -12 };
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
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) { closePanel(true); } });
  const hideSoon = () => ($("#soon").textContent = "");
  $("#watch").addEventListener("click", () => ($("#soon").textContent = t("g.soon")));

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

  /* ---------------------------------------------------------------- back to the globe */
  $("#back").addEventListener("click", () => {
    closePanel(false); popup.remove();
    screen = "globe"; setBody();
    $("#explore").hidden = true; $("#ex-toggle").hidden = true; $("#back").hidden = true; $("#hint").hidden = true;
    document.body.classList.remove("ex-open");
    applyLayers(800);
    pinIn.classList.remove("on");
    setTimeout(() => { if (screen === "globe") { pin.remove(); dLabels.forEach(m => m.remove()); } }, 800);
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
