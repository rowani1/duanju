# Error Handling

> How errors are handled in this project.

---

## Overview

Two error families, one top-level catch in `src/index.ts`. All user-facing messages are Chinese and must include a next-step suggestion.

## Error Types

| Type | Class | Meaning | Exit |
|---|---|---|---|
| Known business error | `CliError` (`src/core/errors.ts`) | Expected user-level failure (missing artifact, invalid mode, bad config) | 1 |
| Stage validation failure | `StageValidationError extends CliError` (`src/core/pipeline.ts`) | Model output failed structural validation after 1 feedback retry | 1 |
| Model/API failure | `AISDKError` (from `ai`) | Timeout, 4xx/5xx, rate limit | 1 |
| Unexpected | anything else | Bugs | 1 |

## Error Handling Patterns

Top-level catch (three branches) in `src/index.ts`:

```ts
if (err instanceof CliError)            // → "出错了：<message>"（message 自带下一步建议）
else if (AISDKError.isInstance(err))    // → "模型调用失败" + 4 项排查建议 + 续传提示
else                                    // → "意外错误：<name: message>" + 反馈提示
```

Rules:

1. **Throw `CliError` for anything the user can fix**; the message must state what to do next (e.g. `请先运行 duanju package 生成六包`).
2. **Never write invalid content to disk.** If stage output fails validation, nothing lands (resume logic treats artifact existence as completion — a half-written artifact would poison resume).
3. **Retry policy**: transport retries are AI SDK `maxRetries: 2`; structural validation gets exactly 1 feedback-augmented retry inside `runStage`, then throws.
4. **Interrupted runs are recoverable by design** — artifacts persist per step; commands skip existing artifacts; `--force` redoes.

## API Error Responses

Not applicable (CLI, no server). The CLI equivalent: every failure path prints Chinese guidance and exits non-zero; `run --auto` prints completed progress + resume hint before exiting.

## Common Mistakes

- **Throwing bare `Error` for user-level failures** → renders as "意外错误", loses the guidance line. Use `CliError`.
- **Printing errors inside `core/`** — core throws, commands/entry print.
- **Writing artifacts before validation passes** — breaks resume semantics (see rule 2).
