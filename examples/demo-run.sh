#!/usr/bin/env bash
# Unattended-run demo: a clarified feature driven to done by `harness run`
# with a stand-in host agent (test/fixtures/fake-agent.mjs) — no human in
# the loop. The driver is stopped once mid-run (max-steps) and restarted;
# the kernel's state files, not the driver, decide where work resumes.
# With a real agent: harness run <feature> --agent claude-code (or codex).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
HARNESS="node $ROOT/bin/harness.js"
WORK=$(mktemp -d)
cd "$WORK"
export HARNESS_BIN="$ROOT/bin/harness.js"
echo "== demo project: $WORK"

$HARNESS init --stack node --host generic >/dev/null
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('harness.config.json')
c = json.loads(p.read_text())
c['autoStop'] = {'requiredStablePasses': 1}
c['gateCommands'] = ['node -e "process.exit(0)"']
p.write_text(json.dumps(c, indent=2))

d = pathlib.Path('.harness/tasks/hello')
PY
$HARNESS new hello --title "Hello feature" >/dev/null
python3 - <<'PY'
import json, pathlib
d = pathlib.Path('.harness/tasks/hello')
d.joinpath('vision.md').write_text(
  "REF-1: a module whose export does exactly what its name promises.\n"
  "ANTI-1: a stub that returns the right string for one input only.\n"
  "RL-1: greet must be a real function, not a lookup. (check: command)\n"
  "RL-2: no TODO or placeholder text ships. (check: command)\n")
d.joinpath('tasks.json').write_text(json.dumps([
  {"id": "TASK-1", "title": "write greeting module",
   "requirements": ["REQ-1"],
   "checks": ["node -e \"require('fs').writeFileSync('greet.js', 'export const greet = (n) => \\\\'hello \\\\' + n; // real implementation, fully working')\""]}
], indent=2))
d.joinpath('rubric.json').write_text(json.dumps({
  "version": 1, "feature": "hello",
  "requirements": [{"id": "REQ-1", "description": "greet.js exports a working greet function"}],
  "qualityWaivers": [{"requirement": "REQ-1", "reason": "demo feature is a pure function; deterministic checks carry the quality bar"}],
  "items": [
    {"id": "RB-1", "requirement": "REQ-1", "level": "essential", "kind": "grep", "path": "greet.js", "pattern": "export const greet", "expect": "present", "weight": 3},
    {"id": "RB-2", "requirement": "REQ-1", "level": "essential", "kind": "command", "command": "node -e \"import('./greet.js').then(m => { if (m.greet('world') !== 'hello world') process.exit(1) })\"", "weight": 3},
    {"id": "RB-3", "requirement": "REQ-1", "level": "pitfall", "kind": "grep", "path": "greet.js", "pattern": "TODO|FIXME", "expect": "absent", "weight": 1}
  ]
}, indent=2))
PY
$HARNESS clarify-done hello >/dev/null
echo "== clarified. Driving unattended now (stand-in agent; use --agent claude-code for a real one):"

echo "-- first drive: deliberately capped at 0 agent steps"
$HARNESS run hello --agent-cmd "node $ROOT/test/fixtures/fake-agent.mjs {prompt}" --max-steps 0 || true
echo "-- second drive: no cap — runs to done on its own"
$HARNESS run hello --agent-cmd "node $ROOT/test/fixtures/fake-agent.mjs {prompt}"
echo
$HARNESS report hello
echo
echo "== demo-run OK: unattended run reached 'done' in $WORK"
