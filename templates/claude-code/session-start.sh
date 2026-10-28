#!/usr/bin/env bash
# harness-cli session-start hook (Claude Code).
# Injects the active harness feature + its next action into the session so a
# long-running workflow resumes from files, not from chat memory.
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
  HINT="Harness: one active feature '${FEATURE}' (${ACTIVE[0]#*:}). Your first action must be: harness next ${FEATURE} — follow the action it returns."
else
  LIST=$(printf '%s ' "${ACTIVE[@]}")
  HINT="Harness: multiple active features: ${LIST}. Ask the user which one to continue, then run: harness next <feature>."
fi

ESCAPED=$(printf '%s' "$HINT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(s)))")
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": %s\n  }\n}\n' "$ESCAPED"
