#!/bin/bash
# Nightly FileMaker backup (Epic 2): copy the FileMaker database files (*.fmp12)
# into the weekday folder (Mo–Sa, overwritten) or, on Sunday, into
# FM_YYYY-MMM-WW, then push that folder to Robert's Google Drive /FM-Backups.
days=(x Montag Dienstag Mittwoch Donnerstag Freitag Samstag)
if [ "$(date +%u)" = 7 ]; then folder="FM_$(date +%Y-%b-%V)"; else folder="${days[$(date +%u)]}"; fi
rsync -a --delete --delete-excluded --include='*.fmp12' --exclude='*' \
  "/Library/FileMaker Server/Data/Databases/" "/DRIVE/Backups/$folder/"
/opt/homebrew/bin/rclone sync "/DRIVE/Backups/$folder" "gdrive:FM-Backups/$folder" \
  --config /Oskar/ops/rclone/rclone.conf --log-file /Oskar/logs/rclone.log
