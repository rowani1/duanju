import { categorySegment } from "../core/knowledge.js";
import { parseCommentBlock, type StageContext, type StageSpec } from "../core/pipeline.js";
import { HANDOFF_KEYS, requireMainCategory, TITLES_FILE } from "../core/project.js";

/** titles.md 文末机器可读区块标签：<!-- titles ... --> */
export const TITLES_BLOCK_TAG = "titles";

/** 每梯队候选数（skill 协议：两梯队各 10 个） */
export const TIER_SIZE = 10;

/** 单个书名的字数区间（skill 协议：8-22 字） */
export const TITLE_MIN_CHARS = 8;
export const TITLE_MAX_CHARS = 22;

/** 第一梯队理由必须点名的具体维度（skill 协议，禁用"很好""很强"式空泛评语） */
export const TITLE_DIMENSIONS = ["身份感", "冲突感", "关系感", "反转感", "顺口度"] as const;

function tierKey(tier: 1 | 2, index: number): string {
  return `${tier === 1 ? "一" : "二"}梯队${index}`;
}

export interface TitleCandidates {
  tier1: string[];
  tier2: string[];
}

/**
 * 从 titles.md 解析两梯队候选（依据文末 <!-- titles --> 机器可读区块，
 * 键名 一梯队1..一梯队10 / 二梯队1..二梯队10）。无区块返回 null。
 */
export function parseTitleCandidates(markdown: string): TitleCandidates | null {
  const block = parseCommentBlock(markdown, TITLES_BLOCK_TAG);
  if (block === null) return null;
  const pick = (tier: 1 | 2): string[] => {
    const list: string[] = [];
    for (let i = 1; i <= TIER_SIZE; i++) {
      const value = block[tierKey(tier, i)]?.trim().replace(/^《/, "").replace(/》$/, "");
      if (value) list.push(value);
    }
    return list;
  };
  return { tier1: pick(1), tier2: pick(2) };
}

/** 校验第一梯队：编号候选须列满 TIER_SIZE 个，且每个理由点名具体维度 */
export function validateTierOneReasons(markdown: string): string[] {
  const lines = markdown.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => /^#{1,6}\s.*第一梯队/.test(line));
  const end = lines.findIndex((line) => /^#{1,6}\s.*第二梯队/.test(line));
  if (start === -1 || end === -1 || end <= start) {
    return ["缺少「第一梯队」「第二梯队」分节标题（第一梯队在前）"];
  }

  const problems: string[] = [];
  const entries = lines.slice(start + 1, end).filter((line) => /^\d+[.、]/.test(line));
  if (entries.length < TIER_SIZE) {
    problems.push(`第一梯队编号候选仅 ${entries.length} 个，必须列满 ${TIER_SIZE} 个`);
  }
  const dimension = new RegExp(TITLE_DIMENSIONS.join("|"));
  const missing = entries.filter((line) => !dimension.test(line));
  if (missing.length > 0) {
    problems.push(
      `第一梯队有 ${missing.length} 个候选未点名具体维度理由（${TITLE_DIMENSIONS.join("/")}）`,
    );
  }
  return problems;
}

/**
 * 回填选定书名到 04-标题简介包.md（skill 回填协议）：
 * 已有「选定书名」小节则替换其内容（幂等），否则插入到 H1 之后。
 */
export function backfillSelectedTitle(content: string, title: string): string {
  const lines = content.split("\n");
  const heading = "## 选定书名";
  const titleLine = `《${title}》`;

  const idx = lines.findIndex((line) => /^#{1,6}\s*选定书名/.test(line.trim()));
  if (idx !== -1) {
    let end = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i].trim())) {
        end = i;
        break;
      }
    }
    lines.splice(idx + 1, end - (idx + 1), titleLine, "");
    return lines.join("\n");
  }

  const h1 = lines.findIndex((line) => /^#\s/.test(line.trim()));
  lines.splice(h1 === -1 ? 0 : h1 + 1, 0, "", heading, titleLine, "");
  return lines.join("\n");
}

