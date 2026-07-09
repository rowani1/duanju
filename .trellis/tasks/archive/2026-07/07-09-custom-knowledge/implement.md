# 自定义知识库覆盖 执行计划

> 依赖 `prd.md` 与 `design.md`。单批次实施（功能面小），TDD。

## 前置

- 基线：v0.1.1（master，156 测试全绿）
- 相关 spec：`.trellis/spec/backend/`（分层规则/管线契约/错误处理/质量规范）——实施前必读

## S1 核心：回落解析 + 配置链

- [ ] TDD：`loadKnowledge(files, customRoot?)` 回落矩阵测试先行（自定义命中/未命中/空文件警告/目录多余文件忽略）→ 实现，返回 `{ content, customHits }`；同步修正既有调用点
- [ ] TDD：`resolveKnowledgePath` 三级优先级 + 相对路径基准 + 全局绝对路径校验 + 目录不存在 CliError（含来源）→ 实现（落点跟随现有配置合并代码所在模块）
- [ ] `StageContext` 增加 `customKnowledgeRoot` 可选字段，pipeline 组装段2 时透传

**验证**：`npx vitest run tests/unit/` 全绿；既有测试零改动通过

## S2 命令接入

- [ ] 五命令（package/title/write/revise/run）注册 `--knowledge <path>`，解析后传入；run 透传给全部子步骤
- [ ] 命中提示：命令内收集 customHits 去重后打印一次
- [ ] `duanju config` 向导追加可选知识库路径步骤（留空跳过；填写做绝对路径+存在性校验）

**验证**：mock 集成测试——临时自定义目录 + title 流程断言 prompt 注入自定义内容与提示输出；未配置场景回归

## S3 文档与发版准备

- [ ] README 新章节"自定义知识库"：目录同构说明、三级配置示例（CLI/项目/全局）、覆盖提示说明、生成质量自担声明
- [ ] package.json version → 0.2.0
- [ ] `npm pack --dry-run` 清单核对；`npm run build` + `npx vitest run` 全绿

**验证**：全量测试 + pack 清单 ⛩️ **Review Gate：用户过目 README 章节与 --knowledge 冒烟（可选真实模型）**

## 发布（用户执行）

按用户操作偏好，发布命令由用户自己跑：

```bash
git push origin master
npm publish        # 邮箱验证码
git tag -a v0.2.0 -m "v0.2.0：自定义知识库覆盖" && git push origin v0.2.0
```

## 回滚点

- S1/S2/S3 各一个 commit；任何阶段失败回退到上一 commit，未配置 knowledgePath 的行为始终与 v0.1.1 一致（特性天然可关）

## 完成定义

prd.md 验收标准全勾 + S3 Review Gate 通过。
