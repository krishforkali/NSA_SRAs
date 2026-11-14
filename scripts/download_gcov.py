"""Download NISAR GCOV .h5 files one at a time, with resume, retries and progress.

Usage:
    python -P scripts/download_gcov.py selected_scenes.txt D:/sar-dance/data

Credentials come from ~/.netrc (or ~/_netrc), entry: machine urs.earthdata.nasa.gov
Partial downloads are kept as <name>.part and resumed with HTTP Range requests.
"""
import netrc
import os
import sys
import time
from pathlib import Path

import asf_search as asf

CHUNK = 8 * 1024 * 1024
MAX_RETRIES = 200         # per file; connection drops just trigger a resume
RETRY_WAIT = 20           # first wait in seconds; doubles each failure, capped
RETRY_WAIT_MAX = 300      # ~16 h of outage tolerated before giving up


def load_creds():
    home = Path.home()
    for name in (".netrc", "_netrc"):
        p = home / name
        if p.exists():
            auth = netrc.netrc(str(p)).authenticators("urs.earthdata.nasa.gov")
            if auth:
                return auth[0], auth[2]
    sys.exit(f"No 'machine urs.earthdata.nasa.gov' entry found in {home}\\.netrc or _netrc")


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.2f} TB"


def expected_size(props, filename):
    b = props.get("bytes")
    if isinstance(b, dict):
        v = b.get(filename)
        return v.get("bytes") if isinstance(v, dict) else v
    return None


def verify(path, size):
    """Exact size match against ASF metadata + HDF5 opens and has a GCOV grid."""
    import h5py
    got = path.stat().st_size
    if size and got != size:
        return f"size {got} != expected {size}"
    try:
        with h5py.File(path, "r") as f:
            if "science/LSAR/GCOV/grids" not in f:
                return "HDF5 opens but has no science/LSAR/GCOV/grids group"
    except OSError as e:
        return f"not a readable HDF5 file ({e})"
    return None


def download(session, url, dest: Path):
    part = dest.with_suffix(dest.suffix + ".part")
    fails = 0
    for attempt in range(1, MAX_RETRIES + 1):
        have = part.stat().st_size if part.exists() else 0
        headers = {"Range": f"bytes={have}-"} if have else {}
        try:
            with session.get(url, headers=headers, stream=True, timeout=(30, 120)) as r:
                if r.status_code == 416:            # already complete
                    break
                if have and r.status_code == 200:   # server ignored Range: restart
                    print("  server ignored resume request; restarting file", flush=True)
                    have = 0
                    part.unlink(missing_ok=True)
                r.raise_for_status()
                total = have + int(r.headers.get("Content-Length", 0))
                mode = "ab" if have else "wb"
                t0, done_at_t0, last = time.time(), have, 0.0
                with open(part, mode) as f:
                    for chunk in r.iter_content(CHUNK):
                        f.write(chunk)
                        have += len(chunk)
                        now = time.time()
                        if now - last > 15 or have == total:
                            rate = (have - done_at_t0) / max(now - t0, 1e-6)
                            eta = (total - have) / rate if rate else 0
                            pct = 100 * have / total if total else 0
                            print(f"  {pct:5.1f}%  {human(have)} / {human(total)}  "
                                  f"{human(rate)}/s  ETA {eta/60:.0f} min", flush=True)
                            last = now
                if total and have >= total:
                    break
        except Exception as e:  # network drop, timeout, DNS failure, 5xx ...
            now_have = part.stat().st_size if part.exists() else 0
            if now_have > have:                 # progress was made: reset backoff
                fails = 0
            fails += 1
            wait = min(RETRY_WAIT * 2 ** (fails - 1), RETRY_WAIT_MAX)
            msg = str(e).split(" (Caused by")[0][:160]
            print(f"  attempt {attempt}: {type(e).__name__}: {msg}; have {human(now_have)}; "
                  f"retrying in {wait}s", flush=True)
            time.sleep(wait)
    else:
        raise RuntimeError(f"gave up on {dest.name} after {MAX_RETRIES} attempts")
    part.replace(dest)


def main(selection_file, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scenes = [ln.split()[2] for ln in open(selection_file)
              if ln.strip() and not ln.startswith("#")]

    user, pw = load_creds()
    for k in range(60):   # wait for the network to come back (up to ~5 h)
        try:
            session = asf.ASFSession().auth_with_creds(user, pw)
            found = {r.properties["sceneName"]: r.properties for r in asf.granule_search(scenes)}
            break
        except asf.exceptions.ASFAuthenticationError as e:
            if "401" in str(e) or "Unauthorized" in str(e):
                raise
            err = e
        except Exception as e:
            err = e
        print(f"  login/search failed ({type(err).__name__}); network down? retrying in 300s",
              flush=True)
        time.sleep(300)
    else:
        sys.exit("network unavailable for ~5 h; giving up")

    for i, name in enumerate(scenes, 1):
        props = found[name]
        url = props["url"]
        dest = out / url.rsplit("/", 1)[1]
        size = expected_size(props, dest.name)
        print(f"[{i}/{len(scenes)}] {dest.name}  ({human(size or 0)})", flush=True)
        if dest.exists() and verify(dest, size) is None:
            print("  already downloaded and verified, skipping", flush=True)
            continue
        if dest.exists():
            dest.rename(dest.with_suffix(".h5.part"))   # incomplete: resume it
        download(session, url, dest)
        problem = verify(dest, size)
        if problem:
            dest.rename(dest.with_suffix(".h5.bad"))
            sys.exit(f"  VERIFY FAILED: {problem}")
        print("  verified: exact size match, valid HDF5", flush=True)
    print("All downloads complete.", flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:3])
