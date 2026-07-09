import { categorySegment, MAIN_CATEGORIES } from "../core/knowledge.js";
import type { StageContext, StageSpec } from "../core/pipeline.js";
import {
  BLURB_FILE,
  countOutlineChapters,
  OPENING_FILE,
  OUTLINE_FILE,
  PERSONA_FILE,
  requireMainCategory,
} from "../core/project.js";

/** 风险自检产物文件名（六包之外的第七步，续传依据） */
export const RISK_REPORT_FILE = "07-风险自检.md";

/** 风险自检机器可读区块的标签：<!-- revise ... --> */
export const REVISE_BLOCK_TAG = "revise";

/** 段1：所有 package 步骤共用的角色设定 + 硬限制（提炼自 packaging SKILL.md） */
const ROLE_PROMPT = `你是短剧向女频故事包装专家，服务番茄小说、红果短剧等平台的短篇创作（总篇幅 1.5万-3万字，单章 2000-4000 字）。
只覆盖四大主类：总裁、古言、女频现实情感、年代/穿越。

工作原则：
- 先分类再输出；所有输出面向"高情绪、高冲突、高可视化、低改编成本"
- 不堆砌大设定，优先写关系冲突；所有冲突必须能落到人物关系
- 只输出要求的 markdown 产物，不输出多余解释

硬限制（违反即不合格）：
- 不允许慢热开篇、一章只讲背景不推进、只写情绪不写事件
- 不允许用空泛词汇代替可执行结构（如"很带感""很上头"）
- 不允许低俗、恶俗、擦边措辞冒充爆款
- 不允许默认输出 50 章以上的大长纲
- 不允许把"题材大、设定大、角色多"包装成短剧优势
- 不允许把"狗血"写成"混乱"`;

/** 用户消息：原始题材 + 已完成产物累积 + 本步任务 */
function buildUser(ctx: StageContext, task: string): string {
  const parts = [`【原始题材】\n${ctx.project.idea}`];
  for (const p of ctx.prior) {
    parts.push(`【已完成产物：${p.file}】\n${p.content}`);
  }
  parts.push(`【本步任务】\n${task}`);
  return parts.join("\n\n");
}

/** handoff 区块输出要求（段3 复用） */
function handoffSpec(lines: string[]): string {
  return `文末必须原样附加以下格式的机器可读区块（HTML 注释内为键值对，键名固定不可改，值与正文一致）：
<!-- handoff
${lines.join("\n")}
-->`;
}

/** ① 题材归类 */
const stage01: StageSpec = {
  id: "package-01",
  label: "题材归类",
  outputFile: "01-题材归类.md",
  knowledgeFiles: () => ["packaging/references/category-map.md"],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【题材归类】，判断题材属于哪一主类、哪一子类、是否适合短剧化。输出一个完整 markdown 文档，格式如下：

# 题材归类
- 主类：<总裁 / 古言 / 女频现实情感 / 年代\\/穿越 四选一，必须照抄类名>
- 子类：<结合知识库子类清单给出具体子类>
- 短剧适配判断：<适合/不适合 + 具体理由>
- 风险：<不适配风险与规避方式>

${handoffSpec(["主类: <主类>", "子类: <子类>"])}`,
  userPrompt: (ctx) => buildUser(ctx, "对原始题材做题材归类。"),
  requiredSections: ["主类", "子类", "短剧适配判断", "风险"],
  handoffKeys: ["主类", "子类"],
  extraValidate: (_md, handoff) => {
    const category = handoff["主类"]?.trim();
    if (category && !(MAIN_CATEGORIES as readonly string[]).includes(category)) {
      return [
        `handoff 的主类「${category}」不在四大主类内，必须是：${MAIN_CATEGORIES.join("、")}`,
      ];
    }
    return [];
  },
};

/** ② 题材包 */
const stage02: StageSpec = {
  id: "package-02",
  label: "题材包",
  outputFile: "02-题材包.md",
  knowledgeFiles: (ctx) => [
    `packaging/references/${categorySegment(requireMainCategory(ctx.project))}-subtypes.md`,
  ],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【题材包】。基于已确定的主类/子类，输出一个完整 markdown 文档，格式如下：

# 题材包
- 一句话选题：<一句话说清谁、发生什么、爽在哪>
- 核心卖点：<可执行的卖点组合，如"身份反转+带娃引爆+前夫追妻">
- 目标情绪：<目标读者情绪>
- 短剧化优势：<为什么适合短剧>
- 场景成本：<场景成本判断，越低越好>
- 风险点：<该选题的风险点>

${handoffSpec([
    "一句话选题: <一句话选题>",
    "核心卖点: <核心卖点>",
    "最强反转: <全书最强的一处反转，一句话>",
  ])}`,
  userPrompt: (ctx) => buildUser(ctx, "基于题材归类结果生成题材包。"),
  requiredSections: ["一句话选题", "核心卖点", "目标情绪", "短剧化优势", "场景成本", "风险点"],
  handoffKeys: ["一句话选题", "核心卖点", "最强反转"],
};

