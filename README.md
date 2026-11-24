# USRadioguy GOESTOOLS Ground Station

A complete GOES weather-satellite ground station for the **Raspberry Pi**:
receive the HRIT downlink (1694.1 MHz) from **GOES-19** (East) or
**GOES-18** (West, which also relays **Himawari-9**), decode it with
goestools, and browse the imagery from any phone, tablet or computer on
your network.

This is the setup that runs the [USRadioguy](https://usradioguy.com)
station in Horicon, Wisconsin, packaged so anyone can install it with
**one script**.
You must have a 64 bit PI operating system, for ease of install, I recommend 
Raspberry Pi Imager (https://www.raspberrypi.com/software/) Select the 64 bit 
OS LITE Version (under 'Raspberry PI OS (other)' 

> NOTE: AI (Claude) was used to help streamline and check code.

## What you get
- **goestools, USRadioguy edition**
  ([creinemann/goestools](https://github.com/creinemann/goestools)),
  built from source. It adds the following, using the USRadioguy custom
  and night color LUTs:
  - Himawari-9 false color
  - enhanced water vapor
- **Vitality GOES** website: full disk and mesoscale imagery, NWS and
  EMWIN products, local weather, space weather.
- **Lab view** (`/lab/`): a modern front end with satellite tabs, a
  timeline, loop playback and receiver status.
- **Ground Station HUD:** live goesrecv signal quality (Viterbi errors,
  packets per second, gain, frequency) plus the Pi's CPU, temperature,
  memory and disk.
- **24-hour video loops** of every product, rebuilt automatically.
- **Nightly cleanup**, so the SD card never fills up.
- **Themes:** Ground Station, Apollo Panel, Starship Ops, NWS Amber and
  more.

## What you need
| | |
|---|---|
| Computer | **Raspberry Pi 4 or 5** (2 GB+), current Raspberry Pi OS (64-bit). A Pi 3 runs the website, but video loops are turned off by default. |
| Storage | 32 GB+ SD card; a USB SSD is better (about 3 GB/day of imagery, 3 days kept by default) |
| Radio | RTL-SDR (v3/v4) or Airspy, plus a GOES LNA/filter (e.g. Nooelec SAWbird+ GOES) |
| Antenna | A 1.7 GHz grid or dish antenna aimed at your satellite |

## Install
On the Pi (logged in as your normal user, **not** root):

```bash
sudo apt install -y git
sudo git clone https://github.com/creinemann/USRadioguy_GOESTOOLS_Groundstation /opt/groundstation
sudo chown -R $USER: /opt/groundstation
cd /opt/groundstation
./install.sh
```

The installer asks a few questions: which satellite, SDR type and gain,
your station name and location, and the NWS codes for your local
forecast. Then it:
1. installs Apache, PHP, ffmpeg and the build tools;
2. builds and installs goestools to `/usr/local`, about 15–30 minutes;
3. writes `/etc/goestools/goesrecv.conf` and `goesproc-goesr.conf`;
4. generates the website config **for exactly the products your
   goesproc makes**;
5. sets up services: goesrecv, goesproc, video loops every 30 minutes,
   and a nightly cleanup.

When it finishes, open **`http://<your-pi-address>/`** (or `/lab/`) in
any browser on your network.

> **Already running goestools from `/etc/rc.local` or in `screen`?**
> Remove those lines first. Two copies of goesrecv fight over the SDR,
> and the second one fails with `signal=ABRT`.

### Unattended install
Every question can be answered with an environment variable:
```bash
NONINTERACTIVE=1 SAT=goes18 SDR=rtlsdr GAIN=30 STATION="My Station" \
LOCATION="Anytown, USA" LAT=39.0 LON=-77.0 NWS_STATE=MD NWS_ZONE=MDZ013 \
NWS_ORIG=LWXMD RADAR=NTHES ./install.sh
```
Other options:
- `SKIP_GOESTOOLS=1` keeps an existing goestools.
- `OVERWRITE_CONF=yes` replaces existing `/etc/goestools` configs.

## After installing
| Task | How |
|---|---|
| Watch the receiver | `journalctl -u goesrecv -f`, or the **Ground Station** page |
| Tune gain / SDR | edit `/etc/goestools/goesrecv.conf`, then `sudo systemctl restart goesrecv` |
| Change station name, receivers, Grafana | edit `web/config/station.ini` |
| Change products | edit `/etc/goestools/goesproc-goesr.conf`, then re-run `./install.sh` (it rebuilds the site config) |
| Turn video loops on or off | `sudo systemctl enable --now groundstation-videos.timer` (or `disable --now`) |
| Days of imagery kept | `KEEP_DAYS` in `/etc/default/groundstation` |
| Update | `cd /opt/groundstation && git pull && ./install.sh` |

### Viewing from outside your home
By default the site is visible **only on your own network**. Don't
port-forward it to the internet. For remote access, install
[Tailscale](https://tailscale.com) on the Pi and on your phone or laptop.

## Repository layout
```
install.sh                  Raspberry Pi installer
goestools/                  goesrecv.conf and goesproc configs (GOES-19, GOES-18 + Himawari-9)
web/                        the website (Vitality GOES + USRadioguy additions)
  config/station.ini.example  station name, receivers, optional Grafana keys
  lab/                        Lab view
  station_stats.php           receiver + system stats for the HUD and Lab view
scripts/
  make-site-config.py       writes the site config from your goesproc config
  create-24h-videos.py      24-hour video loops (Linux)
  cleanup-imagery.sh        deletes old imagery
systemd/                    service and timer units (filled in by install.sh)
templates/vitality/         product catalog the site config is built from
windows/                    Windows versions of the loop and cleanup scripts (XAMPP setups)
```

### Running on Windows (XAMPP)
The website runs the same way under XAMPP:
1. Copy `web/` to `htdocs`.
2. Create `web/config/*.ini` for your folders. Run
   `scripts/make-site-config.py`, or start from `templates/vitality/` and
   set the `[paths]` in `config.ini`.
3. Copy `config/station.ini.example` to `station.ini`.
4. For loops, use `windows/24hour/Create24HourVideos.ps1` with
   `video24config.example.ini`.

### Several receivers (like the USRadioguy station)
Run one receiver Pi per satellite and the website on one of them, or on
a separate computer:
- Add each Pi as a `[receiver.<id>]` section in `station.ini`, with its
  address.
- Optionally add a read-only Grafana key for each, to show that Pi's
  health and history.
- Generate the site config with one `--sat`/`--goesproc` pair per
  receiver.

## Credits and license
- **Vitality GOES:** © 2022-2025 Jamie Vital,
  [JVital2013/vitality-goes](https://github.com/JVital2013/vitality-goes)
- **goestools:** © Pieter Noordhuis and contributors,
  [pietern/goestools](https://github.com/pietern/goestools)
- **USRadioguy additions** (Lab view, HUD, themes, LUTs, Himawari
  support, Pi installer, Linux scripts): © 2023-2026 Carl Reinemann,
  [usradioguy.com](https://usradioguy.com)
- Fonts in `web/lab/fonts` and the themes are under the SIL Open Font
  License; see the `OFL-*.txt` files.
- SDO imagery courtesy of NASA/SDO. SUVI and space weather products
  courtesy of NOAA.

Licensed under the **GNU General Public License v3**; see [LICENSE](LICENSE).
