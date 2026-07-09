import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateText, streamText, type CoreMessage, type LanguageModel } from "ai";
import { CliError } from "./errors.js";
import { loadKnowledge } from "./knowledge.js";
import type { DuanjuProject } from "./project.js";

/**
 * Stage 上下文：执行一个 Stage 所需的全部动态信息。
 * prior 为已完成产物（供提示词累积上下文），顺序即生成顺序。
 */
export interface StageContext {
  projectDir: string;
  project: DuanjuProject;
  prior: Array<{ file: string; content: string }>;
  /** 用户重写要求 或 风险自检修订建议（追加到用户消息尾部） */
  reviseNote?: string;
}

/**
 * 声明式 Stage 定义（纯数据 + 纯函数，不含流程逻辑）。
 * pipeline 按三段式组装 system prompt：段1 rolePrompt + 段2 知识注入 + 段3 outputSpecPrompt。
 */
export interface StageSpec {
  id: string;
  /** 中文名，用于进度展示与错误信息 */
  label: string;
  /** 产物相对项目目录的路径 */
  outputFile: string;
  /** 该 Stage 依赖的知识文件（相对 knowledge/，按主类动态选择） */
  knowledgeFiles(ctx: StageContext): string[];
  /** 段1：角色设定 + 硬限制 */
  rolePrompt(ctx: StageContext): string;
  /** 段3：输出规约（markdown 模板 + handoff 区块要求） */
  outputSpecPrompt(ctx: StageContext): string;
  /** 用户消息（原始题材 + 累积上下文 + 本步任务） */
  userPrompt(ctx: StageContext): string;
  /** 结构校验：必需小节名（出现在标题/列表行即算存在） */
  requiredSections: string[];
  /** handoff 区块必须携带的键名（不要求 handoff 时省略） */
  handoffKeys?: string[];
  /** 额外校验，返回错误信息数组（空数组 = 通过） */
  extraValidate?(markdown: string, handoff: Record<string, string>, ctx: StageContext): string[];
  /** 软校验：返回警告清单（不阻断、不触发重试，由命令层展示给用户） */
  warnValidate?(markdown: string, handoff: Record<string, string>, ctx: StageContext): string[];
}

export interface StageResult {
  /** 最终产物内容（已落盘） */
  content: string;
  /** 解析到的 handoff 键值（无区块时为空对象） */
  handoff: Record<string, string>;
  /** 产物绝对路径 */
  file: string;
  /** 是否经过带反馈重试 */
  retried: boolean;
  /** 软校验警告（不影响落盘，由调用方决定如何提示） */
  warnings: string[];
}

/** Stage 校验失败（重试 1 次后仍不合格）时抛出，problems 为中文问题清单 */
export class StageValidationError extends CliError {
  readonly problems: string[];
  readonly stageLabel: string;

  constructor(stageLabel: string, problems: string[]) {
    super(
      `「${stageLabel}」生成内容经重试后仍不合格：\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n可重新运行命令再试，或调整题材表述后使用 --force 重做。",
    );
    this.name = "StageValidationError";
    this.stageLabel = stageLabel;
    this.problems = problems;
  }
}

/**
 * 解析 markdown 中 HTML 注释包裹的键值区块，如：
 * <!-- handoff
 * 主类: 总裁
 * -->
 * 取最后一个匹配（约定在文末）；键值行支持半角/全角冒号，忽略无冒号行与代码围栏。
 * 无区块返回 null，空区块返回 {}。
 */
export function parseCommentBlock(markdown: string, tag: string): Record<string, string> | null {
  const re = new RegExp(`<!--\\s*${tag}\\s*\\n([\\s\\S]*?)-->`, "g");
  let body: string | null = null;
  for (const m of markdown.matchAll(re)) {
    body = m[1];
  }
  if (body === null) return null;

  const fields: Record<string, string> = {};
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/^\s*[-*]\s+/, "").trim();
    if (!line || line.startsWith("```")) continue;
    const idx = findColon(line);
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value) fields[key] = value;
  }
  return fields;
}

/** 返回首个半角/全角冒号位置，均无返回 -1 */
function findColon(line: string): number {
  const half = line.indexOf(":");
  const full = line.indexOf("：");
  if (half === -1) return full;
  if (full === -1) return half;
  return Math.min(half, full);
}

/**
 * markdown 结构校验：每个必需小节名须出现在“结构行”中——
 * 标题（#）、列表项（-/*）、加粗行（**）、编号行（1. / 1、），或以小节名开头的行。
 * 返回缺失的小节名（空数组 = 通过）。
 */
