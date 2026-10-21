#!/usr/bin/env bash
# Mac's Marlin: box-side ocean data refresh (active refresh; replaces ops/ocean-workflow.yml).
# Call hourly. Runs only when due: last success >= 11 h ago AND local hour (Australia/Brisbane) in 5-8 or 17-20,
# or last success > 14 h ago. --force skips the due check. Prints ONE status line:
#   REFRESHED <ages> | SKIPPED not due | FAILED <reason>   (exit 0, 0, 2)
# Touches only the JonathanAgronica/marlin-app clone this script lives in. Hard limit ~6 min.
set -uo pipefail
export TZ=Australia/Brisbane
REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
STATE_DIR="${MARLIN_STATE_DIR:-$HOME/.cache/marlin-refresh}"; mkdir -p "$STATE_DIR"
LAST="$STATE_DIR/last_success"; LOG="$STATE_DIR/last_run.log"; LOCK="$STATE_DIR/lock"
DEADLINE=$(( $(date +%s) + 350 ))
fail(){ echo "FAILED $*"; exit 2; }
left(){ echo $(( DEADLINE - $(date +%s) )); }
GIT(){ timeout "$(( $(left) > 5 ? $(left) : 5 ))" git -C "$REPO" "$@"; }

exec 9>"$LOCK"; flock -n 9 || { echo "SKIPPED not due (another refresh is running)"; exit 0; }

# ---- due check ----
if [ "${1:-}" != "--force" ]; then
  now=$(date +%s); last=$(cat "$LAST" 2>/dev/null || echo 0); age_h=$(( (now - last) / 3600 )); hr=$((10#$(date +%H)))
  inwin=0; { [ $hr -ge 5 ] && [ $hr -le 8 ]; } || { [ $hr -ge 17 ] && [ $hr -le 20 ]; } && inwin=1
  if ! { [ $age_h -ge 11 ] && [ $inwin -eq 1 ]; } && ! [ $(( now - last )) -gt $(( 14 * 3600 )) ]; then echo "SKIPPED not due"; exit 0; fi
fi

# ---- safety: right repo, right identity, right credential helper ----
url=$(git -C "$REPO" remote get-url origin 2>/dev/null) || fail "not a git repo: $REPO"
[[ "$url" == *"JonathanAgronica/marlin-app"* ]] || fail "wrong repo remote: $url"
[[ "$REPO" != *fishing-site* && "$url" != *fishing-apps* ]] || fail "refusing to touch fishing-apps"
GH=$(command -v gh || true); [ -n "$GH" ] || fail "gh not found"
git -C "$REPO" config user.name JonathanAgronica
git -C "$REPO" config user.email JonathanAgronica@users.noreply.github.com
git -C "$REPO" config --replace-all credential.https://github.com.helper "!$GH auth git-credential"
[ -z "$(git -C "$REPO" status --porcelain -- data)" ] || fail "uncommitted changes in data/ (left alone)"

GIT pull -q --rebase >>"$LOG" 2>&1 || fail "git pull --rebase failed (see $LOG)"

# ---- fetch (per-request 60 s x2 tries, whole fetch killed at the deadline minus push time) ----
budget=$(( $(left) - 40 )); [ $budget -gt 60 ] || fail "no time left"
( cd "$REPO" && MARLIN_HTTP_TIMEOUT=60 MARLIN_HTTP_TRIES=2 timeout -k 5 "$budget" python3 scripts/fetch_ocean.py ) >"$LOG" 2>&1
rc=$?; [ $rc -eq 124 ] || [ $rc -eq 137 ] && fail "fetch timed out after ${budget}s (last good data kept)"
[ $rc -eq 0 ] || fail "fetch script error rc=$rc: $(tail -1 "$LOG" | cut -c1-120) (last good data kept)"

summary=$(python3 - "$REPO/data/ocean.json" <<'PY'
import json,sys,datetime as d
m=json.load(open(sys.argv[1]))['meta'];now=d.datetime.now(d.timezone.utc);out=[];bad=0
for k in ('sst','cur','chl'):
  s=m['sources'].get(k)
  if not s: out.append(k+'=none');bad+=1;continue
  t=d.datetime.fromisoformat(s['time'].replace('Z','+00:00'));t=t if t.tzinfo else t.replace(tzinfo=d.timezone.utc)
  out.append(f"{k}={(now-t).total_seconds()/86400:.1f}d"+('(stale-kept)' if s.get('stale') else ''))
  bad+= k in m['errors']
print(('ALLFAIL ' if bad==3 else '')+' '.join(out)+(' errors='+','.join(m['errors']) if m['errors'] else ''))
PY
) || fail "could not read data/ocean.json"
[[ "$summary" == ALLFAIL* ]] && { GIT checkout -q -- data; fail "all sources failed: ${summary#ALLFAIL } (last good data kept)"; }

# ---- commit + push only if changed ----
GIT add data/ocean.json data/bathy.json data/depth_grid.json
if GIT diff --cached --quiet; then date +%s >"$LAST"; echo "REFRESHED $summary (no change)"; exit 0; fi
GIT commit -q -m "ocean data: $(date -u +%Y-%m-%dT%H:%MZ) (box refresh)" >>"$LOG" 2>&1 || fail "git commit failed"
if ! GIT push -q >>"$LOG" 2>&1; then
  GIT pull -q --rebase >>"$LOG" 2>&1 && GIT push -q >>"$LOG" 2>&1 || fail "git push failed (commit kept locally, will retry next run)"
fi
date +%s >"$LAST"; echo "REFRESHED $summary"; exit 0
