#!/usr/bin/env bash
# End-to-end demo: a fresh project, one feature, driven from clarify to done
# purely by CLI state — including one deliberate interruption (we stop after
# the task and "resume" in a new shell invocation, which is the whole point).
set -euo pipefail

HARNESS="node $(cd "$(dirname "$0")/.." && pwd)/bin/harness.js"
WORK=$(mktemp -d)
cd "$WORK"
echo "== demo project: $WORK"

$HARNESS init --stack node --host generic >/dev/null
# Demo moves fast: one stable pass is enough here (default is 2).
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('harness.config.json')
c = json.loads(p.read_text())
c['autoStop'] = {'requiredStablePasses': 1}
c['gateCommands'] = ['node -e "process.exit(0)"']
p.write_text(json.dumps(c, indent=2))
PY

$HARNESS new hello --title "Hello feature" >/dev/null
python3 - <<'PY'
import json, pathlib
d = pathlib.Path('.harness/tasks/hello')
d.joinpath('tasks.json').write_text(json.dumps([
  {"id": "TASK-1", "title": "write greeting module",
   "requirements": ["REQ-1"],
   "checks": ["node -e \"require('fs').writeFileSync('greet.js', 'export const greet = (n) => \\'hello \\' + n; // real implementation, fully working')\""]}
], indent=2))
d.joinpath('rubric.json').write_text(json.dumps({
  "version": 1, "feature": "hello",
  "requirements": [{"id": "REQ-1", "description": "greet.js exports a working greet function"}],
  "items": [
    {"id": "RB-1", "requirement": "REQ-1", "level": "essential", "kind": "grep", "path": "greet.js", "pattern": "export const greet", "expect": "present", "weight": 3},
    {"id": "RB-2", "requirement": "REQ-1", "level": "essential", "kind": "command", "command": "node -e \"import('./greet.js').then(m => { if (m.greet('world') !== 'hello world') process.exit(1) })\"", "weight": 3},
    {"id": "RB-3", "requirement": "REQ-1", "level": "pitfall", "kind": "grep", "path": "greet.js", "pattern": "TODO|FIXME", "expect": "absent", "weight": 1}
  ]
}, indent=2))
PY

$HARNESS clarify-done hello
$HARNESS next hello
$HARNESS task-done hello TASK-1

echo
echo "== INTERRUPTION: imagine the agent process dies here. New invocation resumes from state alone:"
$HARNESS next hello
$HARNESS eval hello
echo
$HARNESS report hello
echo
echo "== demo OK: phase reached 'done' in $WORK"
