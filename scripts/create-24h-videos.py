#!/usr/bin/env python3
"""
create-24h-videos.py - rolling 24-hour timelapse MP4s for Vitality GOES
------------------------------------------------------------------------
Linux / Raspberry Pi port of the USRadioguy Create24HourVideos.ps1.

Makes the videos that the "videoPath = ..." lines in Vitality's .ini files
point to (the Play / Timelapse buttons, and the Lab page loops).

  * Reads video24config.ini (same format as the Windows version).
  * Looks in today's folders AND any archive folders, so a video still
    covers a full 24 hours right after a nightly move/cleanup.
  * Frame times come from the goestools file name
    (..._20261122T143021Z.jpg), so frames are in order wherever they live.
  * Writes to a temp file, then swaps it in: visitors never see a
    half-made video. Too few frames? The old video is kept.
  * Skips a video when no new frames arrived since it was last made.
  * Only one copy runs at a time.

Usage:
  create-24h-videos.py                       make all videos
  create-24h-videos.py --check               report what it would use
  create-24h-videos.py --only GOES19Ch13,GOES19FalseColor
  create-24h-videos.py --force               re-make even if nothing changed
  create-24h-videos.py --config /path/to/video24config.ini

Python 3.7+, standard library only. Needs ffmpeg.
Based on the Vitality GOES scripts by Jamie Vital (GPL v3).
Copyright 2026 Carl Reinemann (USRadioguy). GPL v3.
"""
import argparse
import datetime as dt
import fcntl
import os
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif"}
UTC = dt.timezone.utc

# goestools: goes19_FD_CH13_20261122T143021Z.jpg / Himawari9_FD_IR_20260407T005100Z.jpg
# EMWIN:     ..._20261122143000_...RADREFUS.GIF  (14 digits)
TIME_PATTERNS = [
    (re.compile(r"(\d{8}T\d{6})Z"), "%Y%m%dT%H%M%S"),
    (re.compile(r"(?<!\d)(\d{8}_\d{6})(?!\d)"), "%Y%m%d_%H%M%S"),
    (re.compile(r"(?<!\d)(\d{14})(?!\d)"), "%Y%m%d%H%M%S"),
    (re.compile(r"(?<!\d)(\d{8}_\d{4})(?!\d)"), "%Y%m%d_%H%M"),
    (re.compile(r"(?<!\d)(\d{12})(?!\d)"), "%Y%m%d%H%M"),
]


def log(msg, quiet=False):
    line = "[{}] {}".format(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line, flush=True)


def read_config(path):
    """INI reader that keeps duplicate-tolerant, case-insensitive keys like the PS1 version."""
    if not os.path.isfile(path):
        sys.exit("Config file not found: " + path)
    settings, videos, current = {}, [], None
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line[0] in ";#":
                continue
            m = re.match(r"^\[(.+)\]$", line)
            if m:
                name = m.group(1).strip()
                if name.lower() == "settings":
                    current = settings
                else:
                    current = {"name": name}
                    videos.append(current)
                continue
            m = re.match(r"^([^=]+?)\s*=\s*(.*)$", line)
            if current is not None and m:
                current[m.group(1).strip().lower()] = m.group(2).strip().strip('"')
    return settings, videos


def split_list(text):
    return [p.strip().rstrip("/\\") for p in (text or "").split("|") if p.strip()]


def truthy(v):
    return str(v).strip().lower() in ("yes", "true", "1", "on")


def frame_time(name, mtime):
    for rx, fmt in TIME_PATTERNS:
        m = rx.search(name)
        if m:
            try:
                t = dt.datetime.strptime(m.group(1), fmt).replace(tzinfo=UTC)
                if 2000 <= t.year <= 2100:
                    return t
            except ValueError:
                pass
    return dt.datetime.fromtimestamp(mtime, UTC)   # no time in the name - use the file date


def window_day_names(start, end):
    names, d = set(), (start - dt.timedelta(days=1)).date()
    while d <= (end + dt.timedelta(days=1)).date():
        names.update({d.strftime("%Y-%m-%d"), d.strftime("%Y%m%d"), d.strftime("%Y_%m_%d")})
        d += dt.timedelta(days=1)
    return names