/** 段1：书名锻造角色设定 + 硬限制（提炼自 title-forging SKILL.md） */
const ROLE_PROMPT = `你是短剧向女频故事的书名锻造专家，为总篇幅 1.5万-3万字的短篇作品锻造平台爆款书名（番茄小说/红果短剧风格）。

工作原则：
- 书名必须直给身份/冲突/关系/反转，让读者 1 秒抓住看点
- 严格基于交接字段与题材设定锻造，不自行更改人物与设定

硬限制（违反即不合格）：
- 两梯队各 ${TIER_SIZE} 个候选，单个书名 ${TITLE_MIN_CHARS}-${TITLE_MAX_CHARS} 字
- 第一梯队每个候选必须附带具体维度理由，点名以下维度中的至少一个：${TITLE_DIMENSIONS.join("/")}
- 禁止用"很好""很强""很带感"等空泛评语代替理由
- 不允许低俗、恶俗、擦边措辞冒充爆款`;

/** 书名锻造 Stage（1 次调用，产出 titles.md） */
export const TITLE_STAGE: StageSpec = {
  id: "title",
  label: "书名候选",
  outputFile: TITLES_FILE,
  knowledgeFiles: (ctx: StageContext) => [
    "title/references/naming-principles.md",
    "title/references/title-structures.md",
    `title/references/${categorySegment(requireMainCategory(ctx.project))}-title-patterns.md`,
    "title/references/keyword-bank.md",
    "title/references/rejection-rules.md",
    "title/references/title-ab-pairs.md",
  ],
  rolePrompt: () => ROLE_PROMPT,
  outputSpecPrompt: () => `输出一个完整 markdown 文档，格式如下：

# 书名候选
## 第一梯队（优先推荐）
1. 《书名》——<维度理由：点名 ${TITLE_DIMENSIONS.join("/")} 中的具体维度，说明为什么强>
（共 ${TIER_SIZE} 个，编号 1-${TIER_SIZE}）
## 第二梯队（备选）
11. 《书名》——<一句话理由>
（共 ${TIER_SIZE} 个，编号 11-20）

文末必须原样附加机器可读区块（键名固定为 一梯队1..一梯队${TIER_SIZE}、二梯队1..二梯队${TIER_SIZE}，值为不带书名号的纯书名，与正文候选一一对应）：
<!-- titles
一梯队1: <书名>
一梯队2: <书名>
（……直到 一梯队${TIER_SIZE}）
二梯队1: <书名>
（……直到 二梯队${TIER_SIZE}）
-->`,
  userPrompt: (ctx: StageContext) => {
    const handoff = ctx.project.handoff ?? {};
    const fields = HANDOFF_KEYS.map((key) => `- ${key}：${handoff[key] ?? ""}`).join("\n");
    return `【原始题材】\n${ctx.project.idea}\n\n【交接字段】\n${fields}\n\n【本步任务】\n为本书锻造书名：产出两梯队各 ${TIER_SIZE} 个候选，第一梯队附具体维度理由。`;
  },
  requiredSections: ["第一梯队", "第二梯队"],
  extraValidate: (markdown) => {
    const problems = validateTierOneReasons(markdown);
    const candidates = parseTitleCandidates(markdown);
    if (candidates === null) {
      problems.push("缺少文末 <!-- titles --> 机器可读区块");
    } else {
      if (candidates.tier1.length < TIER_SIZE) {
        problems.push(
          `titles 区块一梯队仅 ${candidates.tier1.length} 个（需 ${TIER_SIZE} 个，键名 一梯队1..一梯队${TIER_SIZE}）`,
        );
      }
      if (candidates.tier2.length < TIER_SIZE) {
        problems.push(
          `titles 区块二梯队仅 ${candidates.tier2.length} 个（需 ${TIER_SIZE} 个，键名 二梯队1..二梯队${TIER_SIZE}）`,
        );
      }
    }
    return problems;
  },
  warnValidate: (markdown) => {
    const candidates = parseTitleCandidates(markdown);
    if (candidates === null) return [];
    return [...candidates.tier1, ...candidates.tier2]
      .filter((t) => [...t].length < TITLE_MIN_CHARS || [...t].length > TITLE_MAX_CHARS)
      .map((t) => `候选「${t}」为 ${[...t].length} 字，超出 ${TITLE_MIN_CHARS}-${TITLE_MAX_CHARS} 字区间`);
  },
};
