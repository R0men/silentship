#!/usr/bin/env bash
# Nightly backup, run on the VPS as the service user by deploy/silentship-backup.timer (03:17 UTC).
# Manual run: bash ~/silentship/deploy/backup.sh
#
# 1. mongodump of the database into $BACKUP_DIR/daily/silentship-<date>.archive.gz (gzip, one file);
#    on Sundays the same file is also kept in weekly/.
# 2. Rotation: the 14 newest daily and the 8 newest weekly dumps stay.
# 3. Snapshots: MongoDB deletes them after 30 days (TTL), so each finished day goes to
#    snapshots/<date>.jsonl.gz and stays there. Never rotated: this is their only long-term history.
# 4. Off-site: with BACKUP_RCLONE_REMOTE (e.g. b2:silentship-backups) rclone mirrors daily/, weekly/ and
#    snapshots/ there; without it the files stay on this server only, and the log says so.
# 5. With ARCHIVE_REMOTE (a private git remote) the archive (ARCHIVE_DIR) is pushed there: it holds
#    Microsoft's code, so that remote must never be public.
# 6. With HEALTHCHECK_URL, a failed run pings <url>/fail. A successful run does not ping: that URL expects crawls.
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

  # Any failure, also one that set -e ends the script on, must reach someone: nobody reads this log every night.
  # The URL goes through stdin, not the command line, where `ps` would show it.
  BACKUP_FAIL_URL=$(env_value HEALTHCHECK_URL)
  ping_failure() {
    local code=$?
    if [[ "$code" != 0 && -n "$BACKUP_FAIL_URL" ]]; then
      printf 'url = "%s/fail"\n' "${BACKUP_FAIL_URL%/}" | curl -fsS --max-time 5 -o /dev/null --config - ||
        log "WARNING: the failure ping did not go through"
    fi
    exit "$code"
  }
  trap ping_failure EXIT

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

  # The database the backend uses (databaseName in backend/src/db.js): MONGODB_DB, the URI's path, "silentship".
  snapshots_db() {
    local path="${uri%%\?*}"
    path="${path#*://}"
    [[ "$path" == */* ]] && path="${path#*/}" || path=""
    printf '%s' "${db:-${path:-silentship}}"
  }

  # Every finished day still inside the TTL without a file, so a missed night and the first run catch up on their
  # own. A failure leaves no file, is retried tomorrow and fails the run, after the steps below have had their turn.
  local snapshots_failed=0
  export_snapshots() {
    mkdir -p "$dir/snapshots"
    local i d next out query name
    name=$(snapshots_db)
    for ((i = 30; i >= 1; i--)); do
      d=$(date -u -d "-$i days" +%F)
      out="$dir/snapshots/$d.jsonl.gz"
      [[ -f "$out" ]] && continue
      next=$(date -u -d "$d 00:00 UTC +1 day" +%F)
      query="{\"fetchedAt\":{\"\$gte\":{\"\$date\":\"${d}T00:00:00Z\"},\"\$lt\":{\"\$date\":\"${next}T00:00:00Z\"}}}"
      if mongoexport --config="$cfg" --db="$name" --collection=snapshots --query="$query" --quiet | gzip >"$out.part"; then
        mv "$out.part" "$out"
        log "snapshots $d: $(gzip -dc "$out" | wc -l) rows"
      else
        rm -f "$out.part"
        log "ERROR: snapshots $d were not exported"
        snapshots_failed=1
      fi
    done
  }
  export_snapshots

  if [[ -n "$remote" ]]; then
    log "rclone sync → $remote"
    rclone sync --quiet "$dir/daily" "$remote/daily"
    rclone sync --quiet "$dir/weekly" "$remote/weekly"
    rclone sync --quiet "$dir/snapshots" "$remote/snapshots"
  else
    log "WARNING: BACKUP_RCLONE_REMOTE is not set; the dumps and snapshots are on this server only"
  fi

  if [[ -n "$archive_remote" ]]; then
    log "pushing the archive to ARCHIVE_REMOTE"
    git -C "$archive_dir" push --quiet "$archive_remote" HEAD:refs/heads/main
  else
    log "WARNING: ARCHIVE_REMOTE is not set; $archive_dir has no copy off this server"
  fi
  [[ "$snapshots_failed" == 0 ]] || return 1
  log "done"
}

main "$@"
exit $?
