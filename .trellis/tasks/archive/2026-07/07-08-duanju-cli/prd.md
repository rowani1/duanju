# duanju CLI - 短剧向短故事生成命令行工具

## Goal

基于 `duanju-female-novel-packaging`（选题包装）、`duanju-title-forging`（书名锻造）、`duanju-female-story-writing`（正文创作）三个 skill 的方法论，构建一个**独立发布的 npm CLI**：任何人无需 Claude Code 环境，配置 OpenAI / Claude / Gemini 任一模型即可完成"选题包装 → 书名 → 逐章正文 → 投稿导出"的短剧向女频短故事创作全流程。

目标篇幅遵循 skill 默认：总篇幅 1.5万-3万字，单章 2000-4000 字，覆盖总裁/古言/女频现实情感/年代穿越四大主类。

## Requirements

### 功能需求

1. **多模型支持**：`openai` / `anthropic` / `google` / `openai-compatible`（自定义 baseURL，兼容 DeepSeek/Kimi/中转站）四类 provider，统一走 Vercel AI SDK。
2. **知识库内嵌**：三个 skill 的 SKILL.md + references 共 42 个文件（v1.1）作为资源随 npm 包分发，开箱即用。
3. **v1 命令集**：
   - `duanju config` — 交互式配置 provider/model/apiKey/baseURL，保存前发测试消息验证连通
   - `duanju new "<题材一句话>"` — 创建项目目录 + duanju.json
   - `duanju package` — 生成六包（题材归类/题材包/人设包/标题简介包/开篇包/章纲包）+ 风险自检
   - `duanju title` — 生成 20 个书名候选（两梯队+理由），用户选定后回填
   - `duanju write [n]` — 逐章生成正文（流式输出）；带章号则重写指定章
   - `duanju revise <n> --mode <改写|扩写|润色|重写节奏> [--note "<要求>"]` — 修订指定章
   - `duanju export --merged|--chapters` — 导出整本/分章 txt（纯本地）
   - `duanju status` — 展示项目进度（纯本地）
   - `duanju run --auto "<题材>"` — 全自动串联全流程，跳过交互确认
4. **确定性分阶段管线**：每个 Stage 声明知识文件依赖，按主类动态选择注入；不依赖模型工具调用能力。
5. **交互确认**：分阶段模式下每个产物生成后提供 确认/重写/手改后继续 三选项；`--auto` 模式跳过。
6. **产物落盘即状态**：所有产物为 markdown 文件，项目目录即状态存储；中断后重跑自动从未完成步骤续传，`--force` 强制重做。
7. **skill 协议保真**（来自三个 skill 的硬性规则）：
   - 六包输出遵循 packaging SKILL.md 的固定模板
   - 阶段间传递九个交接字段（主类/子类/一句话选题/核心卖点/女主身份/男主身份/核心关系/核心冲突/最强反转）
   - write 前置章节连续性检查：上一章尾部 500 字进上下文
   - 角色状态快照：每章生成后按 character-state-tracker 模板更新
   - 字数预算声明：正文偏差超 ±15% 警告并询问
   - 风险自检环节：risk-checklist + bad-case-gallery 审查六包
   - 交接字段缺失时报错引导补跑，不猜测

### 非功能需求

- Windows / macOS / Linux 兼容（开发环境为 Windows，注意路径与编码处理，产物文件 UTF-8）
- CLI 界面语言为中文
- token 可控：write 阶段不携带全部前文正文，仅带人设包+本章章纲+状态快照+上章尾部
- 分发：npm 发布，支持 `npx duanju`；Node.js >= 20
- API key 不落入项目目录（仅存全局配置或环境变量），避免用户误传网盘/仓库泄露

### v1 明确不做

- AI 漫剧适配（`--manju`）
- 批量生产（`batch`）
- 自定义知识库覆盖（`--knowledge`）
- EPUB 导出、简繁转换、GUI

## Acceptance Criteria

- [ ] `duanju config` 可配置四类 provider，保存前连通性验证通过/失败提示明确
- [ ] mock 模型下 `new → package → title → write → export` 全流程集成测试通过
- [ ] `package` 产出六包 markdown，每包含 `<!-- handoff -->` 机器可读字段区块；缺失必需小节自动带错误反馈重试 1 次
- [ ] `title` 产出两梯队各 10 个候选且第一梯队带具体维度理由；选定后回填 04-标题简介包.md 与 duanju.json
- [ ] `write` 每章后更新 state/characters.md；第 2 章起上下文含上章尾部 500 字；字数偏差 >±15% 触发警告询问
- [ ] `revise` 四种模式可用，覆盖前自动生成 `.bak-<时间戳>` 备份
- [ ] 管线中断（模拟 API 失败）后重跑，从未完成步骤继续；`--force` 重做当前阶段
- [ ] 单元测试（知识加载器/handoff 解析/结构校验/字数统计/导出合并/进度推断）与 mock 集成测试全部通过
- [ ] `npm pack` 产物包含完整 knowledge/ 目录，README 含安装/配置/使用说明

## Notes

- 需求探索于 2026-07-08 会话中完成，五个关键决策（执行引擎/技术栈/知识库分发/命令形态/引擎架构）均由用户逐项确认。
- 技术设计见 `design.md`，执行计划见 `implement.md`。
