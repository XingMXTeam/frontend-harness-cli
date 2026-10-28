#!/usr/bin/env bash
# harness-cli session-start hook (Claude Code).
# Injects the orchestrator rules + the active harness feature and its next
# action into the session, so a long-running workflow resumes from files,
# not from chat memory.
set -euo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
TASKS_DIR="$ROOT/.harness/tasks"

if [ ! -d "$TASKS_DIR" ]; then
  exit 0
fi

# Collect features that are not done.
ACTIVE=()
for d in "$TASKS_DIR"/*/; do
  [ -f "${d}state.json" ] || continue
  phase=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('${d}state.json','utf8')).phase)}catch{console.log('?')}" 2>/dev/null || echo "?")
  if [ "$phase" != "done" ]; then
    ACTIVE+=("$(basename "$d"):$phase")
  fi
done

if [ "${#ACTIVE[@]}" -eq 0 ]; then
  exit 0
fi

if [ "${#ACTIVE[@]}" -eq 1 ]; then
  FEATURE="${ACTIVE[0]%%:*}"
  HINT="Active feature: '${FEATURE}' (${ACTIVE[0]#*:}). Your first action must be: harness next ${FEATURE} — then follow the action it returns."
else
  LIST=$(printf '%s ' "${ACTIVE[@]}")
  HINT="Multiple active features: ${LIST}. Ask the user which one to continue, then run: harness next <feature>."
fi

read -r -d '' RULES <<'EOF' || true
You are the ORCHESTRATOR of a frontend-harness-cli workflow. These rules hold unless the user explicitly tells you to bypass the workflow.

1. Route, do not do. Each action belongs to one role agent (.claude/agents/): clarify and replan -> planner; implement-task and remediate -> developer; evaluate and confirm-evaluation -> evaluator (a fresh context every time). Give the agent `harness packet <feature>` as its input. You never write product code, plans, rubrics or judge evidence yourself, and you never take over a role whose agent failed: retry once, then report the blocker.
2. You never decide for the user. Relay the planner's clarification questions verbatim and the user's answers verbatim. "Treat as resolved", "assume", "use the default" in a dispatch is deciding for the user.
3. Verdict -> next step is fixed (harness routes): pass + more stable passes needed -> confirm-evaluation (evaluator, fresh); pass + stable + gate green -> done, report; pass + gate red -> remediate; fail + refinement suggestions -> replan then remediate; fail -> remediate; budget exhausted -> paused, ask the user.
4. Never stop at a summary. After every verdict, dispatch the next action in the same turn. The only stops are: phase done, phase paused, a clarification question waiting on the user, or a blocker you name.
5. State lives in .harness/tasks/<feature>/state.json and changes only through harness commands. Only phase "done" means done.
EOF

CONTEXT="${RULES}

${HINT}"

ESCAPED=$(printf '%s' "$CONTEXT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(s)))")
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": %s\n  }\n}\n' "$ESCAPED"
