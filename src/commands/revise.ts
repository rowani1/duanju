import path from "node:path";
import * as p from "@clack/prompts";
import type { LanguageModel } from "ai";
import { createModel, mergeConfig, readGlobalConfig } from "../core/llm.js";
import { CliError } from "../core/errors.js";
import { runStage, type StageContext } from "../core/pipeline.js";
import {
  backupFile,
  chapterFileName,
  extractChapterOutline,
  listChapters,
  OUTLINE_FILE,
  PERSONA_FILE,
  readArtifact,
  readProject,
  requireMainCategory,
} from "../core/project.js";
import {
  isRevisionMode,
  REVISION_MODES,
  revisionStage,
  type RevisionMaterials,
} from "../stages/revision.js";
import { countProseChars, SNAPSHOT_FILE, snapshotStage } from "../stages/writing.js";
import { assertNotCancelled } from "../ui/prompts.js";

export interface ReviseOptions {
  /** 修订模式，必须是四模式之一（改写 / 扩写 / 润色 / 重写节奏） */
  mode?: string;
  /** 用户补充修订要求（进入用户消息） */
  note?: string;
  /**
   * 跳过交互（不询问是否更新角色状态快照）。
   * 调用约定：测试注入以 yes: true 复用本命令。
   */
  yes?: boolean;
}

/**
 * duanju revise：按四模式修订指定章正文（流式），覆盖前自动备份 .bak-<时间戳>。
 * 修订最新章时提示快照基于原文并（--yes 之外）提供更新快照选项；修订早期章不动快照。
 * model 参数供测试注入。
 */
export async function runRevise(
  chapter: number,
  dir: string = process.cwd(),
  opts: ReviseOptions = {},
  model?: LanguageModel,
): Promise<void> {
  const projectDir = path.resolve(dir);
  const project = readProject(projectDir);
  requireMainCategory(project);

  const mode = opts.mode?.trim() ?? "";
  if (!isRevisionMode(mode)) {
    throw new CliError(
      `${mode ? `修订模式「${mode}」不可用` : "缺少 --mode 参数"}。请从以下四种模式中选择：${REVISION_MODES.join(" / ")}。` +
        `用法：duanju revise <章号> --mode <模式> [--note "补充要求"]`,
    );
  }

  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new CliError(`章号必须是正整数，如：duanju revise 3 --mode ${mode}`);
  }
  const chapterRel = `chapters/${chapterFileName(chapter)}`;
  const original = readArtifact(projectDir, chapterRel);
  if (original === null) {
    throw new CliError(
      `第 ${chapter} 章不存在（${chapterRel}）。请先运行 duanju write 生成该章，或运行 duanju status 查看进度。`,
    );
  }

  // 章纲四要素进上下文，保持修订不偏离章纲；找不到时降级提示（仅以原文为准）
  const outlinePkg = readArtifact(projectDir, OUTLINE_FILE);
  const outline = outlinePkg !== null ? extractChapterOutline(outlinePkg, chapter) : null;
  if (outline === null) {
    console.log(`提示：未在 ${OUTLINE_FILE} 中找到第 ${chapter} 章章纲，修订将仅以原文为准。`);
  }

  const llm =
    model ??
    createModel(
      mergeConfig({
        projectOverride: project.modelOverride,
        global: readGlobalConfig() ?? undefined,
      }),
    );

  const originalChars = countProseChars(original);
  const materials: RevisionMaterials = {
    chapter,
    mode,
    original,
    originalChars,
    outline,
    note: opts.note,
  };

  // 覆盖前备份 .bak-<时间戳>
  const backup = backupFile(path.join(projectDir, chapterRel));
  console.log(`原文已备份：${path.basename(backup)}`);

  console.log(`正在按「${mode}」修订第 ${chapter} 章（原文约 ${originalChars} 字，流式输出）…`);
  console.log("");
  const ctx: StageContext = { projectDir, project, prior: [] };
  const result = await runStage(llm, revisionStage(materials), ctx, {
    onDelta: (text) => process.stdout.write(text),
    onRetry: (problems) =>
      process.stdout.write(`\n\n[输出不合格，自动重试：${problems.join("；")}]\n\n`),
  });
  process.stdout.write("\n\n");
  for (const warning of result.warnings) {
    console.log(`警告：${warning}`);
  }
  console.log(
    `第 ${chapter} 章已按「${mode}」修订并写入 ${chapterRel}（约 ${countProseChars(result.content)} 字，原文约 ${originalChars} 字）。`,
  );

  // 快照语义：与 write 重写一致——早期章不动快照；最新章提示快照基于原文
  const written = listChapters(projectDir);
  const latest = written.length > 0 ? written[written.length - 1].num : 0;
  if (chapter < latest) {
    console.log(
      `提示：修订的第 ${chapter} 章不是最新章，${SNAPSHOT_FILE} 保持以最新章为准，未更新。`,
    );
    return;
  }

  console.log("提示：角色状态快照基于修订前的原文，若剧情有实质变化建议重跑快照。");
  if (opts.yes) return;

  const persona = readArtifact(projectDir, PERSONA_FILE);
  if (persona === null) {
    console.log(`（${PERSONA_FILE} 缺失，无法在此更新快照。）`);
    return;
  }
  const update = assertNotCancelled(
    await p.confirm({ message: "是否按修订后的正文立即更新角色状态快照？" }),
  );
  if (!update) return;

  console.log("正在更新角色状态快照…");
  const snapCtx: StageContext = { projectDir, project, prior: [] };
  await runStage(
    llm,
    snapshotStage({
      chapter,
      persona,
      previousSnapshot: readArtifact(projectDir, SNAPSHOT_FILE),
      chapterText: result.content,
    }),
    snapCtx,
  );
  console.log(`${SNAPSHOT_FILE} 已更新。`);
}
