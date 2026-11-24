#!/usr/bin/env python3
"""
make-site-config.py - write the Vitality GOES site config for your station.

Reads the goesproc config(s) your receiver(s) use, works out which image
folders goesproc will create, and writes a matching set of:

  web/config/config.ini        paths, location, menus
  web/config/abi.ini           Full Disk menu    (only products you receive)
  web/config/meso.ini          Mesoscale menu    (")
  web/config/nws.ini           NWS graphics
  web/config/emwin.ini         EMWIN graphics + radar loops
  web/config/otheremwin.ini    text products
  web/config/station.ini       station name / receivers (kept if it exists)
  web/lab/lab-config.js        Lab Overview satellites
  scripts/video24config.ini    24-hour video loops

Only products whose folder goesproc actually writes are listed, so the site
never shows an entry that can never have images.

Example (single GOES-19 Pi, images in /home/pi/goes):
  make-site-config.py --data /home/pi/goes --goesproc /etc/goestools/goesproc-goesr.conf \\
      --sat goes19 --name "My Station" --location "Anytown, USA" \\
      --lat 39.0 --lon -77.0 --timezone America/New_York

Copyright 2026 Carl Reinemann (USRadioguy). GPL v3.
"""
import argparse
import configparser
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TPL = os.path.join(ROOT, "templates", "vitality")

# Channels that goesproc can write for each region on the HRIT downlink
HRIT_CHANNELS = {
    "fd": ["ch02", "ch07", "ch08", "ch09", "ch13", "ch14", "ch15"],
    "m1": ["ch02", "ch07", "ch13"],
    "m2": ["ch02", "ch07", "ch13"],
}
HIMAWARI_CHANNELS = ["vs", "ir", "wv"]

SAT_INFO = {
    "goes19": dict(key="east", name="GOES-19", tab="GOES-19 east", lon="75.2° west",
                   region="the Americas and the Atlantic", suffix="19"),
    "goes18": dict(key="west", name="GOES-18", tab="GOES-18 west", lon="137.0° west",
                   region="the Pacific and western North America", suffix="18"),
}


# ------------------------------------------------------------------ goesproc
def goesproc_handlers(path):
    """Minimal TOML reader for goesproc handler tables (type/origin/regions/channels/directory)."""
    handlers, cur = [], None
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.split("#", 1)[0].strip() if not raw.strip().startswith('"') else raw.strip()
            if line == "[[handler]]":
                cur = {}
                handlers.append(cur)
                continue
            if line.startswith("["):        # sub-tables ([handler.lut], [[handler.map]] ...)
                if cur is not None and line.startswith("[handler.lut"):
                    cur["lut"] = True
                continue
            m = re.match(r'^(\w+)\s*=\s*(.+)$', line)
            if cur is None or not m:
                continue
            k, v = m.group(1), m.group(2).strip()
            if v.startswith("["):
                cur[k] = [x.strip().strip('"').lower() for x in v.strip("[]").split(",") if x.strip()]
            else:
                cur[k] = v.strip('"')
    return handlers


def produced_dirs(handlers):
    """Every folder (relative to goesproc --out) that these handlers write to."""
    out = set()
    for h in handlers:
        d = h.get("directory", "")
        if not d:
            continue
        d = re.sub(r"\{time:[^}]*\}", "", d)                     # drop the dated sub-folder
        d = d.replace("./", "", 1).strip("/")
        origin = h.get("origin", "")
        if origin.startswith("himawari"):
            regions, chans = ["fd"], HIMAWARI_CHANNELS
        else:
            regions = h.get("regions") or ["fd", "m1", "m2"]
            chans = None
        for r in regions:
            cl = h.get("channels") or (chans if chans else HRIT_CHANNELS.get(r, []))
            if "{channel" in d and h.get("lut"):
                cl = ["fc"]                                       # false color writes one image
            for c in (cl if "{channel" in d else [None]):
                p = re.sub(r"\{region:short\|lower\}", r, d)
                if c is not None:
                    p = re.sub(r"\{channel:short\|lower\}", c, p)
                out.add(os.path.normpath(p).strip("/"))
    return out


