#!/bin/bash
# =====================================================================
#  USRadioguy GOESTOOLS Ground Station - Raspberry Pi installer
#
#  Turns a Raspberry Pi 4/5 (current Raspberry Pi OS, 64-bit) with an
#  RTL-SDR or Airspy into a GOES HRIT ground station:
#    goesrecv + goesproc  (USRadioguy goestools fork, built from source)
#    Vitality GOES website + Lab view + Ground Station HUD
#    24-hour video loops, nightly cleanup of old imagery
#  View it from any browser on your network at  http://<pi-address>/
#
#  Usage:
#    sudo git clone https://github.com/creinemann/USRadioguy_GOESTOOLS_Groundstation /opt/groundstation
#    sudo chown -R $USER: /opt/groundstation
#    cd /opt/groundstation && ./install.sh
#
#  Re-running is safe: it updates the code and keeps your settings
#  (web/config/station.ini, /etc/goestools/*.conf) unless you say otherwise.
#
#  Copyright 2026 Carl Reinemann (USRadioguy). GPL v3.
#  Built on goestools (Pieter Noordhuis) and Vitality GOES (Jamie Vital).
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOESTOOLS_URL="https://github.com/creinemann/goestools"
SRC_DIR="/usr/local/src"
DATA_DEFAULT="/srv/goes"
# The account that owns the station (never root): the user running this
# script, or the sudo caller if the script itself was started with sudo.
if [ "$(id -u)" -ne 0 ]; then RUN_USER="$(id -un)"; else RUN_USER="${SUDO_USER:-}"; fi
[ -n "$RUN_USER" ] && [ "$RUN_USER" != root ] || RUN_USER=""
NONINTERACTIVE="${NONINTERACTIVE:-0}"
SKIP_GOESTOOLS="${SKIP_GOESTOOLS:-0}"
HAVE_SYSTEMD=0; [ -d /run/systemd/system ] && HAVE_SYSTEMD=1

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$*"; exit 1; }
ask()  { # ask VAR "question" "default"   (your answer from the last run is the default)
	local __v="$1" q="$2" def="${3:-}" a="" __p="PREV_$1"
	if [ -n "${!__v:-}" ]; then return; fi
	if [ -n "${!__p:-}" ]; then def="${!__p}"; fi
	if [ "$NONINTERACTIVE" = 1 ]; then printf -v "$__v" '%s' "$def"; return; fi
	read -r -p "    $q [${def}]: " a || true
	printf -v "$__v" '%s' "${a:-$def}"
}

[ -n "$RUN_USER" ] || die "Run as your normal user (it uses sudo when needed), not as root."
command -v sudo >/dev/null || die "sudo is required."
[ -f "$REPO/web/index.php" ] || die "Run install.sh from the repository folder."

cat <<'BANNER'

   USRadioguy GOESTOOLS Ground Station installer
   ---------------------------------------------
   Receiver: goesrecv + goesproc (HRIT 1694.1 MHz)
   Website : Vitality GOES + Lab view, on this Pi's web server

BANNER
case "$(uname -m)" in aarch64|armv7l|x86_64) ;; *) warn "Untested CPU type $(uname -m)";; esac
if grep -qs "Raspberry Pi 3" /proc/device-tree/model 2>/dev/null; then
	warn "Raspberry Pi 3 detected: the website works, but video loops will be slow. Loops are turned OFF by default."
	PI3=1
else PI3=0; fi

# ------------------------------------------------------------------ questions
ANSWERS=/etc/default/groundstation-answers
if [ -f "$ANSWERS" ]; then
	while IFS='=' read -r __k __val; do
		[[ $__k =~ ^[A-Z_]+$ ]] && printf -v "PREV_$__k" '%s' "$__val"
	done < "$ANSWERS"
