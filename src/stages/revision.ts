import { categorySegment } from "../core/knowledge.js";
import type { StageContext, StageSpec } from "../core/pipeline.js";
import { chapterFileName, requireMainCategory } from "../core/project.js";
import { CHAPTER_MIN_CHARS, CHAPTER_TOLERANCE, countProseChars } from "./writing.js";

/** 修订四模式（revision-modes.md 的四种加工模式，CLI --mode 取值即中文词本身） */
export const REVISION_MODES = ["改写", "扩写", "润色", "重写节奏"] as const;
export type RevisionMode = (typeof REVISION_MODES)[number];

export function isRevisionMode(mode: string): mode is RevisionMode {
  return (REVISION_MODES as readonly string[]).includes(mode);
}

/** 扩写模式目标区间：原文的 1.3-1.5 倍（skill 协议：只扩关键场景，不乱加支线） */
const EXPAND_MIN_RATIO = 1.3;
const EXPAND_MAX_RATIO = 1.5;

/** 各模式的目标字数区间：扩写为原文 1.3-1.5 倍，其余保持原文 ±15% 内 */
export function revisionCharBand(
  mode: RevisionMode,
  originalChars: number,
): { min: number; max: number } {
  if (mode === "扩写") {
    return {
      min: Math.round(originalChars * EXPAND_MIN_RATIO),
      max: Math.round(originalChars * EXPAND_MAX_RATIO),
    };
  }
  return {
    min: Math.round(originalChars * (1 - CHAPTER_TOLERANCE)),
    max: Math.round(originalChars * (1 + CHAPTER_TOLERANCE)),
  };
}

/** 各模式操作说明（提炼自 revision-modes.md，进入用户消息作模式说明） */
const MODE_BRIEF: Record<RevisionMode, string> = {
  改写: "保留事件骨架，重写句子、对白与情绪落点，让正文更顺、冲突更强",
  扩写: "不乱加支线，只扩关键场景，优先扩对峙、反转、章尾钩子前的压力",
  润色: "保留原结构，去掉重复句，强化台词与段落节奏，让文字更顺而不是更花",
  重写节奏: "压缩说明、提前冲突、提高对白密度，让反转更早出现",
};

/** 一次修订所需的全部材料 */
export interface RevisionMaterials {
  chapter: number;
  mode: RevisionMode;
  /** 原章正文全文 */
  original: string;
  /** 原文正文字数（countProseChars 口径） */
  originalChars: number;
  /** 06-章纲包中本章的章纲块（四要素）；缺失时为 null，由命令层提示降级 */
  outline: string | null;
  /** 用户 --note 补充要求（可选） */
  note?: string;
}

/** 段1：修订写手角色设定 + 字数预算声明 + 硬限制（提炼自 story-writing SKILL.md） */
function reviserRolePrompt(m: RevisionMaterials): string {
  const band = revisionCharBand(m.mode, m.originalChars);
  const bandNote =
    m.mode === "扩写"
      ? `扩写为原文的 ${EXPAND_MIN_RATIO}-${EXPAND_MAX_RATIO} 倍`
      : "保持在原文 ±15% 内";
  return `你是短剧向女频短故事的正文修订写手，按指定加工模式处理已有章节正文（番茄可读性为底、红果短剧感为骨架，单章 2000-4000 字）。

字数预算声明：本次修订目标字数：${band.min}-${band.max} 字（原文约 ${m.originalChars} 字，${bandNote}）。

工作原则：
- 严格按加工模式的改动范围操作，不引入原文之外的新设定、新角色、新支线
- 修订不得偏离本章章纲的核心事件、情绪点、反转点与结尾钩子
- 角色行为与信息边界以原文为准，角色不能"突然知道"原文之外的信息

硬限制（违反即不合格）：
- 只输出处理后的完整正文，不附带任何分析、说明或前后对比
- 不允许把文风写成散文化抒情
- 不允许只写情绪不写事件，修订后每章仍要有事件推进
- 必须保持章末钩子，不得删除或弱化章末悬念`;
}

/** 修订用户消息：原章正文 + 模式说明 + 章纲四要素 + 补充要求 + 目标字数约束 */
function revisionUserPrompt(m: RevisionMaterials): string {
  const band = revisionCharBand(m.mode, m.originalChars);
  const parts: string[] = [];
  parts.push(`【原章正文（第${m.chapter}章）】\n${m.original}`);
  parts.push(`【加工模式】\n${m.mode}：${MODE_BRIEF[m.mode]}`);
  if (m.outline) {
    parts.push(
      `【本章章纲（修订不得偏离其核心事件/情绪点/反转点/结尾钩子）】\n${m.outline}`,
    );
  }
  if (m.note?.trim()) {
    parts.push(`【补充要求】\n${m.note.trim()}`);
  }
  parts.push(
    `【本步任务】\n按「${m.mode}」模式修订第 ${m.chapter} 章正文，目标 ${band.min}-${band.max} 字，只输出处理后的完整正文。`,
  );
  return parts.join("\n\n");
}

/** 修订 Stage 工厂（流式）：输出为纯正文，结构校验放宽为非空 + 硬下限 1000 字 */
export function revisionStage(m: RevisionMaterials): StageSpec {
  const band = revisionCharBand(m.mode, m.originalChars);
  return {
    id: `revise-${m.chapter}`,
    label: `第${m.chapter}章修订（${m.mode}）`,
    outputFile: `chapters/${chapterFileName(m.chapter)}`,
    knowledgeFiles: (ctx: StageContext) => [
      "writing/references/revision-modes.md",
      "writing/references/prose-style-guide.md",
      `writing/references/${categorySegment(requireMainCategory(ctx.project))}-story-patterns.md`,
    ],
    rolePrompt: () => reviserRolePrompt(m),
    outputSpecPrompt: () => `输出修订后的第 ${m.chapter} 章完整正文（纯 markdown）：
- 第一行保留章标题：# 第${m.chapter}章 <章题>（沿用原章题，不做无关改动）
- 标题之后直接是正文段落，不写"修订说明""改动清单"等任何元信息
- 目标字数 ${band.min}-${band.max} 字（不含标题）`,
    userPrompt: () => revisionUserPrompt(m),
    // 纯正文输出：不强制小节结构，仅保留字数硬下限（extraValidate 走带反馈自动重试通道）
    requiredSections: [],
    extraValidate: (markdown) => {
      const chars = countProseChars(markdown);
      if (chars < CHAPTER_MIN_CHARS) {
        return [
          `修订后正文仅约 ${chars} 字，低于硬下限 ${CHAPTER_MIN_CHARS} 字，必须输出完整一章`,
        ];
      }
      return [];
    },
    warnValidate: (markdown) => {
      const chars = countProseChars(markdown);
      if (chars < band.min || chars > band.max) {
        return [
          `修订后约 ${chars} 字，超出目标区间 ${band.min}-${band.max} 字（原文约 ${m.originalChars} 字）`,
        ];
      }
      return [];
    },
  };
}
