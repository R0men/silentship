#!/usr/bin/env bash
# Nightly backup, run on the VPS as the service user by deploy/silentship-backup.timer (03:17 UTC).
# Manual run: bash ~/silentship/deploy/backup.sh
#
# 1. mongodump of the database into $BACKUP_DIR/daily/silentship-<date>.archive.gz (gzip, one file);
#    on Sundays the same file is also kept in weekly/.
# 2. Rotation: the 14 newest daily and the 8 newest weekly dumps stay.
# 3. Off-site: with BACKUP_RCLONE_REMOTE (e.g. b2:silentship-backups) rclone mirrors daily/ and weekly/
#    there; without it the dumps stay on this server only, and the log says so.
# 4. With ARCHIVE_REMOTE (a private git remote) the archive (ARCHIVE_DIR) is pushed there: it holds
#    Microsoft's code, so that remote must never be public.
# Settings come from the environment or the repository's .env; restore steps are in docs/SETUP.md.

main() {
  set -euo pipefail
  # Dumps hold subscriber emails: only the service user may read them.
  umask 077
  local app_dir="${APP_DIR:-$HOME/silentship}"
  log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

  # One KEY=value from .env, without sourcing it (values such as the MongoDB URI may hold & or ?).
  env_value() {
    local name="$1" line
    if [[ -n "${!name:-}" ]]; then
      printf '%s' "${!name}"
      return
    fi
    [[ -f "$app_dir/.env" ]] || return 0
    line=$(grep -E "^${name}=" "$app_dir/.env" | tail -n 1 || true)
    line="${line#*=}"
    line="${line%\"}"
    line="${line#\"}"
    line="${line%\'}"
    line="${line#\'}"
    printf '%s' "$line"
  }

  local uri db dir remote archive_remote archive_dir
  uri=$(env_value MONGODB_URI)
  db=$(env_value MONGODB_DB)
  dir=$(env_value BACKUP_DIR)
  dir="${dir:-$HOME/backups}"
  remote=$(env_value BACKUP_RCLONE_REMOTE)
  archive_remote=$(env_value ARCHIVE_REMOTE)
  archive_dir=$(env_value ARCHIVE_DIR)
  archive_dir="${archive_dir:-./data/archive}"
  [[ "$archive_dir" = /* ]] || archive_dir="$app_dir/${archive_dir#./}"

  if [[ -z "$uri" ]]; then
    echo "MONGODB_URI is not set (environment or $app_dir/.env)" >&2
    return 1
  fi

  mkdir -p "$dir/daily" "$dir/weekly"
  local day file
  day=$(date -u +%F)
  file="$dir/daily/silentship-$day.archive.gz"
  log "mongodump → $file"
  # The URI goes through a 0600 config file, not the command line, where `ps` would show the password.
  local cfg
  cfg=$(mktemp)
  trap 'rm -f "$cfg"' RETURN
  chmod 600 "$cfg"
  printf 'uri: "%s"\n' "$uri" >"$cfg"
  mongodump --config="$cfg" ${db:+--db="$db"} --archive="$file.part" --gzip --quiet
  mv "$file.part" "$file"
  log "dump $(du -h "$file" | cut -f1)"

  if [[ "$(date -u +%u)" == 7 ]]; then
    cp -f "$file" "$dir/weekly/"
    log "weekly copy kept"
  fi

  # Newest first by name (the date is in it); everything after the first N goes.
  rotate() {
    local keep="$1" sub="$2"
    find "$dir/$sub" -maxdepth 1 -name 'silentship-*.archive.gz' | sort -r | tail -n +"$((keep + 1))" |
      while read -r old; do
        rm -f "$old"
        log "rotated out $sub/$(basename "$old")"
      done
  }
  rotate 14 daily
  rotate 8 weekly

  if [[ -n "$remote" ]]; then
    log "rclone sync → $remote"
    rclone sync --quiet "$dir/daily" "$remote/daily"
    rclone sync --quiet "$dir/weekly" "$remote/weekly"
  else
    log "WARNING: BACKUP_RCLONE_REMOTE is not set; the dumps are on this server only"
  fi

  if [[ -n "$archive_remote" ]]; then
    log "pushing the archive to ARCHIVE_REMOTE"
    git -C "$archive_dir" push --quiet "$archive_remote" HEAD:refs/heads/main
  else
    log "WARNING: ARCHIVE_REMOTE is not set; $archive_dir has no copy off this server"
  fi
  log "done"
}

main "$@"
exit $?
