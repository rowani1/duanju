import { categorySegment } from "../core/knowledge.js";
import type { StageContext, StageSpec } from "../core/pipeline.js";
import { chapterFileName, requireMainCategory } from "../core/project.js";

/** 角色状态快照产物路径 */
export const SNAPSHOT_FILE = "state/characters.md";

/** 单章目标字数（skill 默认单章 2000-4000 字，取中值作为预算声明基准） */
export const CHAPTER_TARGET_CHARS = 3000;

/** 字数预算容差：实际偏差超 ±15% 视为不合格（skill 协议），触发警告询问 */
export const CHAPTER_TOLERANCE = 0.15;

/** 正文硬下限：低于此字数视为结构性不合格（走带反馈自动重试，而非交互询问） */
export const CHAPTER_MIN_CHARS = 1000;

/** 正文字数统计：剔除标题行与全部空白后按字符计（中文语境按字符数即字数） */
export function countProseChars(markdown: string): number {
  return markdown
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("")
    .replace(/\s+/g, "").length;
}

/** 尾部截取：取内容末尾 chars 个字符（不足则全量），供章节连续性上下文使用 */
export function contentTail(content: string, chars = 500): string {
  const trimmed = content.trimEnd();
  return trimmed.length <= chars ? trimmed : trimmed.slice(-chars);
}

/** 一章正文生成所需的全部材料（token 防线：不含前文全部正文） */
export interface ChapterMaterials {
  chapter: number;
  /** 06-章纲包中本章的章纲块 */
  outline: string;
  /** 03-人设包.md 全文 */
  persona: string;
  /** state/characters.md（首章或重写早期章节时为 null） */
  snapshot: string | null;
  /** 上一章尾部 500 字（第 1 章为 null） */
  prevTail: string | null;
  /** 05-开篇包.md（仅第 1 章注入） */
  opening: string | null;
  targetChars: number;
}

/** 段1：正文写手角色设定 + 字数预算声明 + 硬限制（提炼自 story-writing SKILL.md） */
function writerRolePrompt(m: ChapterMaterials): string {
  return `你是短剧向女频短故事的正文写手，为番茄小说/红果短剧写高钩子短篇（单章 2000-4000 字）。

字数预算声明：本章目标字数：约 ${m.targetChars} 字（±10%），实际偏差超 ±15% 视为不合格。

工作原则：
- 每章正文必须包含（对峙 / 行动 / 真相推进 / 关系变化）中的至少 2 项
- 角色行为不得违反角色状态快照（当前情绪 / 关系位置 / 已知未知信息 / 最后动作）
- 角色不能"突然知道"其信息边界之外的信息
- 章末必须落在本章章纲指定的结尾钩子上

硬限制（违反即不合格）：
- 不允许慢热开篇、一章只讲背景不推进、只写情绪不写事件
- 不允许用空泛词汇代替可执行情节（如"很带感""很上头"）
- 不允许低俗、恶俗、擦边描写
- 正文直接输出，不附带任何解释、分析或创作说明`;
}

/** 正文用户消息：人设包 + 本章章纲 + 状态快照 + 上章尾部 +（首章）开篇包 */
function chapterUserPrompt(m: ChapterMaterials): string {
  const parts: string[] = [];
  parts.push(`【人设包】\n${m.persona}`);
  parts.push(`【本章章纲（第${m.chapter}章）】\n${m.outline}`);
  if (m.snapshot) {
    parts.push(`【角色状态快照（动笔前锁定，角色行为不得违反）】\n${m.snapshot}`);
  } else {
    parts.push(`【角色状态快照】\n无——以人设包中各角色的"初始状态"为基准。`);
  }
  if (m.prevTail) {
    parts.push(
      `【上一章尾部（最后 500 字）】\n${m.prevTail}\n\n（要求：本章前 2-3 句必须直接接住上述场景与情绪，不得跳场景硬切。）`,
    );
  }
  if (m.opening) {
    parts.push(`【开篇包（第 1 章必须按此开篇设计执行）】\n${m.opening}`);
  }
  parts.push(`【本章任务】\n写第 ${m.chapter} 章完整正文，目标约 ${m.targetChars} 字。`);
  return parts.join("\n\n");
}