/** ③ 人设包 */
const stage03: StageSpec = {
  id: "package-03",
  label: "人设包",
  outputFile: PERSONA_FILE,
  knowledgeFiles: () => [
    "packaging/references/character-archetypes.md",
    "packaging/references/relationship-conflict-matrix.md",
  ],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【人设包】。输出一个完整 markdown 文档，格式如下：

# 人设包
## 女主
<人设卡：身份 / 表面性格 / 真实驱动 / 初始状态（初始情绪、初始关系位置、已知/未知信息边界）>
## 男主
<人设卡：同上，必须含初始状态字段>
## 反派/阻力角色
<人设卡 + 阻力方式>
## 关系链
<主要角色之间的关系与张力>
## 核心冲突
<能落到人物关系的核心冲突>
## 角色禁忌
<每个主要角色绝不会做的事>

注意：女主、男主人设卡必须带"初始状态"字段，下游正文创作会强制检查。

${handoffSpec([
    "女主身份: <女主身份一句话>",
    "男主身份: <男主身份一句话>",
    "核心关系: <两人核心关系一句话>",
    "核心冲突: <核心冲突一句话>",
  ])}`,
  userPrompt: (ctx) => buildUser(ctx, "基于题材归类与题材包生成人设包。"),
  requiredSections: ["女主", "男主", "反派", "关系链", "核心冲突", "初始状态"],
  handoffKeys: ["女主身份", "男主身份", "核心关系", "核心冲突"],
};

/** ④ 标题简介包（初版，书名在 duanju title 阶段锻造后回填） */
const stage04: StageSpec = {
  id: "package-04",
  label: "标题简介包",
  outputFile: BLURB_FILE,
  knowledgeFiles: () => ["packaging/references/title-and-blurb-patterns.md"],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【标题简介包】初版（正式书名后续由书名锻造阶段回填）。输出一个完整 markdown 文档，格式如下：

# 标题简介包
## 书名候选
<3-5 个初版候选，每个 8-22 字>
## 一句话卖点
<读者一眼看到的钩子>
## 简介版本
<2 个简介版本，每个 50-120 字，冲突前置>
## 标签
<5-8 个平台风格标签>
## 封面短句
<2-3 个封面用短句>`,
  userPrompt: (ctx) => buildUser(ctx, "基于前序产物生成标题简介包初版。"),
  requiredSections: ["书名候选", "一句话卖点", "简介版本", "标签", "封面短句"],
};