fi
say "A few questions (press Enter to accept the [default])"
[ -f "$ANSWERS" ] && echo "    (defaults are your answers from the last install)"
ask SAT        "Satellite this Pi receives: goes19 (East) or goes18 (West, includes Himawari-9)" "goes19"
case "$SAT" in goes19|goes18) ;; 19) SAT=goes19;; 18) SAT=goes18;; *) die "Satellite must be goes19 or goes18";; esac
ask SDR        "SDR type: rtlsdr or airspy" "rtlsdr"
case "$SDR" in rtlsdr|airspy) ;; *) die "SDR must be rtlsdr or airspy";; esac
ask GAIN       "SDR gain in dB (with an LNA/SAWbird ~5-10, no LNA ~30; tune later)" "$([ "$SDR" = airspy ] && echo 18 || echo 6)"
ask BIAS_TEE   "Power your LNA from the SDR (bias tee)? yes/no" "no"
ask STATION    "Station name (shown on the website)" "My Ground Station"
ask LOCATION   "Location text (e.g. Anytown, USA)" ""
ask LAT        "Latitude (decimal, north positive)" "39.02"
ask LON        "Longitude (decimal, east positive; USA is negative)" "-76.98"
ask TZ_NAME    "Time zone" "$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo America/New_York)"
ask NWS_STATE  "US state for NWS products (2 letters)" "MD"
ask NWS_ZONE   "NWS forecast zone (e.g. MDZ013, see weather.gov)" "${NWS_STATE}Z001"
ask NWS_ORIG   "NWS office code + state (e.g. LWXMD)" "LWX${NWS_STATE}"
ask RADAR      "EMWIN radar region (NTHES, STHES, GRTLK, SOUPLN, NTHRKY, STHRKY, UPRMIS, LWRMIS, PACNWS, PACSWS)" "NTHES"
ask DATA       "Folder for received imagery" "$DATA_DEFAULT"
ask KEEP_DAYS  "Days of imagery to keep" "3"
ask LOOPS      "Make 24-hour video loops? yes/no" "$([ $PI3 = 1 ] && echo no || echo yes)"
ask SHARE      "Share the imagery folder on your network, for a Windows PC website? yes/no" "no"
ask SOLAR      "Folder of SDO/SUVI space weather images, e.g. from a GRB station (Enter = none)" "${PREV_SOLAR:-none}"
[ "$SOLAR" = none ] && SOLAR=""
for __k in SAT SDR GAIN BIAS_TEE STATION LOCATION LAT LON TZ_NAME NWS_STATE NWS_ZONE NWS_ORIG RADAR DATA KEEP_DAYS LOOPS SHARE SOLAR; do
	printf '%s=%s\n' "$__k" "${!__k}"
done | sudo tee "$ANSWERS" >/dev/null

# ------------------------------------------------------------------ packages
say "Installing packages (this can take a while)"
PKGS="git build-essential cmake pkg-config zlib1g-dev libopencv-dev libproj-dev librtlsdr-dev rtl-sdr \
      apache2 php libapache2-mod-php php-gd php-xml php-mbstring php-curl ffmpeg python3 fonts-dejavu-core rsync"
[ "$SDR" = airspy ] && PKGS="$PKGS libairspy-dev airspy"
sudo apt-get update -q || warn "apt update had errors - continuing with what is available"
# shellcheck disable=SC2086
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q $PKGS
ok "packages installed"

if [ "$SDR" = rtlsdr ] && [ ! -f /etc/modprobe.d/blacklist-rtl-dvb.conf ]; then
	echo "blacklist dvb_usb_rtl28xxu" | sudo tee /etc/modprobe.d/blacklist-rtl-dvb.conf >/dev/null
	sudo modprobe -r dvb_usb_rtl28xxu 2>/dev/null || true
	ok "TV-tuner driver blacklisted so goesrecv can use the RTL-SDR"
fi

# ------------------------------------------------------------------ goestools
if [ "$SKIP_GOESTOOLS" = 1 ]; then
	warn "Skipping goestools build (SKIP_GOESTOOLS=1)"
else
	say "Building goestools (USRadioguy fork) - about 15-30 minutes on a Pi"
	sudo mkdir -p "$SRC_DIR" && sudo chown "$RUN_USER": "$SRC_DIR"
	if [ -d "$SRC_DIR/goestools/.git" ]; then
		git -C "$SRC_DIR/goestools" pull -q --ff-only
		git -C "$SRC_DIR/goestools" submodule update -q --init --recursive
	else
		git clone -q --recursive "$GOESTOOLS_URL" "$SRC_DIR/goestools"
	fi
	mkdir -p "$SRC_DIR/goestools/build"
	echo "    Building quietly - progress and any warnings go to $SRC_DIR/goestools-build.log"
	echo "    (watch it from a second PuTTY window with:  tail -f $SRC_DIR/goestools-build.log)"
	(cd "$SRC_DIR/goestools/build" \
	   && cmake .. -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release -Wno-dev -Wno-deprecated >"$SRC_DIR/goestools-build.log" 2>&1 \
	   && make -j"$(nproc)" >>"$SRC_DIR/goestools-build.log" 2>&1) \
	   || { tail -20 "$SRC_DIR/goestools-build.log"; die "goestools build failed - full log: $SRC_DIR/goestools-build.log"; }
	(cd "$SRC_DIR/goestools/build" && sudo make install >/dev/null)
	ok "$(/usr/local/bin/goesproc --version | head -1)"
