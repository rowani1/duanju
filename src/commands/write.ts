import path from "node:path";
import * as p from "@clack/prompts";
import type { LanguageModel } from "ai";
import { createModel, mergeConfig, readGlobalConfig } from "../core/llm.js";
import { CliError } from "../core/errors.js";
import { runStage, type StageContext } from "../core/pipeline.js";
import {
  backupFile,
  chapterFileName,
  countOutlineChapters,
  extractChapterOutline,
  listChapters,
  OPENING_FILE,
  OUTLINE_FILE,
  PERSONA_FILE,
  readArtifact,
  readProject,
  requireMainCategory,
} from "../core/project.js";
import {
  CHAPTER_TARGET_CHARS,
  CHAPTER_TOLERANCE,
  chapterStage,
  contentTail,
  countProseChars,
  SNAPSHOT_FILE,
  snapshotStage,
  type ChapterMaterials,
} from "../stages/writing.js";
import { assertNotCancelled } from "../ui/prompts.js";

export interface WriteOptions {
  /** 指定章号 = 重写该章（覆盖前自动备份）；省略 = 写下一未完成章 */
  chapter?: number;
  /**
   * 跳过字数偏差询问，自动接受（CLI 标志 --yes）。
   * 调用约定：duanju run 全自动模式（M7）与测试注入均以 yes: true 复用本命令。
   */
  yes?: boolean;
  /** 单章目标字数覆盖（duanju run --words 透传）；省略用默认 CHAPTER_TARGET_CHARS */
  words?: number;
}

/** 字数允许区间文本，如 "2550-3450" */
function charBand(target: number): string {
  return `${Math.round(target * (1 - CHAPTER_TOLERANCE))}-${Math.round(target * (1 + CHAPTER_TOLERANCE))}`;
}

/**
 * duanju write：逐章生成正文（流式）+ 更新角色状态快照。
 * 连续性上下文 = 人设包 + 本章章纲块 + 状态快照 + 上一章尾部 500 字（不携带前文全部正文）。
 * model 参数供测试注入。
 */
