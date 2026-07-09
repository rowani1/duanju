# 知识库来源与三技能协作协议速查

> 供 trellis-implement / trellis-check 子代理使用。design.md 描述架构，本文档补充 skill 原文中的关键协议细节与源文件位置。

## 知识库源位置（M0 拷贝入仓前的唯一来源）

三个 skill 位于用户级目录（Windows 绝对路径）：

```
C:\Users\Rowan\.claude\skills\duanju-female-novel-packaging\   → 拷贝为 knowledge/packaging/
C:\Users\Rowan\.claude\skills\duanju-female-story-writing\     → 拷贝为 knowledge/writing/
C:\Users\Rowan\.claude\skills\duanju-title-forging\            → 拷贝为 knowledge/title/
```

每个目录含 `SKILL.md` + `references/*.md`。文件计数：packaging 14 refs、writing 15 refs、title 10 refs，加 3 个 SKILL.md 共 42 个文件。版本号均为 v1.1（SKILL.md 文末声明，拷贝后不得改动内容）。

## 主类 → 知识文件名映射

| 主类 | 文件名段 |
|---|---|
| 总裁 | zongcai |
| 古言 | guyan |
| 女频现实情感 | female-realistic |
| 年代/穿越 | niandai |

对应 `<段>-subtypes.md`（packaging）、`<段>-story-patterns.md`（writing）、`<段>-title-patterns.md`（title）。

## 九个 handoff 交接字段（packaging → title/writing，字段名不可增减）

主类、子类、一句话选题、核心卖点、女主身份、男主身份、核心关系、核心冲突、最强反转

## 六包的必需小节（结构校验依据，源自 packaging SKILL.md 默认输出格式）

1. 题材归类：主类 / 子类 / 短剧适配判断 / 风险
2. 题材包：一句话选题 / 核心卖点 / 目标情绪 / 短剧化优势 / 场景成本 / 风险点
3. 人设包：女主 / 男主 / 反派或阻力角色 / 关系链 / 核心冲突（人设卡必须带初始状态字段——writing 侧接收时强制检查）
4. 标题简介包：书名候选 / 一句话卖点 / 简介版本 / 标签 / 封面短句
5. 开篇包：开篇场景 / 第一冲突 / 第一反转 / 第一章章末钩子 / 前3章推进
6. 章纲包：总纲 / 10-20章分章表（每章必含：核心事件 / 情绪点 / 反转点 / 结尾钩子 四要素）

## title 输出协议（源自 title-forging SKILL.md）

- 两梯队各 10 个候选；单标题 8-22 字
- 第一梯队每个标题必须附带具体维度理由（身份感/冲突感/关系感/反转感/顺口度），禁用"很好""很强"
- 回填协议：选定书名后更新 04-标题简介包.md 与项目元数据

## writing 关键协议（源自 story-writing SKILL.md）

- 字数预算声明：生成前声明"本章目标字数：约 X 字（±10%）"，实际偏差超 ±15% 视为不合格
- 章节连续性：动笔前回读上一章最后 500 字；本章前 2-3 句必须接住上章场景/情绪
- 角色状态快照：每章前锁定（当前情绪/关系位置/已知未知信息/最后动作），行为不得违反快照
- 每章正文必须包含（对峙/行动/真相推进/关系变化）中至少 2 项
- 修订四模式：改写 / 扩写 / 润色 / 重写节奏（对应 references/revision-modes.md）
- 正文直接输出，不附带解释分析

## 三 skill 共同硬限制（提示词模板必须内置）

- 不允许慢热开篇、一章只讲背景不推进、只写情绪不写事件
- 不允许空泛词汇代替可执行结构（"很带感""很上头"）
- 不允许低俗擦边措辞冒充爆款
- 章纲不允许默认输出 50 章以上大长纲
- 交接字段缺失时询问补充，不得猜测