# ------------------------------------------------------------------ ini helpers
def read_sections(path):
    """Keep sections in order with their raw text (comments and all)."""
    secs, cur, name = [], [], None
    with open(path, encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^\[(.+)\]\s*$", line)
            if m:
                if name is not None or cur:
                    secs.append((name, "".join(cur)))
                name, cur = m.group(1), [line]
            else:
                cur.append(line)
    secs.append((name, "".join(cur)))
    return secs


def section_value(text, key):
    m = re.search(r"(?m)^\s*" + key + r"\s*=\s*(.+?)\s*$", text)
    return m.group(1).strip('"') if m else ""


def item_dir(text):
    """'path = {GOES19}/goes19/fd/fc/' -> ('GOES19', 'goes19/fd/fc')"""
    p = section_value(text, "path")
    m = re.match(r"^\{(\w+)\}/?(.*)$", p)
    return (m.group(1), m.group(2).strip("/")) if m else (None, None)


def filter_ini(tpl, dirs, rename_sat=None, keep_tokens=("GOES19", "GOES18")):
    """Keep only sections whose folder goesproc writes (plus the _category_ header)."""
    out, kept = [], []
    for name, text in read_sections(tpl):
        if name is None or name == "_category_":
            out.append(text)
            continue
        tok, sub = item_dir(text)
        if tok not in keep_tokens:
            continue
        if rename_sat:
            sub2 = re.sub(r"^goes19/", rename_sat + "/", sub)
            text = text.replace(sub, sub2, 1)
            sub = sub2
        if sub in dirs:
            # drop Carl's station notes
            text = "\n".join(l for l in text.split("\n") if not re.match(r"^\s*;.*(E:\\|MAGICK|Nov 2026|usradioguy-modernize|Retired)", l))
            out.append(text)
            kept.append((name, text, sub))
    return "".join(out), kept


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="goesproc --out folder (images live under it)")
    ap.add_argument("--goesproc", action="append", required=True, help="goesproc config file (repeatable)")
    ap.add_argument("--sat", action="append", choices=["goes19", "goes18"], required=True,
                    help="satellite received with the matching --goesproc (same order)")
    ap.add_argument("--web", default=os.path.join(ROOT, "web"))
    ap.add_argument("--videos-config", default=os.path.join(HERE, "video24config.ini"))
    ap.add_argument("--name", default="My Ground Station")
    ap.add_argument("--location", default="")
    ap.add_argument("--lat", default="39.02")
    ap.add_argument("--lon", default="-76.98")
    ap.add_argument("--timezone", default="America/New_York")
    ap.add_argument("--state", default="MD", help="2-letter state for NWS products")
    ap.add_argument("--wxzone", default="MDZ013")
    ap.add_argument("--orig", default="LWXMD")
    ap.add_argument("--radar", default="NTHES", help="EMWIN radar code (RADxxxxx)")
    ap.add_argument("--city", default="")
    ap.add_argument("--theme", default="groundstation")
    a = ap.parse_args()
    if len(a.sat) != len(a.goesproc):
        sys.exit("--sat and --goesproc must be given the same number of times")

    data = a.data.rstrip("/")
    cfgdir = os.path.join(a.web, "config")
    os.makedirs(cfgdir, exist_ok=True)

    dirs, sats = set(), []
    for sat, gp in zip(a.sat, a.goesproc):
        dirs |= produced_dirs(goesproc_handlers(gp))
        sats.append(sat)
    # NWS/EMWIN/text come from whichever satellite is received (prefer GOES-19)
    nws_sat = "goes19" if "goes19" in sats else sats[0]

    # ---- abi.ini / meso.ini (Full disk + mesoscale imagery)
    abi_txt, abi_items = filter_ini(os.path.join(TPL, "abi.ini"), dirs)
    meso_txt, meso_items = filter_ini(os.path.join(TPL, "meso.ini"), dirs)
    nws_txt, _ = filter_ini(os.path.join(TPL, "nws.ini"), dirs, rename_sat=None if nws_sat == "goes19" else nws_sat)
    emwin_txt, emwin_items = filter_ini(os.path.join(TPL, "emwin.ini"), dirs, rename_sat=None if nws_sat == "goes19" else nws_sat)
    header = "; Written by scripts/make-site-config.py - re-run it after changing goesproc configs.\n"
    for fn, txt in (("abi.ini", abi_txt), ("meso.ini", meso_txt), ("nws.ini", nws_txt), ("emwin.ini", emwin_txt)):
        with open(os.path.join(cfgdir, fn), "w") as f:
            f.write(header + txt)
    shutil.copy(os.path.join(TPL, "otheremwin.ini"), os.path.join(cfgdir, "otheremwin.ini"))

    # ---- config.ini
    cats = ["abi = abi.ini"] + (["meso = meso.ini"] if meso_items else []) + ["nws = nws.ini", "emwin = emwin.ini"]
    paths = "\n".join("{} = {}".format(t, data) for t in ("GOES19", "GOES18"))
    city = a.city or (a.location.split(",")[0].upper() if a.location else "")
    with open(os.path.join(cfgdir, "config.ini"), "w") as f:
        f.write("""; Written by scripts/make-site-config.py
[general]
siteTitle = "{name}"
siteTheme = "{theme}"
emwinPath = {data}/{nws}/emwin
adminPath = {data}/{nws}/text
showSysInfo = true
debug = false
spaceWeatherAlerts = true
fastEmwin = true
showAdminInfo = true

[categories]
{cats}

[paths]
; goesproc writes GOES-19 and GOES-18 images under the same --out folder
{paths}

[location]
radarCode = {radar}
stateAbbr = {state}
wxZone = {wxzone}
orig = {orig}
rwrOrig = {orig}
city = {city}
lat = {lat}
lon = {lon}
timezone = {tz}

[otheremwin]
ini = otheremwin.ini
allowUserLoader = true
maxUserFiles = 1000
""".format(name=a.name, theme=a.theme, data=data, nws=nws_sat, cats="\n".join(cats), paths=paths,
           radar=a.radar, state=a.state, wxzone=a.wxzone, orig=a.orig, city=city,
           lat=a.lat, lon=a.lon, tz=a.timezone))

    # ---- station.ini (only if missing: it may hold the user's own settings/keys)
    st = os.path.join(cfgdir, "station.ini")
    if not os.path.exists(st):
        ex = open(os.path.join(cfgdir, "station.ini.example")).read()
        ex = re.sub(r'(?m)^name\s*=.*$', 'name     = "{}"'.format(a.name.replace('"', "'")), ex, count=1)
        ex = re.sub(r'(?m)^location\s*=.*$', 'location = "{}"'.format(a.location.replace('"', "'")), ex, count=1)
        if sats == ["goes18"]:
            ex = ex.replace('[receiver.east]\nlabel  = "GOES-19 (EAST) HRIT 1694.1"\nsat    = "GOES-19"\nwhere  = "East"',
                            '[receiver.west]\nlabel  = "GOES-18 (WEST) HRIT 1694.1"\nsat    = "GOES-18"\nwhere  = "West"')
        with open(st, "w") as f:
            f.write(ex)

    # ---- lab-config.js
    def pick(items, sfx, wanted):
        ids = {n for n, _, _ in items}
        return [[i, label] for i, label in wanted if i in ids]
    lab = {}
    for sat in sats:
        info, s = SAT_INFO[sat], SAT_INFO[sat]["suffix"]
        prods = pick(abi_items, s, [("fdCUSTOMLUT" + s, "Color"), ("fdNIGHTLUT" + s, "Night color"),
                                    ("fdch07e_" + s, "Shortwave IR"), ("fdch13_" + s, "Infrared"),
                                    ("fdch02_" + s, "Visible"), ("fdch09e_" + s, "Water vapor")])
        if prods:
            lab[info["key"]] = dict(name=info["name"], tab=info["tab"], lon=info["lon"], region=info["region"],
                                    rx=info["key"], products=prods)
    him = pick(abi_items, "18", [("fdhimfc_18", "Color"), ("fdhimir_18", "Infrared"), ("fdhimvs_18", "Visible"), ("fdhimwve_18", "Water vapor")])
    if him:
        lab["himawari"] = dict(name="Himawari-9", tab="Himawari-9", lon="140.7° east",
                               region="East Asia, Australia and the western Pacific", rx="west",
                               inst="AHI instrument, relayed by GOES-18", products=him)
    import json
    with open(os.path.join(a.web, "lab", "lab-config.js"), "w") as f:
        f.write("/*\n * lab-config.js - satellites and products on the Lab Overview page.\n"
                " * Written by scripts/make-site-config.py. Each product is [ id, label ] where\n"
                " * id is a section of config/abi.ini; rx is the receiver id in config/station.ini.\n */\n"
                "window.LAB_SATS = " + json.dumps(lab, indent=1, ensure_ascii=False) + ";\n")

    # ---- video24config.ini (one loop per videoPath, Raspberry Pi friendly)
    loops, seen = [], set()
    for name, text, sub in abi_items + meso_items + emwin_items:
        vp = section_value(text, "videoPath")
        if not vp or not vp.lower().endswith(".mp4"):
            continue
        vname = vp[:-4]
        if vname in seen:
            continue
        seen.add(vname)
        flt = section_value(text, "filter")
        loops.append("[{}]\nsub = {}\n{}".format(vname, sub, "filter = {}\n".format(flt) if flt else ""))
    with open(a.videos_config, "w") as f:
        f.write("""; 24-hour video loops - written by scripts/make-site-config.py
; Used by create-24h-videos.py (run every 30 minutes by a systemd timer).
[settings]
ffmpeg = ffmpeg
videoDir = {web}/videos
liveRoots = {data}
archiveRoots =
hours = 24
fps = 15
; Raspberry Pi friendly: 1080 px wide, no frame blending (very slow on a Pi)
maxWidth = 1080
crf = 24
preset = veryfast
threads = 2
minFrames = 6
minSeconds = 8
smooth = no
allowSmooth = no

""".format(web=os.path.abspath(a.web), data=data) + "\n".join(loops))

    print("Site config written for: {}".format(", ".join(sats)))
    print("  Full disk entries: {}  Mesoscale: {}  EMWIN: {}  Video loops: {}".format(
        len(abi_items), len(meso_items), len(emwin_items), len(loops)))
    print("  Lab Overview: {}".format(", ".join(v["name"] for v in lab.values()) or "(none)"))


if __name__ == "__main__":
    main()
