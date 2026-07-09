# duanju CLI 执行计划

> 依赖 `prd.md`（需求）与 `design.md`（技术设计）。按里程碑顺序执行，每个里程碑有独立验证命令。

## 前置说明

- 项目根 `D:\IdeaProject\duanju` 当前不是 git 仓库 → M0 中 `git init`
- 知识库源文件位于 `C:\Users\Rowan\.claude\skills\duanju-*`（v1.1，共 42 个 md）→ M0 拷贝入仓
- 全程 TDD：每个模块先写失败测试再实现（引擎层纯函数居多，适合 TDD；UI 交互层以集成测试覆盖）

## M0 脚手架与知识库入仓

- [ ] `git init` + `.gitignore`（node_modules/dist/.env 等）
- [ ] `package.json`（name/bin/files 含 knowledge/、engines >= 20、type: module）+ `tsconfig.json` + vitest 配置
- [ ] 目录骨架：`src/{commands,core,stages,ui}`、`tests/{unit,integration}`、`knowledge/`
- [ ] 拷贝三个 skill → `knowledge/{packaging,title,writing}/`（SKILL.md + references/）
- [ ] 校验脚本：knowledge 文件计数断言（14+10+15 + 3 个 SKILL.md = 42）

**验证**：`npm run build` 通过；`npx vitest run` 空跑通过；knowledge 计数断言通过

## M1 配置与 Provider 层

- [ ] `core/llm.ts`：配置读取（优先级：CLI 参数 > 项目 > 全局 `~/.duanju/config.json` > 环境变量）+ provider 工厂（四类 provider → AI SDK model 实例）
- [ ] `commands/config.ts`：@clack 向导（选厂商→key→模型→测试消息验证→保存全局配置）
- [ ] 单测：配置优先级合并、四类 provider 实例化参数正确

**验证**：`npx vitest run tests/unit/llm*`；手动 `duanju config`（可用真实 key 冒烟一次）

## M2 知识加载器与项目状态

- [ ] `core/knowledge.ts`：`load(stage, mainCategory)` → 返回该 Stage 声明的知识文件内容数组；主类 → 文件名映射（总裁/古言/女频现实情感/年代穿越 → zongcai/guyan/female-realistic/niandai）
- [ ] `core/project.ts`：duanju.json 读写、handoff 字段存取、产物存在性 → 进度推断、章节文件枚举
- [ ] `commands/new.ts` + `commands/status.ts`
- [ ] 单测：按主类选文件正确性、进度推断矩阵（空/半途/完成各状态）

**验证**：`npx vitest run tests/unit/{knowledge,project}*`；手动 `duanju new "测试题材" && duanju status`

## M3 管线执行器与 package 命令

- [ ] `core/pipeline.ts`：runStage(stage, ctx) = 组装三段式 system prompt → 调用 → markdown 结构校验 → 失败带反馈重试 1 次 → handoff 解析 → 落盘
- [ ] `stages/packaging.ts`：七步声明（知识依赖/提示词模板/必需小节/产物路径），模板含 SKILL.md 的硬限制与输出格式
- [ ] `commands/package.ts`：串联七步 + 逐包交互确认（确认/重写/手改后继续）+ 续传（跳过已存在产物）+ `--force`
- [ ] 单测：结构校验器、handoff 解析器；集成：MockLanguageModel 跑七步全流程 + 断点续传场景

**验证**：`npx vitest run`；手动真实模型跑一次 `duanju package` 检查六包质量 ⛩️ **Review Gate：六包产物人工审阅**

## M4 title 命令

- [ ] `stages/title.ts` + `commands/title.ts`：前置九字段校验 → 生成 titles.md → @clack 选定 → 回填 04 与 duanju.json
- [ ] 集成：mock 下候选生成/选定回填；缺字段报错引导

**验证**：`npx vitest run tests/integration/title*`；手动冒烟

## M5 write 命令

- [ ] `stages/writing.ts`：正文 Stage（连续性上下文组装：人设包+章纲行+状态快照+上章尾 500 字）+ 快照更新 Stage（character-state-tracker 模板）
- [ ] `commands/write.ts`：无参 = 下一未写章；`write <n>` = 重写指定章（备份）；streamText 流式渲染；字数 ±15% 校验询问
- [ ] 集成：mock 下连续两章生成（断言第 2 章上下文含上章尾部与快照）、字数警告触发

**验证**：`npx vitest run tests/integration/write*`；手动真实模型写 1-2 章 ⛩️ **Review Gate：正文质量人工审阅**

## M6 revise 与 export

- [ ] `stages/revision.ts` + `commands/revise.ts`：四模式 + `--note` + `.bak-<时间戳>` 备份
- [ ] `commands/export.ts`：`--merged`（书名+简介+全章合并 txt）/ `--chapters`（分章 txt），UTF-8
- [ ] 单测：export 合并；集成：revise 备份与替换

**验证**：`npx vitest run`；手动导出检查 txt 编码与格式

## M7 run --auto 全流程

- [ ] `commands/run.ts`：串联 new→package→title(自动选第一梯队第 1)→write 全部章→export，跳过交互；任一步失败保留现场退出
- [ ] 集成：mock 全流程端到端

**验证**：`npx vitest run tests/integration/auto*`

## M8 发布打磨

- [ ] README.md（安装/配置/命令/常见问题，中文）
- [ ] 错误信息统一走 ui 层（中文、含下一步建议）
- [ ] `npm pack` 验证产物含 knowledge/ 且体积合理
- [ ] 全量测试 + 真实模型完整冒烟一本（最短篇幅）⛩️ **Review Gate：发布前人工验收**

**验证**：`npx vitest run` 全绿；`npm pack --dry-run` 清单正确

## 回滚点

- 每个里程碑一个 git commit（M3/M5/M8 的 Review Gate 通过后才 commit）
- 管线运行时故障不涉及代码回滚：产物落盘续传机制兜底

## 明确的完成定义

`prd.md` 的 Acceptance Criteria 全部勾选 + M8 冒烟通过。