export async function runWrite(
  dir: string = process.cwd(),
  opts: WriteOptions = {},
  model?: LanguageModel,
): Promise<void> {
  const projectDir = path.resolve(dir);
  const project = readProject(projectDir);
  requireMainCategory(project);

  const persona = readArtifact(projectDir, PERSONA_FILE);
  if (persona === null) {
    throw new CliError(`${PERSONA_FILE} 不存在。请先运行 duanju package 生成六包。`);
  }
  const outlinePkg = readArtifact(projectDir, OUTLINE_FILE);
  if (outlinePkg === null) {
    throw new CliError(`${OUTLINE_FILE} 不存在。请先运行 duanju package 生成六包。`);
  }
  const totalChapters = countOutlineChapters(outlinePkg);
  if (totalChapters === 0) {
    throw new CliError(
      `${OUTLINE_FILE} 中未检测到"第N章"分章表。请运行 duanju package --force 重新生成章纲包。`,
    );
  }
  if (!project.selectedTitle) {
    console.log("提示：尚未选定书名，建议先运行 duanju title（不阻塞写作）。");
  }

  const written = listChapters(projectDir);
  const latest = written.length > 0 ? written[written.length - 1].num : 0;

  // 确定本次章号：显式章号 = 重写；省略 = 第一个未完成章
  let n: number;
  if (opts.chapter !== undefined) {
    if (!Number.isInteger(opts.chapter) || opts.chapter < 1 || opts.chapter > totalChapters) {
      throw new CliError(`章号必须是 1-${totalChapters} 之间的整数（章纲共 ${totalChapters} 章）。`);
    }
    n = opts.chapter;
  } else {
    const writtenNums = new Set(written.map((c) => c.num));
    const next = Array.from({ length: totalChapters }, (_, i) => i + 1).find(
      (num) => !writtenNums.has(num),
    );
    if (next === undefined) {
      console.log(`全部 ${totalChapters} 章已完成。下一步：duanju export   # 导出成书`);
      return;
    }
    n = next;
  }

  // 连续性守卫：上一章必须已存在（章节连续性协议依赖上章尾部）
  const prevContent = n > 1 ? readArtifact(projectDir, `chapters/${chapterFileName(n - 1)}`) : null;
  if (n > 1 && prevContent === null) {
    throw new CliError(
      `第 ${n - 1} 章尚未生成，请按顺序写作（直接运行 duanju write 会自动写下一未完成章）。`,
    );
  }

  const outline = extractChapterOutline(outlinePkg, n);
  if (outline === null) {
    throw new CliError(
      `${OUTLINE_FILE} 中未找到第 ${n} 章的章纲块。请检查分章表，或运行 duanju package --force 重新生成。`,
    );
  }

  // 重写已有章：覆盖前备份 .bak-<时间戳>
  const chapterRel = `chapters/${chapterFileName(n)}`;
  if (readArtifact(projectDir, chapterRel) !== null) {
    const backup = backupFile(path.join(projectDir, chapterRel));
    console.log(`第 ${n} 章已存在，原文已备份：${path.basename(backup)}`);
  }

  // 快照仅在顺序写作（n 为最新章或下一章）时注入与更新；
  // 重写更早章节时跳过，避免"未来章节状态"泄漏进早期正文
  const snapshotInPlay = n >= latest;
  const snapshot = snapshotInPlay ? readArtifact(projectDir, SNAPSHOT_FILE) : null;

  const llm =
    model ??
    createModel(
      mergeConfig({
        projectOverride: project.modelOverride,
        global: readGlobalConfig() ?? undefined,
      }),
    );

  const target = opts.words ?? CHAPTER_TARGET_CHARS;
  const materials: ChapterMaterials = {
    chapter: n,
    outline,
    persona,
    snapshot,
    prevTail: prevContent !== null ? contentTail(prevContent, 500) : null,
    opening: n === 1 ? readArtifact(projectDir, OPENING_FILE) : null,
    targetChars: target,
  };

  // 生成正文（流式渲染），字数偏差 >±15% 时警告并询问 接受/重写
  let content = "";
  let chars = 0;
  let reviseNote: string | undefined;
  for (;;) {
    console.log(`正在生成第 ${n} 章正文（目标约 ${target} 字，流式输出）…`);
    console.log("");
    const ctx: StageContext = { projectDir, project, prior: [], reviseNote };
    const result = await runStage(llm, chapterStage(materials), ctx, {
      onDelta: (text) => process.stdout.write(text),
      onRetry: (problems) =>
        process.stdout.write(`\n\n[输出不合格，自动重试：${problems.join("；")}]\n\n`),
    });
    process.stdout.write("\n\n");
    content = result.content;
    chars = countProseChars(content);

    const deviation = Math.abs(chars - target) / target;
    if (deviation <= CHAPTER_TOLERANCE) {
      console.log(`第 ${n} 章已写入 ${chapterRel}（约 ${chars} 字）。`);
      break;
    }

    const warn = `字数偏差超限：本章约 ${chars} 字，目标 ${target} 字（允许 ±15%，即 ${charBand(target)} 字）`;
    if (opts.yes) {
      console.log(`警告：${warn}，--yes 模式已自动接受。`);
      break;
    }
    const action = assertNotCancelled(
      await p.select<"accept" | "rewrite">({
        message: `${warn}。如何处理？`,
        options: [
          { value: "accept", label: "接受本章，继续" },
          { value: "rewrite", label: "重写本章（要求贴近目标字数）" },
        ],
      }),
    );
    if (action === "accept") {
      console.log(`第 ${n} 章已写入 ${chapterRel}（约 ${chars} 字）。`);
      break;
    }
    reviseNote = `上一版正文约 ${chars} 字，偏离目标 ${target} 字超过 ±15%。请重写本章，把正文字数控制在 ${charBand(target)} 字。`;
  }

  // 调用 B：按 character-state-tracker 模板更新角色状态快照（仅顺序写作时）
  if (snapshotInPlay) {
    console.log("正在更新角色状态快照…");
    const snapCtx: StageContext = { projectDir, project, prior: [] };
    await runStage(
      llm,
      snapshotStage({ chapter: n, persona, previousSnapshot: snapshot, chapterText: content }),
      snapCtx,
    );
    console.log(`${SNAPSHOT_FILE} 已更新。`);
  } else {
    console.log(
      `提示：重写的第 ${n} 章不是最新章，${SNAPSHOT_FILE} 保持以最新章为准，未更新。`,
    );
  }

  const doneCount = listChapters(projectDir).length;
  console.log("");
  console.log(`进度：已写 ${doneCount}/${totalChapters} 章。`);
  console.log(
    doneCount >= totalChapters
      ? "下一步：duanju export   # 导出成书"
      : "下一步：duanju write   # 继续写下一章",
  );
}
