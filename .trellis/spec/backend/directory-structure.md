# Directory Structure

> How backend code is organized in this project.

---

## Overview

duanju-cli is a single-package TypeScript CLI (ESM, Node >= 20). The architecture is a four-layer pipeline with strict dependency direction:

```
commands → stages → core        (ui ← commands only)
```

- **`src/core/`** — engine primitives, business-agnostic: `llm.ts` (provider factory), `knowledge.ts` (knowledge file loader), `project.ts` (project state owner), `pipeline.ts` (stage executor), `errors.ts` (CliError)
- **`src/stages/`** — declarative stage definitions (pure data + prompt templates): `packaging.ts` (7 steps), `title.ts`, `writing.ts`, `revision.ts`
- **`src/commands/`** — CLI orchestration per command; user interaction and progress printing
- **`src/ui/`** — @clack/prompts wrappers (cancel handling)
- **`knowledge/`** — 42 bundled methodology files (3 SKILL.md + 39 references), shipped in the npm package

## Directory Layout

```
src/
├── index.ts        # commander entry; registers 9 commands; top-level catch
├── commands/       # config / new / package / title / write / revise / export / status / run
├── core/           # llm / knowledge / project / pipeline / errors
├── stages/         # packaging / title / writing / revision (declarative)
└── ui/             # prompts.ts (assertNotCancelled etc.)
tests/
├── unit/           # pure-function tests + guard tests
├── integration/    # scripted mock model, full-pipeline tests
└── helpers/        # scripted-model.ts (shared mock)
knowledge/          # packaging/ | writing/ | title/  (DO NOT EDIT — see quality-guidelines)
```

## Module Organization — Hard Rules

1. **`pipeline.ts` must NOT import from `stages/`** (dependency inversion: executor is generic, stages are data).
2. **`stages/` must NOT perform I/O** (no fs, no console, no @clack). Stages declare knowledge files, prompt templates, required sections, and validators.
3. **`commands/` must NOT touch `node:fs` directly.** All artifact/file access goes through `core/project.ts` (`readArtifact` / `writeArtifact` / `backupFile` / `listChapters`).
4. **@clack usage is confined to `commands/` + `ui/`**; core and stages must stay non-interactive.
5. **Artifact filename constants live in `core/project.ts`** (`PACKAGE_FILES`, `OUTLINE_FILE`, `TITLES_FILE`, `RISK_REPORT_FILE`...). Never hardcode artifact filenames in stages/commands — a past defect had `TITLES_FILE` defined in stages while core hardcoded the string (dependency direction inverted); guard tests now pin this.
6. **Reusable command flows are exported functions** (`runPackage` / `runTitle` / `runWrite` / `runExport`) so `run --auto` composes them instead of duplicating logic.

## Naming Conventions

- Files: lower-kebab or single word, `.ts`; tests mirror source name (`project.test.ts`).
- User-facing artifacts (Chinese, fixed): `01-题材归类.md` … `06-章纲包.md`, `07-风险自检.md`, `titles.md`, `chapters/001.md`, `state/characters.md`.
- Chapter numbers are 3-digit zero-padded (`001.md`).

## Examples

- Adding a new generation stage: declare it in `src/stages/`, reuse `runStage` from pipeline, register the command in `src/index.ts`. See `src/stages/revision.ts` for the smallest complete example.
