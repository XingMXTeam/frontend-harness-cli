#!/usr/bin/env bash
# Replays the notice-list feature through the harness kernel in a scratch
# copy — every transition below is a real kernel command on real files:
#
#   cycle 1  clarify-done (coverage gate) -> 3 x task-done (task checks run)
#            -> evaluator evidence: RB-6 (essential judge) = 0, titles clip
#            -> eval: FAIL (veto), one refinement suggestion -> route: replan
#   replan   planner accepts RS-1, sharpens RB-6 -> replan-done (rubric may only tighten)
#   fix      developer makes titles wrap -> remediate-done
#   cycle 2  fresh evaluator evidence -> eval: PASS #1 -> route: confirm
#            fresh evidence again -> eval: PASS #2 + delivery gate -> done
#
# Usage: bash examples/notice-list/run.sh [--record]   (--record rewrites trajectory/)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="node $HERE/../../bin/harness.js"
WORK=$(mktemp -d)
cp -R "$HERE/." "$WORK/"
rm -rf "$WORK/trajectory" "$WORK/run.sh"
cd "$WORK"
F=notice-list
FD=.harness/tasks/$F
AUTHORED=$(mktemp -d)

# The kernel creates the feature; the planner's authored contract replaces the scaffold.
cp -R "$FD/." "$AUTHORED/" && rm -rf "$FD"
$HARNESS new $F --title "Notice list" >/dev/null
cp -R "$AUTHORED/." "$FD/" && rm -rf "$AUTHORED"
$HARNESS init --stack node --host generic >/dev/null   # standards + docs; the example's config is kept

# The developer's first version of the styles (titles on one line).
cp src/notice-list.css /tmp/notice-list.final.$$.css
cp replay/cycle1/notice-list.css src/notice-list.css

evaluator() { # $1 = cycle dir: render the states the evidence cites, then write fresh evidence
  sleep 0.05
  node scripts/snapshot.mjs "$FD/evaluation" >/dev/null
  cp "replay/$1"/judge-*.json "replay/$1"/eval-*.md "$FD/evaluation/"
}

echo "== [planner] lock the contract";            $HARNESS clarify-done $F
echo "== [developer] three tasks";                 for t in TASK-1 TASK-2 TASK-3; do $HARNESS task-done $F $t; done
echo "== [evaluator] cycle 1 -> [orchestrator] eval"; evaluator cycle1; $HARNESS eval $F || true
echo "== next: $($HARNESS next $F --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).action))")"

echo "== [planner] replan: accept RS-1, sharpen RB-6"
node -e "
  const fs=require('fs'); const p='$FD/rubric.json'; const r=JSON.parse(fs.readFileSync(p,'utf8'));
  r.items.find(i=>i.id==='RB-6').description='list density and hierarchy match REF-1: one row per notice, bold title + dot when unread, muted right-aligned time, 12px rhythm; at 375px and 1280px no .notice__title has scrollWidth > clientWidth';
  fs.writeFileSync(p, JSON.stringify(r,null,2)+'\n');"
cp replay/replan-decisions.json "$FD/replan-decisions.json"
$HARNESS replan-done $F

echo "== [developer] fix: titles wrap";            cp /tmp/notice-list.final.$$.css src/notice-list.css && rm /tmp/notice-list.final.$$.css
$HARNESS remediate-done $F

echo "== [evaluator] cycle 2 -> eval";             evaluator cycle2; $HARNESS eval $F
echo "== [evaluator, fresh context] confirm -> eval"; evaluator cycle2; $HARNESS eval $F
echo
$HARNESS report $F

if [ "${1:-}" = "--record" ]; then
  OUT="$HERE/trajectory"
  rm -rf "$OUT" && mkdir -p "$OUT/evaluation"
  node -e "
    const fs=require('fs');
    const scrub=(o)=>JSON.parse(JSON.stringify(o,(k,v)=>['at','createdAt','updatedAt','decidedAt','remediationFixedAt'].includes(k)&&v!==null?'<time>':v));
    fs.writeFileSync('$OUT/state.json', JSON.stringify(scrub(JSON.parse(fs.readFileSync('$FD/state.json','utf8'))),null,2)+'\n');
    const reports=fs.readdirSync('$FD/evaluation').filter(f=>/^report-\d+\.json$/.test(f)).sort();
    reports.forEach((f,i)=>fs.writeFileSync('$OUT/evaluation/report-'+(i+1)+'.json', JSON.stringify(scrub(JSON.parse(fs.readFileSync('$FD/evaluation/'+f,'utf8'))),null,2)+'\n'));
    fs.copyFileSync('$FD/failure-log.md','$OUT/failure-log.md');
  "
  sed -E -i 's/^- [0-9TZ:.-]+ /- <time> /' "$OUT/failure-log.md"
  $HARNESS report $F | sed -E 's/^- [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z /- /; s/^- [A-Z][a-z]{2} .*(AM|PM) [A-Z]+ \(UTC[^)]*\) /- /' > "$OUT/report.md"
  echo "recorded -> $OUT"
fi
echo "== notice-list example OK: phase=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$FD/state.json','utf8')).phase)") in $WORK"