/** ⑤ 开篇包 */
const stage05: StageSpec = {
  id: "package-05",
  label: "开篇包",
  outputFile: OPENING_FILE,
  knowledgeFiles: () => ["packaging/references/opening-hook-patterns.md"],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【开篇包】。开篇必须直接进冲突，禁止慢热铺垫。输出一个完整 markdown 文档，格式如下：

# 开篇包
## 开篇场景
<第一幕场景：时间地点人物 + 正在发生的冲突事件>
## 第一冲突
<开篇第一冲突及其对关系的冲击>
## 第一反转
<第一处反转出现的位置与内容>
## 第一章章末钩子
<第一章结尾的悬念钩子>
## 前3章推进
<第 1/2/3 章各自的推进重点，每章都要有事件推进>`,
  userPrompt: (ctx) => buildUser(ctx, "基于前序产物生成开篇包。"),
  requiredSections: ["开篇场景", "第一冲突", "第一反转", "章末钩子", "前3章推进"],
};

/** ⑥ 章纲包 */
const stage06: StageSpec = {
  id: "package-06",
  label: "章纲包",
  outputFile: OUTLINE_FILE,
  knowledgeFiles: () => ["packaging/references/outline-templates.md"],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【章纲包】。总篇幅 1.5万-3万字、单章 2000-4000 字，分章表 10-20 章（严禁超过 30 章）。输出一个完整 markdown 文档，格式如下：

# 章纲包
## 总纲
<全书主线：起点 → 三个关键转折 → 结局>
## 10-20章分章表
### 第1章 <章题>
- 核心事件：<本章发生的核心事件>
- 情绪点：<本章要打中的读者情绪>
- 反转点：<本章反转，无则写"无（蓄力）"但连续无反转不得超过2章>
- 结尾钩子：<章末悬念>
### 第2章 <章题>
（同上四要素，直到最后一章）

每章必须包含核心事件、情绪点、反转点、结尾钩子四要素，缺一不可。`,
  userPrompt: (ctx) => buildUser(ctx, "基于前序全部产物生成章纲包。"),
  requiredSections: ["总纲", "分章表", "核心事件", "情绪点", "反转点", "结尾钩子"],
  // 章数约束：无分章表 / >30 章硬拦（skill 硬限制"不允许默认输出 50 章以上"的收紧执行）；
  // 偏离 prd 目标区间 10-20 章但未破硬上限时仅警告，尊重模型按题材容量的取舍。
  extraValidate: (md) => {
    const chapters = countOutlineChapters(md);
    if (chapters === 0) {
      return ['未检测到"第N章"格式的分章表'];
    }
    if (chapters > 30) {
      return [`分章表 ${chapters} 章超出硬上限 30 章（目标 10-20 章），必须精简`];
    }
    return [];
  },
  warnValidate: (md) => {
    const chapters = countOutlineChapters(md);
    if (chapters >= 1 && chapters < 10) {
      return [`分章表仅 ${chapters} 章，低于目标区间 10-20 章，总篇幅可能不足 1.5 万字，建议重写补足`];
    }
    if (chapters > 20) {
      return [`分章表 ${chapters} 章，超出目标区间 10-20 章，注意控制总篇幅（1.5万-3万字）`];
    }
    return [];
  },
};

/** ⑦ 风险自检：审查六包，输出修订建议（机器可读 revise 区块 → 回改对应包） */
const stage07: StageSpec = {
  id: "package-07",
  label: "风险自检",
  outputFile: RISK_REPORT_FILE,
  knowledgeFiles: () => [
    "packaging/references/risk-checklist.md",
    "packaging/references/bad-case-gallery.md",
  ],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `本步只完成【风险自检】：对照风险清单与翻车案例，逐包审查已生成的六包产物。输出一个完整 markdown 文档，格式如下：

# 风险自检
## 自检结论
- 结论：<通过 / 需修订>
## 逐项排查
<对照风险清单与翻车模式的排查记录，指出命中项>
## 修订建议
<需修订时逐条写明"哪个包 + 什么问题 + 怎么改"；全部通过则写"无">

文末必须原样附加机器可读区块：需修订时每行一条"<包文件名>: <一句话修订指令>"（文件名限 01-题材归类.md 至 06-章纲包.md）；全部通过时区块内容留空。
<!-- revise
<需修订的包文件名>: <一句话修订指令>
-->

注意：只对确有风险的包提出修订，不要为了显得严格而强行挑刺。`,
  userPrompt: (ctx) => buildUser(ctx, "对以上六包做输出前风险自检。"),
  requiredSections: ["自检结论", "修订建议"],
  extraValidate: (md) => {
    if (!/<!--\s*revise[\s\S]*?-->/.test(md)) {
      return ["缺少文末 <!-- revise --> 机器可读区块（全部通过时区块内容留空即可）"];
    }
    return [];
  },
};

/** 七个 package 步骤（顺序即执行顺序：六包 + 风险自检） */
export const PACKAGING_STAGES: StageSpec[] = [
  stage01,
  stage02,
  stage03,
  stage04,
  stage05,
  stage06,
  stage07,
];

/** 六包文件名 → 对应 StageSpec（供风险自检回改时定位重跑步骤） */
export function stageByOutputFile(file: string): StageSpec | undefined {
  return PACKAGING_STAGES.find((s) => s.outputFile === file);
}