fi

# ------------------------------------------------------------------ receiver config
say "Receiver configuration (/etc/goestools)"
sudo mkdir -p /etc/goestools
write_conf() { # src dest  (always world-readable: goesrecv/goesproc run as $RUN_USER)
	if [ -f "$2" ] && [ "${OVERWRITE_CONF:-no}" != yes ]; then
		sudo install -m 644 "$1" "$2.new"; warn "$2 exists - kept yours, new version saved as $2.new"
	else sudo install -m 644 "$1" "$2"; ok "$2"; fi
}
TMPC="$(mktemp)"
sed -e "s/^source = \"rtlsdr\"/source = \"$SDR\"/" "$REPO/goestools/goesrecv.conf" > "$TMPC"
if [ "$SDR" = airspy ]; then
	python3 - "$TMPC" "$GAIN" "$BIAS_TEE" <<'PY'
import sys,re
p,g,b=sys.argv[1:]; s=open(p).read()
s=re.sub(r'\[rtlsdr\]\n(?:[^\[]*?\n)(?=#\[airspy\])','',s,flags=re.S)
s=s.replace('#[airspy]\n#frequency = 1694100000\n#gain = 18\n#bias_tee = false','[airspy]\nfrequency = 1694100000\ngain = %s\nbias_tee = %s' % (g, 'true' if b.lower().startswith('y') else 'false'))
open(p,'w').write(s)
PY
else
	sed -i -e "0,/^gain = .*/s//gain = $GAIN/" -e "0,/^bias_tee = .*/s//bias_tee = $([[ $BIAS_TEE == y* ]] && echo true || echo false)/" "$TMPC"
fi
write_conf "$TMPC" /etc/goestools/goesrecv.conf; rm -f "$TMPC"
# A goesrecv.conf kept from an older setup may lack the publishers this station needs:
# 5004 feeds goesproc, 6001/6002 feed the website's SDR stats. Add any that are missing.
__added=""
for __pub in "decoder.packet_publisher|tcp://0.0.0.0:5004|send_buffer = 1048576" \
             "demodulator.stats_publisher|tcp://0.0.0.0:6001|" \
             "decoder.stats_publisher|tcp://0.0.0.0:6002|"; do
	IFS='|' read -r __sec __bind __extra <<< "$__pub"
	if ! grep -qE "^\[${__sec//./\\.}\]" /etc/goestools/goesrecv.conf; then
		[ -z "$__added" ] && sudo cp -p /etc/goestools/goesrecv.conf /etc/goestools/goesrecv.conf.before-publishers
		printf '\n# Added by groundstation install.sh (needed by goesproc / the website)\n[%s]\nbind = "%s"\n%s\n' "$__sec" "$__bind" "$__extra" \
			| sudo tee -a /etc/goestools/goesrecv.conf >/dev/null
		__added="$__added $__sec"
	fi
done
if [ -n "$__added" ]; then ok "goesrecv.conf: added$__added (backup: goesrecv.conf.before-publishers)"; fi
# Satellite changed since the last install (e.g. a GOES-19 Pi turned into a GOES-18 Pi)?
# Then the kept goesproc config and station.ini describe the wrong satellite: replace them.
if [ -f /etc/goestools/goesproc-goesr.conf ] && ! grep -qE "^[[:space:]]*origin[[:space:]]*=[[:space:]]*\"$SAT\"" /etc/goestools/goesproc-goesr.conf; then
	__stamp="$(date +%Y%m%d-%H%M%S)"
	sudo cp -p /etc/goestools/goesproc-goesr.conf "/etc/goestools/goesproc-goesr.conf.before-$SAT-$__stamp"
	sudo install -m 644 "$REPO/goestools/goesproc-$SAT.conf" /etc/goestools/goesproc-goesr.conf
	ok "goesproc config switched to $SAT (old one: goesproc-goesr.conf.before-$SAT-$__stamp)"
	if [ -f "$REPO/web/config/station.ini" ]; then
		mv "$REPO/web/config/station.ini" "$REPO/web/config/station.ini.before-$SAT-$__stamp"
		warn "station.ini rebuilt for $SAT (old one kept as station.ini.before-$SAT-$__stamp; copy any Grafana keys back by hand)"
	fi
