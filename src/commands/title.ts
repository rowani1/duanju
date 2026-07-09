import path from "node:path";
import * as p from "@clack/prompts";
import type { LanguageModel } from "ai";
import { createModel, mergeConfig, readGlobalConfig } from "../core/llm.js";
import { CliError } from "../core/errors.js";
import { runStage, type StageContext } from "../core/pipeline.js";
import {
  BLURB_FILE,
  missingHandoffFields,
  readArtifact,
  readProject,
  TITLES_FILE,
  writeArtifact,
  writeProject,
} from "../core/project.js";
import {
  backfillSelectedTitle,
  parseTitleCandidates,
  TITLE_STAGE,
  type TitleCandidates,
} from "../stages/title.js";
import { assertNotCancelled } from "../ui/prompts.js";
import { setupCustomKnowledge } from "./custom-knowledge.js";

const CUSTOM_OPTION = "__custom__";

export interface TitleOptions {
  /** 忽略已有 titles.md，重新生成 */
  force?: boolean;
  /**
   * 跳过交互选择，自动选定第一梯队第 1 个候选（CLI 标志 --yes）。
   * 调用约定：duanju run 全自动模式（M7）与测试注入均以 yes: true 复用本命令。
   */
  yes?: boolean;
  /** 自定义知识库目录（CLI --knowledge，相对路径相对当前工作目录） */
  knowledge?: string;
}

/** 交互选定：两梯队候选 + 手动输入兜底 */
async function promptSelect(candidates: TitleCandidates): Promise<string> {
  const options = [
    ...candidates.tier1.map((t) => ({ value: t, label: `一梯队：《${t}》` })),
    ...candidates.tier2.map((t) => ({ value: t, label: `二梯队：《${t}》` })),
    { value: CUSTOM_OPTION, label: "都不满意，手动输入书名" },
  ];
  const picked = assertNotCancelled(
    await p.select<string>({
      message: "请选定书名（第一梯队为优先推荐，理由见 titles.md）：",
      options,
    }),
  );
  if (picked !== CUSTOM_OPTION) return picked;

  for (;;) {
    const typed = assertNotCancelled(await p.text({ message: "输入书名（建议 8-22 字）" }));
    if (typed.trim()) return typed.trim();
  }
}

/**
 * duanju title：前置九字段校验 → 生成 titles.md（已存在则续用）→
 * 选定 → 回填 04-标题简介包.md 与 duanju.json（skill 回填协议）。
 * model 参数供测试注入。
 */
export async function runTitle(
  dir: string = process.cwd(),
  opts: TitleOptions = {},
  model?: LanguageModel,
): Promise<void> {
  const projectDir = path.resolve(dir);
  const project = readProject(projectDir);

  // 前置校验：九个交接字段齐全才可锻造书名（缺失不猜测，引导补跑）
  const missing = missingHandoffFields(project.handoff);
  if (missing.length > 0) {
    throw new CliError(
      `交接字段缺失：${missing.join("、")}。请先运行 duanju package 生成/补齐六包（必要时加 --force 重做）后再锻造书名。`,
    );
  }
  const blurb = readArtifact(projectDir, BLURB_FILE);
  if (blurb === null) {
    throw new CliError(`${BLURB_FILE} 不存在，书名选定后无法回填。请先运行 duanju package。`);
  }

  console.log(`项目：${path.basename(projectDir)}`);
  console.log(`题材：${project.idea}`);
  console.log("");

  // 前置解析并校验自定义知识库路径（续传分支也必须校验，坏路径不允许静默跳过）
  const custom = setupCustomKnowledge(opts.knowledge, projectDir, project);

  let titlesContent: string;
  const existing = opts.force ? null : readArtifact(projectDir, TITLES_FILE);
  if (existing !== null) {
    console.log(`${TITLES_FILE} 已存在，跳过生成（如需重新生成请加 --force）。`);
    titlesContent = existing;
  } else {
    const llm =
      model ??
      createModel(
        mergeConfig({
          projectOverride: project.modelOverride,
          global: readGlobalConfig() ?? undefined,
        }),
      );
    console.log(`正在生成书名候选（两梯队各 10 个）…`);
    const ctx: StageContext = { projectDir, project, prior: [], customKnowledgeRoot: custom.root };
    custom.announce(TITLE_STAGE.knowledgeFiles(ctx));
    const result = await runStage(llm, TITLE_STAGE, ctx);
    console.log(`${TITLES_FILE} 已生成${result.retried ? "（经一次自动重试）" : ""}。`);
    for (const warning of result.warnings) {
      console.log(`警告：${warning}`);
    }
    titlesContent = result.content;
  }

  const candidates = parseTitleCandidates(titlesContent);
  if (candidates === null || candidates.tier1.length === 0) {
    throw new CliError(
      `${TITLES_FILE} 中未解析到候选书名（缺少 <!-- titles --> 机器可读区块）。请运行 duanju title --force 重新生成。`,
    );
  }

  const selected = opts.yes ? candidates.tier1[0] : await promptSelect(candidates);
  if (opts.yes) {
    console.log(`已自动选定第一梯队第 1 个候选：《${selected}》。`);
  }

  // 回填协议：选定书名同步写入 duanju.json 与 04-标题简介包.md
  project.selectedTitle = selected;
  writeProject(projectDir, project);
  writeArtifact(projectDir, BLURB_FILE, backfillSelectedTitle(blurb, selected));

  console.log("");
  console.log(`已选定书名：《${selected}》，并回填 ${BLURB_FILE} 与 duanju.json。`);
  console.log("下一步：duanju write   # 开始逐章写作（流式输出）");
}
