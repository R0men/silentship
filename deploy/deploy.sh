#!/usr/bin/env bash
# Production deploy, run on the VPS as the service user. GitHub Actions connects with a key that is
# restricted in ~/.ssh/authorized_keys to this script and passes the commit sha as the SSH command:
#   restrict,command="bash /home/silentship/silentship/deploy/deploy.sh" ssh-ed25519 AAAA… github-actions
# Manual run on the server: bash ~/silentship/deploy/deploy.sh <commit-sha>
#
# Steps: check out the commit (only one already on origin/main), npm ci when the lockfile changed,
# build the site, wait for a running crawl to finish (a restart mid-commit would leave a stale
# index.lock in the archive), restart the service, wait until both apps answer.

# Everything is inside main(): bash reads scripts lazily, and `git reset` below rewrites this file.
main() {
  set -euo pipefail
  local app_dir="${APP_DIR:-$HOME/silentship}"
  local service=silentship
  local sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
  log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }

  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "usage: deploy.sh <40-character commit sha>" >&2
    return 2
  fi

  cd "$app_dir"
  exec 9>"$app_dir/.deploy.lock"
  flock -n 9 || { echo "another deploy is running" >&2; return 1; }

  log "fetching $sha"
  git fetch --quiet origin main
  git merge-base --is-ancestor "$sha" origin/main || { echo "$sha is not on origin/main" >&2; return 1; }
  local old_lock new_lock
  old_lock=$(git rev-parse -q --verify HEAD:package-lock.json 2>/dev/null || true)
  git reset --quiet --hard "$sha"
  new_lock=$(git rev-parse HEAD:package-lock.json)

  if [[ "$old_lock" != "$new_lock" || ! -d node_modules ]]; then
    log "package-lock.json changed: npm ci"
    npm ci --no-audit --no-fund
  fi

  log "building the site"
  npm run build

  log "waiting for a running crawl to finish"
  local i health
  for i in $(seq 1 60); do
    health=$(curl -sS --max-time 5 http://127.0.0.1:4000/health 2>/dev/null || true)
    [[ "$health" == *'"lastStatus":"running"'* ]] || break
    sleep 5
  done

  log "restarting $service"
  if ! sudo -n systemctl restart "$service" 2>/dev/null; then
    # No sudo rule: stop the main process; Restart=always brings the unit back with the new build.
    local pid
    pid=$(systemctl show -p MainPID --value "$service")
    [[ "$pid" -gt 0 ]] && kill -TERM "$pid"
  fi

  log "waiting for the site and the API"
  sleep 8
  for i in $(seq 1 30); do
    if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:4000/api/overview &&
      curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:3000/; then
      log "deployed $(git log -1 --format='%h %s')"
      return 0
    fi
    sleep 3
  done
  echo "service did not come back; see journalctl -u $service" >&2
  return 1
}

main "$@"
exit $?
