# duanju CLI 技术设计

> 设计于 2026-07-08 brainstorming 会话逐节呈现并获用户确认。
> 需求边界见 `prd.md`。

## 1. 技术选型

| 维度 | 选择 | 理由 |
|---|---|---|
| 语言/运行时 | TypeScript + Node.js >= 20 | npm 分发、npx 零安装门槛 |
| 多模型接入 | Vercel AI SDK（`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` + `@ai-sdk/google` + `@ai-sdk/openai-compatible`） | 三家官方级适配器 + openai-compatible 覆盖国产模型/中转站，零额外适配代码 |
| CLI 框架 | commander | 成熟、子命令模式标准 |
| 终端交互 | @clack/prompts | 交互向导体验好 |
| 测试 | vitest + AI SDK `MockLanguageModel` | mock 集成测试不花钱 |
| 引擎架构 | 确定性分阶段管线 | 行为确定、token 可控、跨模型一致，不依赖模型工具调用能力（用户在三方案对比后选定） |

## 2. 仓库结构

```
duanju-cli/                      # 即本项目 D:\IdeaProject\duanju
├─ package.json                  # bin: "duanju"
├─ knowledge/                    # 内嵌知识库（从三个 skill 拷贝，v1.1）
│  ├─ packaging/  SKILL.md + references/ (14 个文件)
│  ├─ title/      SKILL.md + references/ (10 个文件)
│  └─ writing/    SKILL.md + references/ (15 个文件)
├─ src/
│  ├─ index.ts                   # commander 入口，注册 9 个命令
│  ├─ commands/                  # config/new/package/title/write/revise/export/status/run
│  ├─ core/
│  │  ├─ llm.ts                  # Provider 工厂（读配置 → 返回 AI SDK model 实例）
│  │  ├─ knowledge.ts            # 知识文件加载器（按主类/阶段返回文件内容）
│  │  ├─ project.ts              # 项目状态：duanju.json 读写、产物存在性推断进度
│  │  └─ pipeline.ts             # Stage 执行器：组装上下文→调用→结构校验→落盘→失败重试
│  ├─ stages/                    # 声明式 Stage 定义（数据，不含流程逻辑）
│  │  ├─ packaging.ts            # 七个 package 步骤
│  │  ├─ title.ts
│  │  ├─ writing.ts              # 正文生成 + 状态快照更新
│  │  └─ revision.ts
│  └─ ui/                        # @clack/prompts 封装：确认/重写/手改循环、流式渲染
└─ tests/
   ├─ unit/                      # 纯函数单测
   └─ integration/               # MockLanguageModel 全管线
```

**职责边界**（单一职责）：
- `knowledge.ts` 只回答"这个 Stage 在这个主类下要读哪些文件"
- `pipeline.ts` 只负责"执行一个 Stage"的通用流程
- `stages/` 是纯声明数据：知识依赖清单 + 提示词模板 + 输出校验规则 + 产物路径
- 改提示词策略不动引擎；加新 Stage 不改 pipeline（开闭原则）

## 3. 用户侧项目目录（产物落盘 = 状态存储）

```
我的书/
├─ duanju.json          # 元数据：原始题材、主类/子类、handoff 字段、选定书名、模型覆盖配置
├─ 01-题材归类.md ~ 06-章纲包.md
├─ titles.md            # 20 个候选（两梯队+理由）
├─ chapters/001.md ...
├─ state/characters.md  # 角色状态快照
└─ exports/
```

进度推断规则：`status`/续传逻辑不依赖单独状态字段，直接由产物文件存在性 + duanju.json 记录推断（无状态漂移问题）。

## 4. 管线与数据流

### 4.1 package（7 次 LLM 调用，逐步累积上下文）

| 步骤 | 知识注入 | 输出 |
|---|---|---|
| ① 题材归类 | category-map.md | 01（确定主类 → 决定后续知识文件组）|
| ② 题材包 | `<主类>`-subtypes.md | 02 |
| ③ 人设包 | character-archetypes + relationship-conflict-matrix | 03 |
| ④ 标题简介包(初版) | title-and-blurb-patterns | 04 |
| ⑤ 开篇包 | opening-hook-patterns | 05 |
| ⑥ 章纲包 | outline-templates | 06 |
| ⑦ 风险自检 | risk-checklist + bad-case-gallery | 修订建议 → 回改对应包 |

