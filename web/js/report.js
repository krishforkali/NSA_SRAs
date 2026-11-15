/* report.html: printable analysis report built from the same data files as the site.
 * ?lang=hi for Hindi, ?print=1 opens the print dialog (Save as PDF) once the images have loaded. */
(function () {
  "use strict";
  const D = window.FLOOD_DATA, I = window.I18N, R = window.ReportTools, CFG = window.SITE_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PHASES = ["before", "peak", "after"];
  const Q = new URLSearchParams(location.search);
  let lang = "en";
  try { const s = localStorage.getItem("lang"); if (s && I[s]) lang = s; } catch (e) { /* private mode */ }
  if (I[Q.get("lang")]) lang = Q.get("lang");
  const t = (k, v) => {
    const s = (I[lang] && I[lang][k] != null) ? I[lang][k] : (I.en[k] != null ? I.en[k] : k);
    return v ? s.replace(/\{(\w+)\}/g, (m, n) => (n in v ? v[n] : m)) : s;
  };
  if (!D) { document.body.innerHTML = "<p style='padding:24px'>data/site_data.js is missing.</p>"; return; }
  const M = D.meta, S = D.stats, CS = S.conservative;
  const nf = (v, d = 0) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const db = (v, d = 0) => nf(v, d).replace("-", "−");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtDate = (iso, o) => new Date(iso + "T00:00:00Z").toLocaleDateString(lang === "hi" ? "hi-IN" : "en-GB",
    Object.assign({ day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }, o));
  const dname = n => (I[lang]["district." + n] || n);
  const rangeTxt = ([lo, hi]) => Math.round(lo) === Math.round(hi) ? nf(hi) : `${nf(lo)}–${nf(hi)}`;
  const vars = () => ({
    before: fmtDate(M.dates.before), peak: fmtDate(M.dates.peak), after: fmtDate(M.dates.after),
    thr: db(M.threshold_db), thrC: CS ? db(M.conservative_threshold_db) : db(M.threshold_db),
    drop: nf(M.change_drop_db), px: nf(M.pixel_m), track: M.track, dir: t("dir." + M.direction),
  });

  function render() {
    document.documentElement.lang = lang;
    document.title = t("r.title");
    $$("[data-i18n]").forEach(el => (el.innerHTML = t(el.dataset.i18n)));
    $$("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    $$(".lang button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    const v = vars();
    $("#r-meta").textContent = t("r.generated", {
      when: new Date().toLocaleString(lang === "hi" ? "hi-IN" : "en-GB", { dateStyle: "medium", timeStyle: "short" }),
      data: M.generated_utc.slice(0, 10), track: M.track, dir: v.dir });

    // key numbers
    const W = S.total.water_km2, nr = R.range(S, R.newly), wr = R.range(S, c => c.flooded_persisting);
    $("#r-stats").innerHTML = [
      [`<span class="sw water"></span>${esc(t("g.n.water"))}`, `${nf(W.before)} → ${nf(W.peak)} <small>${t("unit.km2")}</small>`, `${fmtDate(M.dates.before, { year: undefined })} → ${fmtDate(M.dates.peak, { year: undefined })}`],
      [`<span class="sw receded"></span>${esc(t("g.n.new"))}`, `${rangeTxt(nr)} <small>${t("unit.km2")}</small>`, t("r.range")],
      [`<span class="sw persist"></span>${esc(t("g.n.wet", v))}`, `${rangeTxt(wr)} <small>${t("unit.km2")}</small>`, t("g.n.wet.sub")],
      [esc(t("r.fields")), `${nf(R.fields(nr[0]))}–${nf(R.fields(nr[1]))}`, t("g.n.new.note")],
    ].map(([l, val, s]) => `<div class="stat"><div class="l">${l}</div><div class="v">${val}</div><div class="s">${esc(s)}</div></div>`).join("");

    // map figure: radar + change classes + district outlines, on the PNGs' own Web-Mercator grid
    const [[bS, bW], [bN, bE]] = M.bounds, mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const ratio = ((mercY(bN) - mercY(bS)) / (2 * Math.PI)) / ((bE - bW) / 360);
    const VW = 1000, VH = Math.round(VW * ratio);
    const px = ([lon, lat]) => `${((lon - bW) / (bE - bW) * VW).toFixed(1)},${((mercY(bN) - mercY(lat)) / (mercY(bN) - mercY(bS)) * VH).toFixed(1)}`;
    const paths = D.districts.features.map(f => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      return polys.map(p => p.map(r => "M" + r.map(px).join("L") + "Z").join("")).join("");
    }).join("");
    $("#r-map").style.paddingTop = (ratio * 100).toFixed(2) + "%";
    $("#r-map").innerHTML = `<img class="radar" src="data/backscatter_peak.png" alt=""><img src="data/flood_classes.png" alt="">
      <svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${paths}" fill="none" stroke="#111827" stroke-opacity=".45" stroke-width="5" stroke-linejoin="round"/>
        <path d="${paths}" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
    $("#r-map-t").textContent = t("r.map", v);
    $("#r-map-cap").textContent = t("r.map.cap", v);
    $("#r-legend").innerHTML = [["permanent", "cls.permanent"], ["receded", "cls.flooded_receded"], ["persist", "cls.flooded_persisting"], ["veg", "cls.flooded_vegetation"]]
      .map(([c, k]) => `<span><span class="sw ${c}"></span>${esc(t(k))}</span>`).join("");

    // newly flooded per district: main vs careful
    const ds = S.districts.slice().sort((a, b) => R.newly(b.classes_km2) - R.newly(a.classes_km2));
    const max = Math.max(...ds.map(d => R.newly(d.classes_km2))) || 1, BW = 360, rowH = 34, lab = 86;
    let bars = `<svg viewBox="0 0 ${BW} ${ds.length * rowH + 4}" role="img" aria-label="${esc(t("r.bars"))}">`;
    ds.forEach((d, i) => {
      const y = i * rowH + 4, main = R.newly(d.classes_km2), care = CS ? R.newly(CS.districts.find(x => x.name === d.name).classes_km2) : main;
      const sx = val => val / max * (BW - lab - 50);
      bars += `<text x="${lab - 6}" y="${y + 14}" text-anchor="end" font-size="11" fill="#111827">${esc(dname(d.name))}</text>
        <rect x="${lab}" y="${y + 2}" width="${sx(main).toFixed(1)}" height="11" rx="3" fill="#2a78d6"/>
        <rect x="${lab}" y="${y + 15}" width="${sx(care).toFixed(1)}" height="9" rx="3" fill="#9ec5f4"/>
        <text x="${lab + sx(main) + 4}" y="${y + 12}" font-size="10" fill="#4b5563">${nf(main)}</text>
        <text x="${lab + sx(care) + 4}" y="${y + 23}" font-size="10" fill="#6b7280">${nf(care)}</text>`;
    });
    $("#r-bars").innerHTML = bars + "</svg>";
    $("#r-bars-cap").textContent = t("r.bars.cap", v);

    // rainfall
    const RD = window.RAINFALL_DATA;
    if (RD && RD.days) {
      const n = RD.days.length, w = 360, h = 110, b = 16, bw = w / n, mx = Math.max(...RD.mm);
      let s = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t("r.rain"))}">`;
      RD.mm.forEach((mm, i) => { const bh = mm / mx * (h - b - 14); s += `<rect x="${(i * bw).toFixed(2)}" y="${(h - b - bh).toFixed(1)}" width="${Math.max(1, bw - .6).toFixed(2)}" height="${bh.toFixed(1)}" fill="${RD.days[i] === M.dates.peak ? "#2a78d6" : "#c3cad4"}"/>`; });
      PHASES.forEach(p => { const i = RD.days.indexOf(M.dates[p]); if (i < 0) return; const x = (i + .5) * bw;
        s += `<line x1="${x}" x2="${x}" y1="10" y2="${h - b}" stroke="#111827" stroke-width=".7" stroke-dasharray="2 2"/><text x="${x}" y="8" font-size="9" text-anchor="${x > w - 40 ? "end" : "middle"}" fill="#111827">${esc(t("phase." + p))}</text>`; });
      RD.days.forEach((d, i) => { if (d.endsWith("-01")) s += `<text x="${i * bw}" y="${h - 3}" font-size="9" fill="#6b7280">${fmtDate(d, { day: undefined, year: undefined })}</text>`; });
      $("#r-rain").innerHTML = s + "</svg>";
      $("#r-rain-cap").textContent = t("rain.caption", { source: RD.source });
    } else { $("#r-rain").innerHTML = ""; $("#r-rain-cap").textContent = t("rain.missing"); }

    // results by district, both settings
    const block = (label, src) => `<tr class="grp"><td colspan="7">${esc(label)}</td></tr>` +
      [...src.districts.slice().sort((a, b) => R.newly(b.classes_km2) - R.newly(a.classes_km2)), src.total].map(d => {
        const c = d.classes_km2, tot = d === src.total;
        return `<tr${tot ? ' class="total"' : ""}><td>${esc(tot ? t("total.name") : dname(d.name))}</td><td>${nf(R.newly(c), 1)}</td>
          <td>${nf(c.flooded_persisting, 1)}</td><td>${nf(c.flooded_receded, 1)}</td><td>${nf(c.permanent, 1)}</td><td>${nf(c.flooded_vegetation, 1)}</td><td>${nf(d.valid_km2)}</td></tr>`;
      }).join("");
    $("#r-table").innerHTML = `<table><thead><tr><th>${t("col.district")}</th><th>${t("col.new")}</th><th>${t("col.wet", v)}</th>
      <th>${t("col.rec", v)}</th><th>${t("col.perm")}</th><th>${t("col.veg")}</th><th>${t("col.area")}</th></tr></thead><tbody>` +
      block(t("res.main", { thr: v.thr }), S) + (CS ? block(t("res.careful", { thr: v.thrC }), CS) : "") + `</tbody></table>`;

    // method + checks + scenes + sources
    $("#r-method").innerHTML = `<li>${t("notes.prov")}</li>` + [1, 2, 3, 4, 5, 6].map(i => `<li>${esc(t("notes." + i, v))}</li>`).join("");
    const CHECKS = [[1, "ok"], [2, "ok"], [3, "ok"], [4, "ok"], [5, "warn"], [6, "no"], [7, "no"]];
    $("#r-checks").innerHTML = CHECKS.map(([i, k]) => `<li><span class="tag ${k}">${esc(t("check." + k))}</span><span>${esc(t("check." + i))}</span></li>`).join("");
    $("#r-scenes").innerHTML = `<table><thead><tr><th>${t("scene.date")}</th><th style="text-align:left">${t("scene.role")}</th><th style="text-align:left">${t("scene.file")}</th></tr></thead><tbody>` +
      PHASES.map(p => `<tr><td>${fmtDate(M.dates[p])}</td><td style="text-align:left">${esc(t("phase." + p))}</td><td class="mono">${esc(M.scenes[p])}</td></tr>`).join("") + `</tbody></table>`;
    const src = [1, 2, 3, 4, 6].map(i => t("src." + i));
    if (RD) src.splice(4, 0, t("src.5", { source: RD.source }));
    $("#r-sources").innerHTML = src.map(s => `<li>${s}</li>`).join("") + [7, 8, 9].map(i => `<li>${t("src." + i)}</li>`).join("");
    const url = R.shareUrl();
    $("#r-foot").innerHTML = `<span>${esc(t("r.foot"))}</span>${url ? `<span>${esc(url)}</span>` : ""}`;
  }

  /* ---- toolbar */
  $$(".lang button").forEach(b => b.addEventListener("click", () => {
    lang = b.dataset.lang; try { localStorage.setItem("lang", lang); } catch (e) { /* ignore */ }
    render(); $("#share-menu").hidden = true;
  }));
  $("#b-print").addEventListener("click", () => window.print());
  $("#b-csv").addEventListener("click", () => R.download(`upper-assam-flood-2026-${lang}.csv`, R.csv(D)));
  const shareText = () => t("r.share.text", { lo: nf(R.range(S, R.newly)[0]), hi: nf(R.range(S, R.newly)[1]) });
  $("#b-share").addEventListener("click", async () => {
    const url = R.shareUrl(), text = shareText();
    if (await R.nativeShare({ title: t("r.title"), text, url })) return;
    const L = R.shareLinks(text, url), m = $("#share-menu");
    m.innerHTML = `<button id="sh-copy">${esc(t("sh.copy"))}</button><a href="${L.whatsapp}" target="_blank" rel="noopener">WhatsApp</a>` +
      `<a href="${L.email}">${esc(t("sh.email"))}</a><a href="${L.x}" target="_blank" rel="noopener">X</a>`;
    m.hidden = false;
    $("#sh-copy").addEventListener("click", async e => { const ok = await R.copy(url ? `${text} ${url}` : text); e.target.textContent = t(ok ? "rep.copied" : "sh.copy"); });
  });

  render();
  // ?print=1: open the print dialog once the map images have loaded
  if (Q.get("print")) {
    const imgs = $$("#r-map img");
    Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))).then(() => setTimeout(() => window.print(), 400));
  }
})();