def search_folders(video, live_roots, archive_roots):
    paths = split_list(video.get("paths"))
    if paths:
        return [p.replace("\\", "/") for p in paths]
    sub = (video.get("sub") or "").replace("\\", "/").strip("/")
    if sub:
        return [os.path.join(r, sub) for r in live_roots + archive_roots]
    return []


_dir_cache = {}


def dir_files(d):
    if d not in _dir_cache:
        out = []
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.is_file(follow_symlinks=False):
                        st = e.stat(follow_symlinks=False)
                        out.append((e.name, e.path, st.st_size, st.st_mtime))
        except OSError:
            pass
        _dir_cache[d] = out
    return _dir_cache[d]


def get_frames(video, folders, day_names, start, end):
    flt = (video.get("filter") or "").lower()
    settle = time.time() - 30          # skip files still being written
    by_time, found = {}, 0
    for folder in folders:
        if not os.path.isdir(folder):
            continue
        found += 1
        dirs = [folder]
        try:
            dirs += [e.path for e in os.scandir(folder) if e.is_dir() and e.name in day_names]
        except OSError:
            pass
        for d in dirs:
            for name, path, size, mtime in dir_files(d):
                if flt and flt not in name.lower():
                    continue
                if os.path.splitext(name)[1].lower() not in IMAGE_EXT:
                    continue
                if size < 2048 or mtime > settle:
                    continue
                t = frame_time(name, mtime)
                if t < start or t > end:
                    continue
                by_time.setdefault(t, path)   # same frame in two places = once
    frames = [(t, by_time[t]) for t in sorted(by_time)]
    return frames, found


