# Standards pack: Python

Replace this file with your project's real conventions during `harness init`
review. The planner and implementer must read it before writing code.

- Python >= 3.11, type hints on all public signatures, docstrings in the project's chosen style.
- No mutable default arguments, no bare `except:`, no string-concatenated SQL.
- Formatting/lint with the project's configured tool (ruff/black) must pass per task.
- Single function <= 200 lines; prefer early returns over deep nesting.
- Secrets come from configuration/environment only, never from literals.
