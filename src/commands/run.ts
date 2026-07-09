import path from "node:path";
import type { LanguageModel } from "ai";
import { createModel, mergeConfig, readGlobalConfig } from "../core/llm.js";
import { CliError } from "../core/errors.js";
import {
  countOutlineChapters,
  createProject,
  inferProgress,
  isProject,
  listChapters,
  OUTLINE_FILE,
  readArtifact,
  readProject,
  sanitizeProjectDirName,
} from "../core/project.js";
import { runExport } from "./export.js";
import { runPackage } from "./package.js";
import { runTitle } from "./title.js";
import { runWrite } from "./write.js";

export interface RunOptions {
  /** 单章目标字数，透传给 write */
  words?: number;
}

const STEP_TOTAL = 5;

function banner(step: number, label: string): void {
  console.log("");
  console.log(`===== 全自动 步骤 ${step}/${STEP_TOTAL}：${label} =====`);
}

/** 中断时打印已完成进度（推断失败不影响错误上抛） */
function printProgressSnapshot(projectDir: string): void {
  try {
    const progress = inferProgress(projectDir);
    const donePkgs = progress.packages.filter((s) => s.done).length;
    console.log(
      `  - 六包：${donePkgs}/6` +
        `${progress.titlesGenerated ? "，书名候选已生成" : ""}` +
        `${progress.titleSelected ? "，书名已选定" : ""}`,
    );
    console.log(
      `  - 章节：已写 ${progress.chaptersWritten}${progress.totalChapters !== undefined ? `/${progress.totalChapters}` : ""} 章`,
    );
  } catch {
    // 进度推断失败时只省略进度行
  }
}

/**
 * 确定全自动模式的项目目录：
 * 当前目录已是项目 → 复用；同题材项目目录已存在 → 复用续传；否则按题材新建。
 */
function resolveProjectDir(idea: string | undefined, baseDir: string): string {
  if (isProject(baseDir)) {
    console.log(`当前目录已是 duanju 项目，复用：${baseDir}（跳过创建）`);
    return baseDir;
  }
  const trimmed = idea?.trim() ?? "";
  if (!trimmed) {
    throw new CliError(
      '当前目录不是 duanju 项目，需要提供题材。用法：duanju run --auto "<题材一句话>"',
    );
  }
  const candidate = path.resolve(baseDir, sanitizeProjectDirName(trimmed));
  if (isProject(candidate)) {
    console.log(`检测到同题材项目目录，复用续传：${candidate}（跳过创建）`);
    return candidate;
  }
  const projectDir = createProject(trimmed, baseDir);
  console.log(`项目已创建：${projectDir}`);
  return projectDir;
}

/**
 * duanju run --auto：全自动串联 new → package --yes → title --yes（自动选第一梯队第 1）→
 * write --yes 循环写完章纲全部章 → export --merged。
 * 复用各命令导出的主流程函数；任一步失败保留现场、打印续传提示后把错误上抛（入口以非零码退出）。
 * model 参数供测试注入。
 */
export async function runAuto(
  idea: string | undefined,
  dir: string = process.cwd(),
  opts: RunOptions = {},
  model?: LanguageModel,
): Promise<void> {
  const baseDir = path.resolve(dir);

  banner(1, "创建项目（new）");
  const projectDir = resolveProjectDir(idea, baseDir);

  try {
    // 模型只创建一次，供 package/title/write 共用
    const llm =
      model ??
      createModel(
        mergeConfig({
          projectOverride: readProject(projectDir).modelOverride,
          global: readGlobalConfig() ?? undefined,
        }),
      );

    banner(2, "生成六包（package --yes）");
    await runPackage(projectDir, { yes: true }, llm);

    banner(3, "锻造书名（title --yes，自动选第一梯队第 1）");
    if (readProject(projectDir).selectedTitle) {
      console.log("书名已选定，跳过（续传）。");
    } else {
      await runTitle(projectDir, { yes: true }, llm);
    }

    banner(4, "逐章写作（write --yes）");
    const outlinePkg = readArtifact(projectDir, OUTLINE_FILE);
    const totalChapters = outlinePkg !== null ? countOutlineChapters(outlinePkg) : 0;
    if (totalChapters === 0) {
      throw new CliError(
        `${OUTLINE_FILE} 中未检测到"第N章"分章表，无法逐章写作。请运行 duanju package --force 重新生成章纲包。`,
      );
    }
    while (listChapters(projectDir).length < totalChapters) {
      // 进度按已写章数展示；具体写第几章由 runWrite 选定（首个未完成章）并自行播报
      console.log("");
      console.log(`--- 章节进度 ${listChapters(projectDir).length}/${totalChapters}，写下一未完成章 ---`);
      await runWrite(projectDir, { yes: true, words: opts.words }, llm);
    }
    console.log(`全部 ${totalChapters} 章已完成。`);

    banner(5, "导出成书（export --merged）");
    runExport(projectDir, { merged: true });
  } catch (err) {
    console.log("");
    console.log("全自动流程中断，已完成的产物已保留：");
    printProgressSnapshot(projectDir);
    console.log(`现场目录：${projectDir}`);
    console.log(
      "在原目录重跑同一条 duanju run --auto 命令，或进入项目目录使用分步命令（duanju package / title / write / export）均可从中断处续传。",
    );
    throw err;
  }

  console.log("");
  console.log("全自动流程完成。");
  console.log(`产物目录：${projectDir}`);
}
