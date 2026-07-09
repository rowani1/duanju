# Journal - mxd (Part 1)

> AI development session journal
> Started: 2026-07-08

---



## Session 1: duanju CLI 从设计到发布 v0.1.1

**Date**: 2026-07-09
**Task**: duanju CLI 从设计到发布 v0.1.1
**Branch**: `master`

### Summary

基于 duanju-female-novel-packaging / duanju-title-forging / duanju-female-story-writing 三个 skill 完成 duanju-cli 全周期交付：brainstorming 五项决策（多模型独立发布/TS技术栈/知识库内嵌/分阶段命令/确定性管线）→ Trellis 规划三产物 → M0-M8 子代理分批实施与检查（156 测试全绿）→ 真实模型冒烟通过（GLM 5.2，六包+风险自检回改+书名+2章正文）→ 后端 spec 沉淀四篇 → npm 发布 duanju-cli@0.1.1（0.1.0 因误标 MIT 已撤）→ GitHub rowani1/duanju 推送 + v0.1.0/v0.1.1 双 tag → 自定义非商业许可（保护知识库、豁免用户生成内容）

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a194dd2` | (see git log) |
| `0fda69f` | (see git log) |
| `c121080` | (see git log) |
| `c9e0aa6` | (see git log) |
| `0294bf7` | (see git log) |
| `4cf558b` | (see git log) |
| `75c66db` | (see git log) |
| `9e79614` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 自定义知识库覆盖功能 v0.2.0

**Date**: 2026-07-09
**Task**: 自定义知识库覆盖功能 v0.2.0
**Branch**: `master`

### Summary

为 duanju-cli 新增自定义知识库按文件覆盖功能：loadKnowledgeEx 回落解析 + resolveKnowledgePath 三级配置链（CLI --knowledge > 项目 duanju.json > 全局配置，全局必须绝对路径）+ 五命令接入 + config 向导可选步骤 + README 新章节。176 测试全绿（既有 156 零改动）。主会话冒烟抓到 title 续传分支静默跳过路径校验的缺陷，TDD 修复并沉淀为 spec 规约（入口前置校验）。发布 duanju-cli@0.2.0 + GitHub v0.2.0 tag。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9469dcf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
