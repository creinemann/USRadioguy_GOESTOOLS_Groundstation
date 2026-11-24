#!/bin/bash
# cleanup-imagery.sh - keep the SD card / disk from filling up.
# Deletes goestools output older than KEEP_DAYS (images) and KEEP_TEXT_DAYS
# (EMWIN, NWS and text products), then removes empty date folders.
# Settings come from /etc/default/groundstation (written by install.sh).
#
# Copyright 2026 Carl Reinemann (USRadioguy). GPL v3.
set -u
[ -r /etc/default/groundstation ] && . /etc/default/groundstation
DATA="${DATA:-$HOME/goes}"
KEEP_DAYS="${KEEP_DAYS:-3}"
KEEP_TEXT_DAYS="${KEEP_TEXT_DAYS:-2}"

[ -d "$DATA" ] || { echo "No data folder: $DATA"; exit 0; }
case "$DATA" in /|/home|/home/*/|/usr*|/etc*|/var|/boot*) echo "Refusing to clean unsafe path: $DATA"; exit 1;; esac

before=$(df -Pk "$DATA" | awk 'NR==2{print $4}')
# EMWIN / NWS / text: short life
find "$DATA" -type f \( -path "*/emwin/*" -o -path "*/nws/*" -o -path "*/text/*" \) \
     -mmin +$((KEEP_TEXT_DAYS * 1440)) -delete 2>/dev/null
# Images (goestools writes jpg/png; json headers if enabled)
find "$DATA" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.json" -o -iname "*.gif" \) \
     -mmin +$((KEEP_DAYS * 1440)) -delete 2>/dev/null
# Empty folders left behind (never the data folder itself)
find "$DATA" -mindepth 2 -type d -empty -delete 2>/dev/null
after=$(df -Pk "$DATA" | awk 'NR==2{print $4}')
echo "cleanup-imagery: kept ${KEEP_DAYS} day(s) of images, ${KEEP_TEXT_DAYS} of text; freed $(( (after - before) / 1024 )) MB; $(( after / 1024 )) MB free"