fi
write_conf "$REPO/goestools/goesproc-$SAT.conf" /etc/goestools/goesproc-goesr.conf
# Himawari-9 channels now go in their own folders, like GOES: himawari9/fd/<vs|ir|wv>/<date>/
# (older configs put all three in himawari9/fd/<date>/). Move a kept config over.
__himold='directory = "./himawari9/{region:short|lower}/{time:%Y-%m-%d}"'
if sudo grep -qF "$__himold" /etc/goestools/goesproc-goesr.conf; then
	sudo cp -p /etc/goestools/goesproc-goesr.conf /etc/goestools/goesproc-goesr.conf.before-himawari-folders
	sudo sed -i 's#"./himawari9/{region:short|lower}/{time:%Y-%m-%d}"#"./himawari9/{region:short|lower}/{channel:short|lower}/{time:%Y-%m-%d}"#' /etc/goestools/goesproc-goesr.conf
	ok "Himawari-9 channels now saved in fd/vs, fd/ir, fd/wv (backup: goesproc-goesr.conf.before-himawari-folders)"
fi
sudo chmod 644 /etc/goestools/*.conf   # fixes configs written by older installer versions

sudo mkdir -p "$DATA" && sudo chown "$RUN_USER": "$DATA" && sudo chmod 755 "$DATA"
ok "imagery folder $DATA"
printf 'DATA="%s"\nKEEP_DAYS="%s"\nKEEP_TEXT_DAYS="2"\n' "$DATA" "$KEEP_DAYS" | sudo tee /etc/default/groundstation >/dev/null

# ------------------------------------------------------------------ website config
say "Website configuration"
python3 "$REPO/scripts/make-site-config.py" --data "$DATA" --sat "$SAT" \
	--goesproc /etc/goestools/goesproc-goesr.conf --web "$REPO/web" \
	--videos-config "$REPO/scripts/video24config.ini" \
	--name "$STATION" --location "$LOCATION" --lat "$LAT" --lon "$LON" --timezone "$TZ_NAME" \
	--state "$NWS_STATE" --wxzone "$NWS_ZONE" --orig "$NWS_ORIG" --radar "$RADAR" \
	${SOLAR:+--solar "$SOLAR"}
if [ -n "$SOLAR" ]; then
	if sudo -u www-data test -r "$SOLAR" -a -x "$SOLAR" 2>/dev/null; then ok "Space Weather pages turned on ($SOLAR)"
	else warn "The web server can't read $SOLAR - make it readable (e.g. chmod o+rx) or the Space Weather pages stay empty"; fi
fi
mkdir -p "$REPO/web/videos"
chmod 755 "$REPO" "$REPO/web" "$REPO/web/videos"
ok "web/config/*.ini, lab/lab-config.js, scripts/video24config.ini"

# ------------------------------------------------------------------ Apache
say "Web server (Apache + PHP)"
sudo tee /etc/apache2/sites-available/groundstation.conf >/dev/null <<EOF
# USRadioguy GOESTOOLS Ground Station - written by install.sh
<VirtualHost *:80>
	DocumentRoot $REPO/web
	<Directory $REPO/web>
		Options -Indexes +FollowSymLinks
		AllowOverride All
		Require all granted
	</Directory>
	ErrorLog \${APACHE_LOG_DIR}/groundstation-error.log
	CustomLog \${APACHE_LOG_DIR}/groundstation-access.log combined
</VirtualHost>
EOF
sudo a2enmod -q rewrite headers >/dev/null
sudo a2dissite -q 000-default >/dev/null 2>&1 || true
sudo a2ensite -q groundstation >/dev/null
if [ $HAVE_SYSTEMD = 1 ]; then sudo systemctl reload-or-restart apache2; else sudo apache2ctl -k graceful 2>/dev/null || sudo apache2ctl start; fi
ok "website served from $REPO/web"

# ------------------------------------------------------------------ an older goestools setup?
# Older guides start goesrecv/goesproc from /etc/rc.local (often inside screen),
# a crontab @reboot line, or their own systemd units. Left running, the old goesrecv
# keeps the SDR (the new one dies with signal=ABRT, and the website shows no SDR
# stats) and the old goesproc saves a second copy of every image.
OLD_RC=""; OLD_CRON=""; OLD_UNITS=""; OLD_PROCS=""; OLD_OUT=""
grep -qsE '^[^#]*goes(recv|proc)' /etc/rc.local && OLD_RC=1
for __u in root "$RUN_USER"; do
	sudo crontab -l -u "$__u" 2>/dev/null | grep -qE '^[^#]*goes(recv|proc)' && OLD_CRON="$OLD_CRON $__u"
done
for __f in /etc/systemd/system/*.service /lib/systemd/system/*.service; do
	[ -f "$__f" ] || continue
	case "$(basename "$__f")" in goesrecv.service|goesproc.service) continue;; esac
	grep -qE '^ExecStart=.*goes(recv|proc)' "$__f" && OLD_UNITS="$OLD_UNITS $(basename "$__f")"
done
if [ $HAVE_SYSTEMD = 1 ]; then
	__ours="$(systemctl show -p MainPID --value goesrecv.service 2>/dev/null) $(systemctl show -p MainPID --value goesproc.service 2>/dev/null)"
else __ours=""; fi
for __pid in $(pgrep -x goesrecv; pgrep -x goesproc); do
	case " $__ours " in *" $__pid "*) ;; *) OLD_PROCS="$OLD_PROCS $__pid";; esac
done
# where the old goesproc saved images (from rc.local, crontab or running processes)
OLD_OUT="$( { grep -hoE -- "--out[= ]+[^ \"']+" /etc/rc.local 2>/dev/null
              for __u in root "$RUN_USER"; do sudo crontab -l -u "$__u" 2>/dev/null; done | grep -oE -- "--out[= ]+[^ \"']+"
              for __pid in $OLD_PROCS; do tr '\0' ' ' < /proc/$__pid/cmdline 2>/dev/null | grep -oE -- "--out[= ]+[^ \"']+"; done
            } | sed -E 's/--out[= ]+//' | sort -u | grep -vx "$DATA" | tr '\n' ' ' || true)"

if [ -n "$OLD_RC$OLD_CRON$OLD_UNITS$OLD_PROCS" ]; then
	say "Older goestools setup found"
	[ -n "$OLD_RC" ]    && echo "    /etc/rc.local starts goesrecv/goesproc"
	[ -n "$OLD_CRON" ]  && echo "    crontab starts goesrecv/goesproc for:$OLD_CRON"
	[ -n "$OLD_UNITS" ] && echo "    other systemd services:$OLD_UNITS"
	[ -n "$OLD_PROCS" ] && echo "    old goesrecv/goesproc still running (process$OLD_PROCS)"
	echo "    Left running, the old goesrecv keeps the SDR and every image is saved twice."
	ask TAKEOVER "Turn the old setup off (backups are kept) and use the new services? yes/no" "yes"
	if [[ $TAKEOVER == y* ]]; then
		if [ -n "$OLD_RC" ]; then
			sudo cp -p /etc/rc.local /etc/rc.local.before-groundstation
			sudo sed -i -E 's/^([^#]*goes(recv|proc).*)$/# turned off by groundstation install.sh: \1/' /etc/rc.local
			ok "/etc/rc.local: old lines commented out (backup: /etc/rc.local.before-groundstation)"
		fi
		for __u in $OLD_CRON; do
			sudo crontab -l -u "$__u" 2>/dev/null | sudo tee "/var/backups/crontab.$__u.before-groundstation" >/dev/null
			sudo crontab -l -u "$__u" | sed -E 's/^([^#]*goes(recv|proc).*)$/# turned off by groundstation install.sh: \1/' | sudo crontab -u "$__u" -
			ok "crontab ($__u): old lines commented out (backup: /var/backups/crontab.$__u.before-groundstation)"
		done
		for __u in $OLD_UNITS; do
			sudo systemctl disable --now "$__u" >/dev/null 2>&1 && ok "stopped and disabled $__u"
		done
		if [ -n "$OLD_PROCS" ]; then
			sudo kill $OLD_PROCS 2>/dev/null || true; sleep 2; sudo kill -9 $OLD_PROCS 2>/dev/null || true
			ok "stopped the old goesrecv/goesproc"
		fi
		for __d in $OLD_OUT; do
			if [ -d "$__d" ]; then warn "Old images are still in $__d ($(du -sh "$__d" 2>/dev/null | cut -f1)). New images go to $DATA. Delete the old folder when you no longer need it:  rm -rf \"$__d\""; fi
		done
	else
		warn "Old setup left as is: the new goesrecv will probably fail (SDR busy) until you turn it off."
	fi
fi

# ------------------------------------------------------------------ services
say "Services"
for u in goesrecv.service goesproc.service groundstation-videos.service groundstation-videos.timer groundstation-cleanup.service groundstation-cleanup.timer; do
	sed -e "s#@USER@#$RUN_USER#g" -e "s#@DATA@#$DATA#g" -e "s#@REPO@#$REPO#g" "$REPO/systemd/$u" | sudo tee "/etc/systemd/system/$u" >/dev/null
done
if [ $HAVE_SYSTEMD = 1 ]; then
	sudo systemctl daemon-reload
	sudo systemctl enable goesrecv.service goesproc.service groundstation-cleanup.timer >/dev/null
	sudo systemctl restart goesrecv.service goesproc.service >/dev/null
	sudo systemctl start groundstation-cleanup.timer >/dev/null
	if [[ $LOOPS == y* ]]; then sudo systemctl enable --now groundstation-videos.timer >/dev/null; ok "video loops every 30 min"
	else sudo systemctl disable --now groundstation-videos.timer >/dev/null 2>&1 || true; ok "video loops off (enable later: sudo systemctl enable --now groundstation-videos.timer)"; fi
	ok "goesrecv, goesproc and nightly cleanup running"
else
	warn "systemd not running here - services installed but not started"
fi
# ------------------------------------------------------------------ network share (optional)
if [[ ${SHARE:-no} == y* ]]; then
	say "Network share for a Windows PC"
	sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q samba >/dev/null
	if ! grep -q '^\[goes\]' /etc/samba/smb.conf; then
		printf '\n# USRadioguy GOESTOOLS Ground Station - written by install.sh\n[goes]\n   path = %s\n   read only = yes\n   browseable = yes\n   valid users = %s\n' "$DATA" "$RUN_USER" \
			| sudo tee -a /etc/samba/smb.conf >/dev/null
	fi
	if ! sudo pdbedit -L 2>/dev/null | grep -q "^$RUN_USER:"; then
		if [ "$NONINTERACTIVE" = 1 ]; then warn "Set the share password later with:  sudo smbpasswd -a $RUN_USER"
		else echo "    Choose a password for the share. Windows asks for it once (it can match your Pi password):"
			sudo smbpasswd -a "$RUN_USER"; fi
	fi
	[ $HAVE_SYSTEMD = 1 ] && sudo systemctl restart smbd
	SHARE_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
	ok "imagery shared read-only as  \\\\${SHARE_IP}\\goes   (user: $RUN_USER)"
fi


IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

   ✅  Done!

   Open the website from any browser on your network:
       http://${IP:-<this-pi-address>}/          classic Vitality view
       http://${IP:-<this-pi-address>}/lab/      Lab view

   Images appear a few minutes after goesrecv locks on (point the dish,
   then watch:  journalctl -u goesrecv -f ).
   Settings:  $REPO/web/config/station.ini   (name, receivers, Grafana)
              /etc/goestools/goesrecv.conf    (gain, SDR)
   Update later:  cd $REPO && git pull && ./install.sh

   Original software:
     * Vitality GOES: (c) 2022-2025 Jamie Vital
         https://github.com/JVital2013/vitality-goes
     * goestools: (c) Pieter Noordhuis and contributors
         https://github.com/pietern/goestools
     * USRadioguy additions (Lab view, HUD, themes, LUTs, Himawari support,
       Pi installer, Linux scripts): (c) 2023-2026 Carl Reinemann
         https://usradioguy.com/

   Please visit usradioguy.com and donate today to help keep the site
   and software running!   ☕  https://ko-fi.com/usradioguy

EOF
