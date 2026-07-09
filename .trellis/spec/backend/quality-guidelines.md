# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

TypeScript strict, ESM, Node >= 20. Gate = `npm run build` (tsc, zero errors) + `npx vitest run` (all green). No separate eslint; tsc strict is the linter.

---

## Forbidden Patterns

- **`any`** — strict mode, no exceptions shipped so far.
- **Hardcoded artifact filenames** outside `core/project.ts` constants (guard tests pin `PACKAGE_FILES` / `OUTLINE_FILE` / `TITLES_FILE`).
- **English user-facing text** — all CLI output, errors, prompts are Chinese.
- **String path concatenation** — always `node:path` (Windows-first project).
- **Editing `knowledge/`** — the 42 bundled files are verbatim copies of the source skills (v1.1). Any change may alter generation quality and breaks the fidelity contract. Count is pinned by a unit test (15 + 16 + 11 = 42 md files).
- **API keys anywhere in project dirs** — global `~/.duanju/config.json` or env vars only; config merge ignores apiKey from project-level `duanju.json`, and provider-switch must not inherit credentials from a different provider's config source.
- **Debug `console.log`** — user-facing progress output only.

---

## Required Patterns

- **TDD for core pure functions** (config merge, progress inference, outline parsing, sanitizers): red test first, then implement.
- **Stage knowledge-path existence tests**: every stage's declared knowledge files must be covered by the "all stages x 4 main categories" existence matrix in `tests/unit/knowledge.test.ts` — renamed pattern files must fail tests, not runtime.
- **Comment-block parsing goes through the shared parser** (`parseCommentBlock` in pipeline.ts) — handles full-width colons, fences; do not write ad-hoc regex per block type (`handoff` / `titles` / `revise` all reuse it).
- **UTF-8 without BOM** for all artifact writes.

---

## Testing Requirements

- **Unit**: pure functions + guard tests (knowledge count, artifact-name alignment, knowledge existence matrix).
- **Integration**: scripted mock model (`tests/helpers/scripted-model.ts`, AI SDK MockLanguageModel) drives full pipelines. Tests MUST assert prompt contents (knowledge injected, context carried, e.g. chapter 2 prompt contains chapter 1 tail but NOT full text), not just artifact existence. Scripted outputs are consumed in order; exhaustion throws — surfacing unexpected extra model calls.
- **No real-API tests in CI** — real-model smoke is a manual release gate.
- **Known Windows gotcha**: Node 24.13 on Windows `rmSync` silently no-ops on some Chinese-character paths (unlinkSync fine, ASCII-root recursive delete fine). Affected tests use workarounds; source code performs no deletions.

---

## Code Review Checklist

- [ ] Dependency directions intact (pipeline !-> stages; stages no I/O; commands no fs; clack only in commands/ui)
- [ ] New user-visible failure paths throw `CliError` with next-step guidance (Chinese)
- [ ] Validation failure never writes artifacts (resume-safety)
- [ ] New stage: knowledge existence test + required-sections validation + scripted integration test
- [ ] Reusable flow exported as function if `run --auto` needs it
- [ ] tsc build + vitest all green
