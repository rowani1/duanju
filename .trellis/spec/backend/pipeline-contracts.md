# Pipeline Contracts

> Executable contracts for the generation pipeline (stage executor, handoff protocol, resume semantics).

---

## Scenario: Adding or modifying a generation stage

### 1. Scope / Trigger

Any change to `src/stages/*`, `src/core/pipeline.ts`, artifact formats, or the handoff protocol. These are cross-layer contracts consumed by commands, tests, and downstream stages.

### 2. Signatures

```ts
// core/pipeline.ts
runStage(stage: StageDef, ctx: StageContext): Promise<StageResult>
// StageDef (declarative, in stages/*):
//   id, outputFile, knowledgeFiles(mainCategory): string[],
//   rolePrompt (static: work principles + hard limits from SKILL.md),
//   outputTemplate (markdown skeleton + required sections + handoff block requirement),
//   buildUserPrompt(ctx), requiredSections: string[],
//   extraValidate?(text) -> hard retry, warnValidate?(text) -> StageResult.warnings,
//   parseHandoff?: boolean
// streaming path: runStage(..., { onDelta })  — chapter prose only
```

### 3. Contracts

- **System prompt is three fixed segments**: [1] role + hard limits (static, distilled from bundled SKILL.md), [2] knowledge file contents (selected per main category), [3] output template + handoff block requirement.
- **Handoff block**: model must append `<!-- handoff\nkey: value\n-->`; parser tolerates full-width colons and code fences. Nine fields total, collected across packaging steps: 01 → 主类/子类; 02 → 一句话选题/核心卖点/最强反转; 03 → 女主身份/男主身份/核心关系/核心冲突. Parsed fields merge into `duanju.json`; downstream stages read structured fields, never re-parse markdown.
- **Main-category file mapping**: 总裁→zongcai, 古言→guyan, 女频现实情感→female-realistic, 年代/穿越→niandai (single source: `core/knowledge.ts`).
- **Context budget for chapter writing**: persona pack + current chapter outline row + character snapshot + previous chapter tail 500 chars. NEVER the full previous text (token guard, asserted by integration tests).

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Required section missing | 1 feedback-augmented retry → still missing → `StageValidationError`, nothing written |
| Outline chapters 0 or > 30 | hard fail (retry path) |
| Outline chapters < 10 or > 20 | warning only |
| Chapter length < 1000 chars | hard retry |
| Chapter length outside target ±15% | warning; interactive ask (accept/rewrite) or auto-accept with `--yes` |
| Handoff fields missing at title/write entry | `CliError` telling user which command to run first — never guess |

### 5. Good/Base/Bad Cases

- **Good**: stage declares knowledge deps; pipeline injects per main category; artifact lands only after validation; handoff merged; resume skips it next run.
- **Base**: model omits one section → retry with explicit feedback → passes → lands.
- **Bad (forbidden)**: writing artifact before validation; stage doing fs/console; command hardcoding artifact filename; handoff guessed when fields missing.

### 6. Tests Required

- Unit: required-section validator, handoff parser (normal / missing keys / no block / full-width colon), knowledge existence matrix (all stages × 4 categories), outline chapter-count boundaries.
- Integration (scripted mock): full 7-step package run (assert knowledge injection in prompts + artifact set + handoff completeness), resume with pre-existing artifacts (call count drops), validation-failure retry, chapter-2 context assertions (tail-500 included, full text excluded), `run --auto` end-to-end + mid-failure scene preservation + rerun-resume with zero extra model calls.

### 7. Wrong vs Correct

#### Wrong

```ts
// stage writes its own file and re-reads packaging markdown downstream
const handoff = parseMarkdownAgain(readFileSync("02-题材包.md", "utf8"));
writeFileSync(out, text); // before validation
```

#### Correct

```ts
// stage stays declarative; pipeline validates then persists; downstream reads duanju.json
const result = await runStage(titleStage, ctx);   // throws before any write on failure
const { handoff } = readProject(dir);              // nine structured fields
```

---

## Design Decision: deterministic staged pipeline (no agent loop)

**Context**: three model vendors (OpenAI/Claude/Gemini + openai-compatible) must produce consistent results.

**Options**: single mega-call per phase / agent tool-calling loop / deterministic staged pipeline.

**Decision**: deterministic staged pipeline — per-stage knowledge injection keeps token use bounded, behavior testable with scripted mocks, and avoids dependence on vendor tool-calling reliability. Trade-off: package phase costs 7 calls (accepted for quality; risk self-check with auto-revision proved effective in real-model smoke).