export function validateStructure(markdown: string, requiredSections: string[]): string[] {
  const lines = markdown.split("\n").map((l) => l.trim());
  const isStructural = (line: string): boolean =>
    /^(?:#{1,6}\s|[-*]\s|\*\*|\d+[.、])/.test(line);

  return requiredSections.filter(
    (section) =>
      !lines.some(
        (line) => line.includes(section) && (isStructural(line) || line.startsWith(section)),
      ),
  );
}

/** 汇总一次输出的全部问题（结构缺失 + handoff 缺键 + 额外校验） */
function collectProblems(
  markdown: string,
  spec: StageSpec,
  ctx: StageContext,
): { problems: string[]; handoff: Record<string, string> } {
  const problems: string[] = [];

  const missingSections = validateStructure(markdown, spec.requiredSections);
  if (missingSections.length > 0) {
    problems.push(`缺少必需小节：${missingSections.join("、")}`);
  }

  let handoff: Record<string, string> = {};
  if (spec.handoffKeys && spec.handoffKeys.length > 0) {
    const parsed = parseCommentBlock(markdown, "handoff");
    if (parsed === null) {
      problems.push("缺少文末 <!-- handoff --> 机器可读区块");
    } else {
      handoff = parsed;
      const missingKeys = spec.handoffKeys.filter((k) => !parsed[k]?.trim());
      if (missingKeys.length > 0) {
        problems.push(`handoff 区块缺少字段：${missingKeys.join("、")}`);
      }
    }
  } else {
    handoff = parseCommentBlock(markdown, "handoff") ?? {};
  }

  if (spec.extraValidate) {
    problems.push(...spec.extraValidate(markdown, handoff, ctx));
  }

  return { problems, handoff };
}

/** 组装三段式 system prompt */
export function buildSystemPrompt(spec: StageSpec, ctx: StageContext): string {
  return [
    spec.rolePrompt(ctx),
    "以下是本步骤依赖的知识库原文，输出必须遵循其中的方法与规则：\n\n" +
      loadKnowledge(spec.knowledgeFiles(ctx)),
    spec.outputSpecPrompt(ctx),
  ].join("\n\n---\n\n");
}

/** 组装用户消息（含修订要求追加） */
export function buildUserPrompt(spec: StageSpec, ctx: StageContext): string {
  let prompt = spec.userPrompt(ctx);
  if (ctx.reviseNote?.trim()) {
    prompt += `\n\n【修订要求】\n${ctx.reviseNote.trim()}`;
  }
  return prompt;
}

/** runStage 可选行为：流式渲染与重试提示（供 write 等命令接管终端输出） */
export interface RunStageOptions {
  /** 提供时改用 streamText，文本增量实时回调（不影响校验/重试/落盘流程） */
  onDelta?: (text: string) => void;
  /** 校验失败触发带反馈自动重试前回调（命令层可打印分隔提示） */
  onRetry?: (problems: string[]) => void;
}

/** 单次模型调用：onDelta 存在时走流式（错误部件转为抛出），否则走 generateText */
async function callModel(
  model: LanguageModel,
  system: string,
  messages: CoreMessage[],
  onDelta?: (text: string) => void,
): Promise<string> {
  if (!onDelta) {
    const result = await generateText({ model, system, messages, maxRetries: 2 });
    return result.text.trim();
  }
  const result = streamText({ model, system, messages, maxRetries: 2 });
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text += part.textDelta;
      onDelta(part.textDelta);
    } else if (part.type === "error") {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }
  return text.trim();
}

/**
 * 执行一个 Stage：组装三段式 prompt → 调用模型（可流式）→ 结构校验 →
 * 失败带错误反馈自动重试 1 次 → 仍失败抛 StageValidationError →
 * 成功解析 handoff 并落盘（UTF-8）。
 */
export async function runStage(
  model: LanguageModel,
  spec: StageSpec,
  ctx: StageContext,
  opts: RunStageOptions = {},
): Promise<StageResult> {
  const system = buildSystemPrompt(spec, ctx);
  const userPrompt = buildUserPrompt(spec, ctx);
  const messages: CoreMessage[] = [{ role: "user", content: userPrompt }];

  let markdown = await callModel(model, system, messages, opts.onDelta);
  let { problems, handoff } = collectProblems(markdown, spec, ctx);
  let retried = false;

  if (problems.length > 0) {
    retried = true;
    opts.onRetry?.(problems);
    const feedback =
      "你刚才的输出存在以下问题：\n" +
      problems.map((p) => `- ${p}`).join("\n") +
      "\n请修正以上全部问题，重新输出完整的 markdown 文档（不要只输出差异部分）。";
    const retryMessages: CoreMessage[] = [
      ...messages,
      { role: "assistant", content: markdown },
      { role: "user", content: feedback },
    ];
    markdown = await callModel(model, system, retryMessages, opts.onDelta);
    ({ problems, handoff } = collectProblems(markdown, spec, ctx));
  }

  if (problems.length > 0) {
    throw new StageValidationError(spec.label, problems);
  }

  const warnings = spec.warnValidate ? spec.warnValidate(markdown, handoff, ctx) : [];

  const file = path.join(ctx.projectDir, spec.outputFile);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, markdown + "\n", "utf-8");

  return { content: markdown, handoff, file, retried, warnings };
}
