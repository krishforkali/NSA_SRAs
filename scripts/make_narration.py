"""Make the 12 narration clips for the guided tour with edge-tts (Microsoft neural voices).

Usage:  python -P scripts/make_narration.py web/data/narration
Writes en_1.mp3 ... en_6.mp3 (en-IN-NeerjaNeural) and hi_1.mp3 ... hi_6.mp3 (hi-IN-SwaraNeural),
spoken at rate -5%. Existing non-empty files are kept; delete one to remake it.
"""
import asyncio
import sys
from pathlib import Path

import edge_tts

RATE = "-5%"
VOICES = {"en": "en-IN-NeerjaNeural", "hi": "hi-IN-SwaraNeural"}
LINES = {
    "en": [
        "Every monsoon, floods hit Assam. In July 2026, a state minister called this flood the worst in six decades, "
        "and thick clouds hid it from ordinary satellites.",
        "This is Upper Assam: Jorhat, Sivasagar and Charaideo, beside the Brahmaputra. On 25 June, NISAR, a radar "
        "satellite built by NASA and ISRO, measured about 349 square kilometres of water.",
        "In mid-July, heavy rain fell. Near Sivasagar, 19 July was the wettest day of the season in our weather data. "
        "News reports say rain in the hills swelled rivers like the Dikhow and Disang, which rose before the Brahmaputra did.",
        "On 19 July, the radar looked straight through the clouds. Water had doubled to about 732 square kilometres. "
        "Between 96 and 195 square kilometres of land was newly flooded, as much as 13,000 to 27,000 football fields.",
        "How does it work? Radar sends its own signal. Calm water bounces it away, so water looks dark. "
        "Flooded rice fields can even look bright.",
        "By 5 September, most of the water had drained. Our map is an early estimate from provisional data, but it "
        "shows how NISAR can map every monsoon flood, even through clouds. Tap anywhere to explore.",
    ],
    "hi": [
        "हर मानसून में असम में बाढ़ आती है। जुलाई 2026 की बाढ़ को राज्य के एक मंत्री ने छह दशकों की सबसे बड़ी बाढ़ बताया, "
        "और घने बादलों ने इसे आम उपग्रहों से छिपा लिया।",
        "यह है ऊपरी असम: जोरहाट, शिवसागर और चराइदेव, ब्रह्मपुत्र के किनारे। 25 जून को नासा और इसरो के रडार उपग्रह निसार ने "
        "यहाँ लगभग 349 वर्ग किलोमीटर पानी मापा।",
        "जुलाई के बीच में भारी बारिश हुई। हमारे मौसम डेटा में शिवसागर के पास 19 जुलाई मौसम का सबसे ज़्यादा बारिश वाला दिन था। "
        "खबरों के अनुसार पहाड़ों की बारिश से दिखौ और दिसांग जैसी नदियाँ ब्रह्मपुत्र से पहले उफान पर आ गईं।",
        "19 जुलाई को रडार ने बादलों के आर-पार देखा। पानी दोगुना होकर लगभग 732 वर्ग किलोमीटर हो गया। 96 से 195 वर्ग किलोमीटर "
        "नई ज़मीन पानी में डूब गई, यानी 13,000 से 27,000 फ़ुटबॉल मैदानों जितनी।",
        "यह कैसे होता है? रडार अपना संकेत खुद भेजता है। शांत पानी उसे दूर उछाल देता है, इसलिए पानी काला दिखता है। "
        "डूबे हुए धान के खेत चमकीले भी दिख सकते हैं।",
        "5 सितंबर तक ज़्यादातर पानी उतर चुका था। हमारा नक्शा शुरुआती डेटा पर आधारित एक अनुमान है, लेकिन यह दिखाता है कि "
        "निसार बादलों के बावजूद हर मानसून की बाढ़ का नक्शा बना सकता है। खुद देखने के लिए नक्शे पर कहीं भी टैप करें।",
    ],
}


async def make(text, voice, path, tries=5):
    for attempt in range(1, tries + 1):
        try:
            tmp = path.with_suffix(".part")
            await edge_tts.Communicate(text, voice, rate=RATE).save(str(tmp))
            if tmp.stat().st_size > 1000:
                tmp.replace(path)
                return True
            raise RuntimeError("empty audio")
        except Exception as e:
            print(f"  {path.name}: attempt {attempt} failed ({type(e).__name__}: {str(e)[:120]})", flush=True)
            await asyncio.sleep(5 * attempt)
    return False


async def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    ok = True
    for lang, voice in VOICES.items():
        for i, text in enumerate(LINES[lang], 1):
            p = out / f"{lang}_{i}.mp3"
            if p.exists() and p.stat().st_size > 1000:
                print(f"{p.name}: kept ({p.stat().st_size} bytes)", flush=True)
                continue
            good = await make(text, voice, p)
            print(f"{p.name}: {'ok, ' + str(p.stat().st_size) + ' bytes' if good else 'FAILED'}", flush=True)
            ok &= good
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "web/data/narration"))