def render(video, frames, s):
    name = video["name"]
    fps = int(video.get("fps") or s["fps"])
    smooth = truthy(video["smooth"]) if video.get("smooth") else s["smooth"]
    if not s["allow_smooth"]:
        smooth = False
    # few frames (e.g. 24 hourly images)? slow down so it lasts minSeconds
    if not video.get("fps") and s["min_seconds"] > 0 and len(frames) / fps < s["min_seconds"]:
        fps = max(2, int(len(frames) // s["min_seconds"]))
    out_file = os.path.join(s["video_dir"], name + ".mp4")
    tmp_file = os.path.join(s["video_dir"], name + ".rendering.mp4")

    dur = "{:.6f}".format(1.0 / fps)
    with tempfile.NamedTemporaryFile("w", suffix=".txt", prefix="v24_", delete=False, encoding="utf-8") as lf:
        list_file = lf.name
        lf.write("ffconcat version 1.0\n")
        for _, p in frames:
            lf.write("file '{}'\nduration {}\n".format(p.replace("'", "'\\''"), dur))
        lf.write("file '{}'\n".format(frames[-1][1].replace("'", "'\\''")))  # concat needs the last frame twice

    vf = "scale=w=trunc(min({}\\,iw)/2)*2:h=-2:flags=lanczos".format(s["max_width"])
    if smooth:
        vf += "," + s["smooth_filter"]
    vf += ",format=yuv420p"
    cmd = [s["ffmpeg"], "-hide_banner", "-loglevel", "error", "-y",
           "-f", "concat", "-safe", "0", "-i", list_file, "-vf", vf]
    if not smooth:
        cmd += ["-r", str(fps)]
    cmd += ["-c:v", "libx264", "-preset", s["preset"], "-crf", str(s["crf"])]
    if s["threads"]:
        cmd += ["-threads", str(s["threads"])]
    cmd += ["-movflags", "+faststart", tmp_file]

    if os.path.exists(tmp_file):
        os.remove(tmp_file)
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    finally:
        os.remove(list_file)
    for l in (r.stdout or "").splitlines():
        log("    ffmpeg: " + l)
    if r.returncode != 0 or not os.path.exists(tmp_file) or os.path.getsize(tmp_file) < 1024:
        if os.path.exists(tmp_file):
            os.remove(tmp_file)
        raise RuntimeError("ffmpeg failed (exit {}) - previous video kept".format(r.returncode))
    os.replace(tmp_file, out_file)     # atomic swap; open readers keep the old file
    return out_file, fps


def load_state(path):
    st = {}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            for l in f:
                k, sep, v = l.rstrip("\n").partition("=")
                if sep:
                    st[k] = v
    return st


def save_state(path, st):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for k in sorted(st):
            f.write("{}={}\n".format(k, st[k]))
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.path.join(HERE, "video24config.ini"))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--min-frames", type=int, default=0)
    a = ap.parse_args()

    cfg_dir = os.path.dirname(os.path.abspath(a.config))
    st, videos = read_config(a.config)
    g = lambda k, d: st.get(k.lower()) or d
    s = {
        "ffmpeg": g("ffmpeg", "ffmpeg"),
        "video_dir": g("videoDir", os.path.join(cfg_dir, "videos")).rstrip("/"),
        "hours": float(g("hours", 24)),
        "fps": int(g("fps", 15)),
        "max_width": int(g("maxWidth", 1080)),
        "crf": int(g("crf", 24)),
        "preset": g("preset", "veryfast"),
        "threads": int(g("threads", 0)),
        "min_frames": a.min_frames or int(g("minFrames", 6)),
        "min_seconds": float(g("minSeconds", 8)),
        "smooth": truthy(g("smooth", "no")),
        # minterpolate is very slow on a Raspberry Pi: off unless allowSmooth = yes
        "allow_smooth": truthy(g("allowSmooth", "no")),
        "smooth_filter": g("smoothFilter", "minterpolate=mi_mode=blend:me_mode=bidir:fps=25:mc_mode=obmc:me=ds:vsbmc=1"),
    }
    live = [p.replace("\\", "/") for p in split_list(g("liveRoots", ""))]
    archive = [p.replace("\\", "/") for p in split_list(g("archiveRoots", ""))]
    state_path = g("stateFile", os.path.join(cfg_dir, "create-24h-videos.state"))

    if not os.path.isdir(s["video_dir"]):
        sys.exit("videoDir not found: " + s["video_dir"])

    lock = open(state_path + ".lock", "w")   # next to the state file: same owner as the videos
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("Another run is still working - skipping this one.")
        return 0

    end = dt.datetime.now(UTC)
    start = end - dt.timedelta(hours=s["hours"])
    days = window_day_names(start, end)
    if a.only:
        wanted = {w.strip() for w in a.only.split(",")}
        videos = [v for v in videos if v["name"] in wanted]
    state = load_state(state_path)
    log("=== {}: {} video(s), last {:g} h ({:%Y-%m-%d %H:%M} to {:%H:%M} UTC) ===".format(
        "CHECK ONLY" if a.check else "Rendering", len(videos), s["hours"], start, end))
    made = skipped = failed = 0
    t_all = time.time()
    for v in videos:
        name = v["name"]
        try:
            folders = search_folders(v, live, archive)
            if not folders:
                log("  {} : no 'sub' or 'paths' set - skipped".format(name)); skipped += 1; continue
            frames, found = get_frames(v, folders, days, start, end)
            if not found:
                log("  {} : none of these folders exist: {}".format(name, " | ".join(folders))); skipped += 1; continue
            span = " ({:%m-%d %H:%M} to {:%m-%d %H:%M} UTC)".format(frames[0][0], frames[-1][0]) if frames else ""
            if a.check:
                log("  {:<30} {:5d} frames{}".format(name, len(frames), span)); continue
            if len(frames) < s["min_frames"]:
                log("  {} : only {} frame(s) - kept previous video".format(name, len(frames))); skipped += 1; continue
            out = os.path.join(s["video_dir"], name + ".mp4")
            sig = "{}|{}|{}".format(len(frames), frames[0][1], frames[-1][1])
            if not a.force and os.path.exists(out) and state.get(name) == sig:
                log("  {} : no new frames since last video - skipped".format(name)); skipped += 1; continue
            t0 = time.time()
            out_file, fps = render(v, frames, s)
            state[name] = sig
            save_state(state_path, state)
            log("  {} : {} frames{} -> {:.1f} MB at {} fps in {:.0f}s".format(
                name, len(frames), span, os.path.getsize(out_file) / 1048576, fps, time.time() - t0))
            made += 1
        except Exception as e:   # one bad product must not stop the rest
            log("  {} : ERROR - {}".format(name, e)); failed += 1
    if not a.check:
        log("=== Done: {} made, {} skipped, {} failed in {:.0f}s ===".format(made, skipped, failed, time.time() - t_all))
    return 1 if failed and not made else 0


if __name__ == "__main__":
    sys.exit(main())