交互模式下每包生成后：确认 / 重写 / 手改后继续。

### 4.2 title（1 次调用）

- 前置校验：从 duanju.json 读九个交接字段（缺失 → 报错引导补跑 package）
- 注入：naming-principles + title-structures + `<主类>`-title-patterns + keyword-bank + rejection-rules + title-ab-pairs
- 输出 titles.md → 用户选定 → 回填 04 与 duanju.json（skill 回填协议）

### 4.3 write（每章 2 次调用）

- 调用 A（`streamText` 流式）：正文
  - 注入：writing-principles + prose-style-guide + chapter-engine + `<主类>`-story-patterns + 人设包 + 本章章纲行 + state/characters.md + 上一章尾部 500 字
  - **不携带**前文全部正文（token 爆炸防线）
- 调用 B（`generateText`）：按 character-state-tracker 模板更新角色状态快照
- 后置校验：字数偏差 >±15% → 警告并询问 接受/重写

### 4.4 revise / export / status

- revise：注入 revision-modes.md + 原章 + 用户 `--note`；覆盖前备份 `.bak-<时间戳>`
- export / status：纯本地文件操作，不调 AI

## 5. 上下文组装规约

每个 Stage 的 system prompt 固定三段式：

```
[段1] 角色设定：该阶段工作原则 + 硬限制（从 SKILL.md 提炼的静态模板，随包内置）
[段2] 知识注入：Stage 声明的知识文件原文（按主类动态选择）
[段3] 输出规约：markdown 输出模板 + 尾部 handoff 区块要求
```

**handoff 机器可读化**：每包文末要求模型输出 `<!-- handoff -->` 注释包裹的 yaml 区块，程序解析后写入 duanju.json——后续阶段直接读结构化字段，不重复解析长文（DRY）。

## 6. 配置体系

```
优先级：命令行参数 > 项目 duanju.json > 全局 ~/.duanju/config.json > 环境变量
```

```jsonc
// ~/.duanju/config.json
{
  "provider": "anthropic",     // openai | anthropic | google | openai-compatible
  "model": "claude-sonnet-4-6",
  "apiKey": "sk-...",           // 留空则回落环境变量
  "baseURL": ""                 // openai-compatible 必填
}
```

`duanju config` 向导：选厂商 → 填 key → 选/填模型 → 测试消息验证连通 → 保存。API key 只存全局配置或环境变量，绝不写入项目目录。

## 7. 错误处理

| 场景 | 策略 |
|---|---|
| API 超时/限流 | AI SDK `maxRetries: 2` 指数退避；最终失败保留已完成步骤退出 |
| 输出缺必需小节 | markdown 结构校验（必需标题存在性），失败带错误反馈自动重试 1 次，再失败提示用户 |
| 字数偏差 >±15% | 警告 + 询问接受/重写 |
| 交接字段缺失 | 前置校验直接报错，提示补跑哪个命令 |
| 中断（Ctrl+C/断网） | 产物按步骤粒度落盘，重跑续传；`--force` 重做 |
| revise 覆盖 | 自动备份 `.bak-<时间戳>` |

## 8. 测试策略

- **单元**（vitest）：knowledge 按主类选文件、handoff 解析、结构校验、字数统计、export 合并、进度推断
- **集成**：`MockLanguageModel` 跑 `new → package → title → write → export` 全管线
- **不做**真实 API e2e（费钱且输出不可断言）；发布前人工冒烟一次

## 9. 权衡记录

- **分步调用 vs 单次出六包**：选分步。质量优先（单次长输出后段质量塌陷、自检形同虚设），代价是 package 阶段 7 次调用。
- **markdown vs JSON 产物**：选 markdown（长中文创作内容 JSON 转义不友好、用户可直接手改），机器可读需求用 handoff 区块补齐。
- **Agent 工具调用式**：否决。三家模型工具调用稳定性参差，行为不确定、成本不可预估。