/** 正文生成 Stage 工厂（流式调用 A）：按章号与材料生成声明式 Stage */
export function chapterStage(m: ChapterMaterials): StageSpec {
  return {
    id: `write-${m.chapter}`,
    label: `第${m.chapter}章正文`,
    outputFile: `chapters/${chapterFileName(m.chapter)}`,
    knowledgeFiles: (ctx: StageContext) => [
      "writing/references/writing-principles.md",
      "writing/references/prose-style-guide.md",
      "writing/references/chapter-engine.md",
      `writing/references/${categorySegment(requireMainCategory(ctx.project))}-story-patterns.md`,
    ],
    rolePrompt: () => writerRolePrompt(m),
    outputSpecPrompt: () => `输出第 ${m.chapter} 章完整正文（纯 markdown）：
- 第一行为章标题：# 第${m.chapter}章 <章题>（必须用阿拉伯数字章号）
- 标题之后直接是正文段落，不写"本章目标""创作说明"等任何元信息
- 目标字数约 ${m.targetChars} 字（不含标题）`,
    userPrompt: () => chapterUserPrompt(m),
    requiredSections: [`第${m.chapter}章`],
    extraValidate: (markdown) => {
      const chars = countProseChars(markdown);
      if (chars < CHAPTER_MIN_CHARS) {
        return [
          `正文仅约 ${chars} 字，远低于目标 ${m.targetChars} 字（±15%），必须写满完整一章`,
        ];
      }
      return [];
    },
  };
}

/** 快照更新所需材料 */
export interface SnapshotMaterials {
  chapter: number;
  /** 03-人设包.md 全文 */
  persona: string;
  /** 更新前的旧快照（首次为 null，从人设包初始状态提取） */
  previousSnapshot: string | null;
  /** 本章正文全文 */
  chapterText: string;
}

/** 快照更新 Stage 工厂（非流式调用 B）：按 character-state-tracker 模板更新 state/characters.md */
export function snapshotStage(m: SnapshotMaterials): StageSpec {
  return {
    id: `snapshot-${m.chapter}`,
    label: `第${m.chapter}章角色状态快照`,
    outputFile: SNAPSHOT_FILE,
    knowledgeFiles: () => ["writing/references/character-state-tracker.md"],
    rolePrompt:
      () => `你是连载状态记录员，在每章写完后按"角色状态追踪模板"更新角色状态快照，供下一章动笔前锁定状态。
只依据人设包、旧快照与本章正文中实际发生的内容记录，不虚构、不预测未发生的剧情。`,
    outputSpecPrompt: () => `按知识库中的模板输出完整快照 markdown：
- 首行标题：# 角色状态快照 — 第${m.chapter + 1}章开始前
- 女主 / 男主 / 核心反派 各一节，每节必含：当前身份、当前情绪、当前关系位置、已知信息、未知信息、本章前最后一个动作
- 文末保留"伏笔池"表格（沿用旧快照并按本章新埋/揭示情况更新；暂无伏笔则保留空表头）
只输出快照文档本身，不附带解释。`,
    userPrompt: () => {
      const parts = [`【人设包】\n${m.persona}`];
      parts.push(
        m.previousSnapshot
          ? `【旧快照】\n${m.previousSnapshot}`
          : `【旧快照】\n无——首次生成，从人设包各角色的"初始状态"提取。`,
      );
      parts.push(`【第${m.chapter}章正文】\n${m.chapterText}`);
      parts.push(`【任务】\n更新截至第 ${m.chapter} 章结束的角色状态快照。`);
      return parts.join("\n\n");
    },
    requiredSections: [
      "女主",
      "男主",
      "反派",
      "当前情绪",
      "当前关系位置",
      "已知信息",
      "未知信息",
      "最后一个动作",
      "伏笔池",
    ],
  };
}
