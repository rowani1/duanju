# 自定义知识库覆盖 技术设计

> 2026-07-09 brainstorming 确认，方案 A（解析函数注入式）。需求见 `prd.md`。

## 1. 改动面总览

| 文件 | 改动 |
|---|---|
| `src/core/knowledge.ts` | `loadKnowledge(files, customRoot?)`：逐文件回落解析；返回值改为 `{ content, customHits: string[] }`（或新增并行函数，以最小破坏为准） |
| `src/core/llm.ts`（或新增 `core/config.ts`，若配置逻辑已聚集在 llm.ts 则就地扩展） | 配置合并链加入 `knowledgePath`：CLI 参数 > 项目 duanju.json > 全局 config；解析相对路径基准（CLI→cwd，项目→项目目录，全局→必须绝对）；存在性校验 + CliError（含来源标注） |
| `src/commands/{package,title,write,revise,run}.ts` | 注册 `--knowledge <path>`；解析 customRoot 后传入各 runStage 调用；命中提示打印 |
| `src/commands/config.ts` | 向导追加可选"自定义知识库路径"步骤 |
| `src/index.ts` | 五命令选项注册 |
| README.md | 新章节；package.json version 0.2.0 |

## 2. 核心解析逻辑（`knowledge.ts`）

```ts
export interface KnowledgeResult { content: string; customHits: string[] }

export function loadKnowledge(files: string[], customRoot?: string): KnowledgeResult {
  // 对每个 rel：
  //   customRoot && exists(customRoot/rel) → 读自定义（空内容→收集警告，照用）
  //   否则 → 读内置 knowledgeRoot()/rel（不存在 → 既有 CliError）
  // customHits 收集命中自定义的 rel 列表
}
```

- 调用方（pipeline.ts 的 runStage 组装段2 时）透传 customRoot——`StageContext` 增加可选字段 `customKnowledgeRoot`
- pipeline 不感知配置来源，只接收解析好的绝对路径（依赖方向不变：stages/pipeline 不读配置）

## 3. 配置解析规则

```
resolveKnowledgePath({ cliArg?, projectDir }): string | undefined
  1. cliArg 存在 → path.resolve(cwd, cliArg)
  2. duanju.json.knowledgePath 存在 → path.resolve(projectDir, value)
  3. 全局 config.knowledgePath 存在 → path.isAbsolute ? value : CliError("全局配置中的 knowledgePath 必须为绝对路径…")
  命中后统一校验目录存在，否则 CliError（消息含解析后完整路径 + 配置来源："命令行参数 / 项目配置 / 全局配置"）
  未配置 → undefined（行为与 v0.1.1 完全一致）
```

## 4. 透明提示

命中 customHits 非空时，命令层在该次生成前打印一次：

```
使用自定义知识文件：title/references/keyword-bank.md、writing/references/prose-style-guide.md（共 2 个）
```

同一命令内多个 Stage 去重合并展示（收集后统一打印，避免每步重复刷屏）。

## 5. 错误与边界矩阵

| 条件 | 行为 |
|---|---|
| knowledgePath 目录不存在 | CliError：`自定义知识库目录不存在：<完整路径>（来源：<配置来源>）…` |
| 全局配置相对路径 | CliError 提示改为绝对路径 |
| 自定义文件为空 | 警告 `自定义知识文件为空：<rel>，将按空内容注入` 后照用 |
| 自定义目录多余文件 | 忽略，不提示 |
| 未配置 | 与 v0.1.1 行为逐字节一致（回归测试保证） |

## 6. 测试策略

- 单测（`tests/unit/knowledge.test.ts` 扩展 + config 解析测试）：回落矩阵、空文件警告、三级优先级、相对路径基准、全局绝对路径校验、目录不存在报错文案
- 集成：临时目录放一个自定义 keyword-bank.md → mock 跑 title → 断言 prompt 含自定义内容且不含内置该文件内容；未配置场景全量回归
- 既有 156 测试零改动通过（`loadKnowledge` 签名兼容：新增可选参数 + 返回值变化处同步既有调用点）

## 7. 权衡记录

- **返回值改造 vs 新函数**：优先改造现有 `loadKnowledge` 返回结构（调用点少、单一入口原则）；若实施中发现调用点耦合大，允许新增 `loadKnowledgeEx` 并让旧签名代理，以实施子代理现场判断为准，但最终只允许一个真实实现（DRY）。
- **提示打印位置**：命令层而非 pipeline（core 不做终端输出的既有铁律）。
