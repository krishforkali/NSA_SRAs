/* Small flood helper chat (right side of globe.html). It runs entirely in the page: questions are
 * matched to topics by keywords (English + Hindi) and answered from the site's own data, with
 * buttons that drive the map (window.GlobeAPI from globe.js). No server, no API key, works offline. */
(function () {
  "use strict";
  const D = window.FLOOD_DATA, R = window.ReportTools;
  const $ = (s, r = document) => r.querySelector(s);
  if (!D || !$("#chat")) return;
  const M = D.meta, S = D.stats, CS = S.conservative;
  const lang = () => (document.documentElement.lang === "hi" ? "hi" : "en");
  const nf = (v, d = 0) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmt = iso => new Date(iso + "T00:00:00Z").toLocaleDateString(lang() === "hi" ? "hi-IN" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const newly = c => c.flooded_persisting + c.flooded_receded;
  const rng = f => R.range(S, f).map(v => nf(v)).join("–");
  const DNAME = { en: { Sivasagar: "Sivasagar", Jorhat: "Jorhat", Charaideo: "Charaideo" }, hi: { Sivasagar: "शिवसागर", Jorhat: "जोरहाट", Charaideo: "चराइदेव" } };

  // ---- topics: keywords (lowercase, both languages) -> answer
  const T = {
    en: {
      title: "Flood helper", hello: "Hi! Ask me about the July 2026 flood in Upper Assam.", ph: "Ask a question…", send: "Send", open: "Ask about the flood", close: "Close chat",
      chips: ["How much land flooded?", "Which district was worst?", "How does radar see water?", "Why a range?", "Download the report"],
      greet: () => "Hello! I can tell you how much land flooded, where, when, how NISAR radar sees water, and how sure the map is. Try one of the buttons below.",
      area: () => `About ${rng(newly)} km² of land was newly under water at the peak (${fmt(M.dates.peak)}), roughly ${nf(R.fields(R.range(S, newly)[0]))}–${nf(R.fields(R.range(S, newly)[1]))} football fields. Total water in the three districts grew from ${nf(S.total.water_km2.before)} to ${nf(S.total.water_km2.peak)} km².`,
      worst: list => `Newly flooded at the peak (main setting): ${list}. Jorhat had the most new flooding, Charaideo the least: its hills and tea gardens stayed mostly dry.`,
      district: (n, d, c) => `${n}: ${nf(newly(d.classes_km2), 1)} km² newly flooded (careful setting: ${nf(newly(c.classes_km2), 1)} km²). ${nf(d.classes_km2.flooded_persisting, 1)} km² was still wet on ${fmt(M.dates.after)}.`,
      when: () => `Three NISAR radar images were used: ${fmt(M.dates.before)} (before), ${fmt(M.dates.peak)} (peak) and ${fmt(M.dates.after)} (after). In our weather data, ${fmt(M.dates.peak)} was also the wettest day near Sivasagar.`,
      nisar: () => "NISAR is a radar satellite built by NASA and ISRO, launched in 2025. Its L-band radar (about 24 cm waves) sees through cloud and works day and night, and it passes over the same place every 12 days.",
      radar: () => "Radar sends its own signal. Calm water acts like a mirror and bounces it away, so water looks dark. Rough land scatters some back, so it looks grey or bright. Flooded crops and forest can even look bright, because the signal bounces off the water and then off the stems.",
      clouds: () => `On ${fmt(M.dates.peak)} ordinary satellite cameras saw only cloud. Radar waves pass straight through cloud and rain, which is why NISAR could map the flood at its peak.`,
      range: () => `The map counts a pixel as water if the radar signal is below ${nf(M.threshold_db)} dB (main setting) or below ${nf(M.conservative_threshold_db)} dB (careful setting). The careful number only counts clearly dark water; the main number also catches shallow water among crops, but some flooded rice fields too. Nothing has been checked on the ground yet, so read the range as the uncertainty in the map.`,
      wet: () => `By ${fmt(M.dates.after)} most of the water had drained: ${rng(c => c.flooded_receded)} km² of the new flood was dry again, and ${rng(c => c.flooded_persisting)} km² was still wet.`,
      rain: () => `Heavy monsoon rain fell in mid-July; near Sivasagar, ${fmt(M.dates.peak)} was the wettest day of the season in our weather data (NASA POWER). News reports say rain in the hills swelled rivers like the Dikhow and Disang, which rose before the Brahmaputra did.`,
      rivers: () => "The Dikhow and Disang flow north from the Naga hills into the Brahmaputra. News reports (Outlook India, 28 Jul 2026) say they swelled quickly and overflowed embankments before the Brahmaputra peaked. Our map shows new water along low ground and small channels near the rivers.",
      paddy: () => "Radar can't tell a rice field filled for planting from a flooded one, and late June to mid-July is planting season. About half of the new flood is in field-sized patches, so some of it is probably planting. That's one reason the site gives a range.",
      sources: () => "Radar: NASA–ISRO NISAR (provisional data, from ASF DAAC). Rainfall: NASA POWER. Borders: geoBoundaries. News: BBC via The Star, The Wire, Outlook India. The full list is on the Learn more page and in the report.",
      report: () => "You can download a printable report (PDF), the numbers as a CSV table, or a map image, and share a summary. Use the buttons below.",
      tour: () => "The guided story takes about two minutes, with narration in English or Hindi.",
      help: () => "I didn't catch that. I can answer: how much flooded, which district, when, what NISAR is, how radar sees water, why there's a range, what drained, what caused it, and how to get the report.",
      b: { tour: "▶ Watch the story", peak: "Show the peak on the map", report: "📄 Open report", csv: "📊 Download CSV", learn: "Learn more" },
    },
    hi: {
      title: "बाढ़ सहायक", hello: "नमस्ते! जुलाई 2026 की ऊपरी असम की बाढ़ के बारे में पूछें।", ph: "सवाल लिखें…", send: "भेजें", open: "बाढ़ के बारे में पूछें", close: "चैट बंद करें",
      chips: ["कितनी ज़मीन डूबी?", "सबसे ज़्यादा किस ज़िले में?", "रडार पानी कैसे देखता है?", "दायरा क्यों?", "रिपोर्ट डाउनलोड करें"],
      greet: () => "नमस्ते! मैं बता सकता हूँ कि कितनी ज़मीन डूबी, कहाँ, कब, निसार रडार पानी कैसे देखता है, और नक्शा कितना भरोसेमंद है। नीचे का कोई बटन आज़माएँ।",
      area: () => `चरम (${fmt(M.dates.peak)}) पर लगभग ${rng(newly)} वर्ग किमी नई ज़मीन पानी में थी, यानी लगभग ${nf(R.fields(R.range(S, newly)[0]))}–${nf(R.fields(R.range(S, newly)[1]))} फ़ुटबॉल मैदान। तीनों ज़िलों में कुल पानी ${nf(S.total.water_km2.before)} से बढ़कर ${nf(S.total.water_km2.peak)} वर्ग किमी हो गया।`,
      worst: list => `चरम पर नई बाढ़ (मुख्य सेटिंग): ${list}। सबसे ज़्यादा नई बाढ़ जोरहाट में, सबसे कम चराइदेव में, जहाँ पहाड़ियाँ और चाय बागान ज़्यादातर सूखे रहे।`,
      district: (n, d, c) => `${n}: ${nf(newly(d.classes_km2), 1)} वर्ग किमी नई बाढ़ (सावधान सेटिंग: ${nf(newly(c.classes_km2), 1)} वर्ग किमी)। ${fmt(M.dates.after)} को भी ${nf(d.classes_km2.flooded_persisting, 1)} वर्ग किमी गीली थी।`,
      when: () => `तीन निसार रडार चित्र इस्तेमाल हुए: ${fmt(M.dates.before)} (पहले), ${fmt(M.dates.peak)} (चरम) और ${fmt(M.dates.after)} (बाद में)। हमारे मौसम डेटा में ${fmt(M.dates.peak)} शिवसागर के पास सबसे ज़्यादा बारिश वाला दिन भी था।`,
      nisar: () => "निसार नासा और इसरो का बनाया रडार उपग्रह है, जो 2025 में प्रक्षेपित हुआ। इसका L-बैंड रडार (लगभग 24 सेमी तरंगें) बादलों के पार देखता है, दिन-रात काम करता है, और हर 12 दिन में उसी जगह के ऊपर से गुज़रता है।",
      radar: () => "रडार अपना संकेत खुद भेजता है। शांत पानी आईने जैसा उसे दूर उछाल देता है, इसलिए पानी काला दिखता है। खुरदरी ज़मीन कुछ संकेत लौटाती है, इसलिए धूसर या चमकीली दिखती है। डूबी फ़सलें और जंगल चमकीले भी दिख सकते हैं, क्योंकि संकेत पानी और फिर तनों से टकराकर लौटता है।",
      clouds: () => `${fmt(M.dates.peak)} को साधारण उपग्रह कैमरों को सिर्फ़ बादल दिखे। रडार तरंगें बादल और बारिश के पार चली जाती हैं, इसलिए निसार चरम पर भी बाढ़ का नक्शा बना सका।`,
      range: () => `नक्शा किसी पिक्सेल को पानी तब मानता है जब रडार संकेत ${nf(M.threshold_db)} dB (मुख्य सेटिंग) या ${nf(M.conservative_threshold_db)} dB (सावधान सेटिंग) से कम हो। सावधान संख्या सिर्फ़ साफ़ गहरा पानी गिनती है; मुख्य संख्या फ़सलों के बीच का उथला पानी भी पकड़ती है, पर कुछ भरे धान के खेत भी। ज़मीन पर अभी जाँच नहीं हुई है, इसलिए इस दायरे को नक्शे की अनिश्चितता समझें।`,
      wet: () => `${fmt(M.dates.after)} तक ज़्यादातर पानी उतर चुका था: नई बाढ़ में से ${rng(c => c.flooded_receded)} वर्ग किमी फिर सूखी थी और ${rng(c => c.flooded_persisting)} वर्ग किमी अब भी गीली थी।`,
      rain: () => `जुलाई के बीच में भारी मानसूनी बारिश हुई; हमारे मौसम डेटा (NASA POWER) में शिवसागर के पास ${fmt(M.dates.peak)} मौसम का सबसे ज़्यादा बारिश वाला दिन था। खबरों के अनुसार पहाड़ों की बारिश से दिखौ और दिसांग जैसी नदियाँ ब्रह्मपुत्र से पहले उफान पर आ गईं।`,
      rivers: () => "दिखौ और दिसांग नागा पहाड़ियों से उत्तर की ओर बहकर ब्रह्मपुत्र में मिलती हैं। खबरों (आउटलुक इंडिया, 28 जुलाई 2026) के अनुसार ये तेज़ी से उफनीं और ब्रह्मपुत्र के चरम से पहले तटबंधों के ऊपर से बह निकलीं। हमारा नक्शा नदियों के पास निचली ज़मीन और छोटे नालों के साथ नया पानी दिखाता है।",
      paddy: () => "रडार रोपाई के लिए भरे धान के खेत और बाढ़ में डूबे खेत में फ़र्क नहीं कर सकता, और जून के अंत से जुलाई के मध्य तक रोपाई का मौसम है। नई बाढ़ का लगभग आधा हिस्सा खेतों के आकार के टुकड़ों में है, इसलिए इसका कुछ भाग शायद रोपाई है। इसीलिए साइट एक दायरा बताती है।",
      sources: () => "रडार: नासा–इसरो निसार (अस्थायी डेटा, ASF DAAC से)। बारिश: NASA POWER। सीमाएँ: geoBoundaries। खबरें: बीबीसी (द स्टार के ज़रिए), द वायर, आउटलुक इंडिया। पूरी सूची ‘और जानें’ पेज और रिपोर्ट में है।",
      report: () => "आप प्रिंट योग्य रिपोर्ट (PDF), आँकड़ों की CSV तालिका या नक्शे की तस्वीर डाउनलोड कर सकते हैं, और सार साझा कर सकते हैं। नीचे के बटन इस्तेमाल करें।",
      tour: () => "कहानी लगभग दो मिनट की है, अंग्रेज़ी या हिंदी में आवाज़ के साथ।",
      help: () => "मैं समझ नहीं पाया। मैं बता सकता हूँ: कितनी ज़मीन डूबी, कौन-सा ज़िला, कब, निसार क्या है, रडार पानी कैसे देखता है, दायरा क्यों है, कितना पानी उतरा, बाढ़ क्यों आई, और रिपोर्ट कैसे लें।",
      b: { tour: "▶ कहानी देखें", peak: "नक्शे पर चरम दिखाएँ", report: "📄 रिपोर्ट खोलें", csv: "📊 CSV डाउनलोड", learn: "और जानें" },
    },
  };
  // keywords per topic (checked as substrings of the lowercased question)
  const K = [
    ["greet", ["hello", "hi ", "hey", "namaste", "नमस्ते", "हेलो"], ["tour"]],
    ["worst", ["worst", "most", "which district", "districts", "compare", "सबसे ज़्यादा", "कौन सा ज़िला", "कौन-सा ज़िला", "ज़िलों", "ज़िले"], ["peak"]],
    ["area", ["how much", "area", "km", "flooded", "size", "big", "football", "कितनी", "कितना", "क्षेत्र", "डूबी", "फ़ुटबॉल"], ["peak"]],
    ["when", ["when", "date", "day", "july", "june", "sept", "कब", "तारीख़", "तारीख", "दिन"], []],
    ["nisar", ["nisar", "satellite", "nasa", "isro", "निसार", "उपग्रह", "नासा", "इसरो"], ["learn"]],
    ["clouds", ["cloud", "camera", "optical", "बादल", "कैमरा"], []],
    ["radar", ["radar", "sar", "how does", "how do", "dark", "bright", "work", "रडार", "कैसे", "काला", "चमकीला"], ["tour"]],
    ["range", ["range", "why two", "careful", "threshold", "accurate", "sure", "uncertain", "trust", "दायरा", "सटीक", "भरोसा", "सावधान", "सीमा"], []],
    ["wet", ["drain", "dry", "still wet", "after", "receded", "september", "सूख", "उतर", "गीली", "सितंबर"], []],
    ["rain", ["rain", "why", "cause", "reason", "weather", "बारिश", "क्यों", "कारण", "मौसम"], []],
    ["rivers", ["river", "dikhow", "disang", "brahmaputra", "embankment", "नदी", "नदियाँ", "दिखौ", "दिसांग", "ब्रह्मपुत्र"], []],
    ["paddy", ["rice", "paddy", "planting", "crop", "धान", "रोपाई", "फ़सल", "खेत"], []],
    ["sources", ["source", "data", "provisional", "where from", "स्रोत", "डेटा", "अस्थायी"], ["learn"]],
    ["report", ["report", "pdf", "download", "csv", "share", "print", "रिपोर्ट", "डाउनलोड", "साझा"], ["report", "csv"]],
    ["tour", ["tour", "story", "watch", "video", "कहानी", "यात्रा"], ["tour"]],
  ];
  const DISTRICT_KEYS = { Sivasagar: ["sivasagar", "sibsagar", "शिवसागर"], Jorhat: ["jorhat", "जोरहाट"], Charaideo: ["charaideo", "चराइदेव"] };

  function answer(q) {
    const L = T[lang()], text = " " + q.toLowerCase() + " ";
    for (const [name, keys] of Object.entries(DISTRICT_KEYS)) {
      if (keys.some(k => text.includes(k))) {
        const d = S.districts.find(x => x.name === name), c = CS ? CS.districts.find(x => x.name === name) : d;
        return { html: esc(L.district(DNAME[lang()][name], d, c)), btns: ["peak"] };
      }
    }
    let best = null, score = 0;
    K.forEach(([topic, keys, btns]) => {
      const s = keys.reduce((a, k) => a + (text.includes(k) ? k.length : 0), 0);
      if (s > score) { score = s; best = [topic, btns]; }
    });
    if (!best) return { html: esc(L.help()), btns: ["tour"] };
    const [topic, btns] = best;
    if (topic === "worst") {
      const list = S.districts.slice().sort((a, b) => newly(b.classes_km2) - newly(a.classes_km2))
        .map(d => `${DNAME[lang()][d.name] || d.name} ${nf(newly(d.classes_km2))} ${lang() === "hi" ? "वर्ग किमी" : "km²"}`).join(", ");
      return { html: esc(L.worst(list)), btns };
    }
    return { html: esc(L[topic]()), btns };
  }

  // ---- UI
  const box = $("#chat"), log = $("#chat-log"), form = $("#chat-form"), input = $("#chat-input"), launch = $("#chat-launch");
  const API = () => window.GlobeAPI || {};
  function add(who, html, btns) {
    const m = document.createElement("div");
    m.className = "msg " + who;
    m.innerHTML = `<div class="bubble">${html}</div>`;
    if (btns && btns.length) {
      const row = document.createElement("div"); row.className = "acts";
      btns.forEach(b => {
        const el = document.createElement("button"); el.type = "button"; el.textContent = T[lang()].b[b];
        el.addEventListener("click", () => act(b)); row.appendChild(el);
      });
      m.appendChild(row);
    }
    log.appendChild(m); log.scrollTop = log.scrollHeight;
  }
  function act(b) {
    const A = API();
    if (b === "tour" && A.startTour) { setOpen(false); A.startTour(); }
    else if (b === "peak" && A.showDate) { A.showDate("peak"); }
    else if (b === "report") window.open(`report.html?lang=${lang()}`, "_blank");
    else if (b === "csv") R.download(`upper-assam-flood-2026-${lang()}.csv`, R.csv(D));
    else if (b === "learn") location.href = "index.html";
  }
  function ask(q) {
    q = q.trim(); if (!q) return;
    add("me", esc(q));
    const typing = document.createElement("div"); typing.className = "msg bot"; typing.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
    log.appendChild(typing); log.scrollTop = log.scrollHeight;
    setTimeout(() => { typing.remove(); const a = answer(q); add("bot", a.html, a.btns); }, 450);
  }
  function chips() {
    const c = $("#chat-chips"); c.innerHTML = "";
    T[lang()].chips.forEach(q => { const b = document.createElement("button"); b.type = "button"; b.textContent = q; b.addEventListener("click", () => ask(q)); c.appendChild(b); });
  }
  function texts() {
    const L = T[lang()];
    $("#chat-title").textContent = L.title; input.placeholder = L.ph;
    $("#chat-send").setAttribute("aria-label", L.send); launch.setAttribute("aria-label", L.open);
    $("#chat-launch-t").textContent = L.open; $("#chat-close").setAttribute("aria-label", L.close);
    chips();
  }
  function setOpen(on) {
    box.hidden = !on; launch.setAttribute("aria-expanded", String(on));
    document.body.classList.toggle("chat-open", on);
    if (on) { if (!log.children.length) add("bot", esc(T[lang()].hello)); input.focus(); }
  }
  launch.addEventListener("click", () => setOpen(box.hidden));
  $("#chat-close").addEventListener("click", () => { setOpen(false); launch.focus(); });
  form.addEventListener("submit", e => { e.preventDefault(); ask(input.value); input.value = ""; });
  box.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); launch.focus(); } });
  // follow the site's language switch
  new MutationObserver(() => { texts(); log.innerHTML = ""; if (!box.hidden) add("bot", esc(T[lang()].hello)); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  texts();
})();
