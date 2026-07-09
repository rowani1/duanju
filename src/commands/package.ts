import path from "node:path";
import * as p from "@clack/prompts";
import type { LanguageModel } from "ai";
import { createModel, mergeConfig, readGlobalConfig } from "../core/llm.js";
import {
  parseCommentBlock,
  runStage,
  type StageContext,
  type StageSpec,
} from "../core/pipeline.js";
import {
  mergeHandoff,
  PACKAGE_FILES,
  readArtifact,
  readProject,
  writeProject,
  type DuanjuProject,
} from "../core/project.js";
import {
  PACKAGING_STAGES,
  REVISE_BLOCK_TAG,
  RISK_REPORT_FILE,
  stageByOutputFile,
} from "../stages/packaging.js";
import { assertNotCancelled } from "../ui/prompts.js";

export interface PackageOptions {
  /** 忽略已有产物，七步全部重新生成 */
  force?: boolean;
  /**
   * 跳过逐包交互确认，自动接受生成结果（CLI 标志 --yes）。
   * 调用约定：duanju run 全自动模式（M7）与测试注入均以 yes: true 复用本命令。
   */
  yes?: boolean;
}

interface Artifact {
  file: string;
  content: string;
}

/** 将 handoff 键值合并进项目元数据并落盘（主类/子类同步到顶层字段） */
function absorbHandoff(
  projectDir: string,
  project: DuanjuProject,
  handoff: Record<string, string>,
): void {
  project.handoff = mergeHandoff(project.handoff, handoff);
  if (handoff["主类"]?.trim()) project.mainCategory = handoff["主类"].trim();
  if (handoff["子类"]?.trim()) project.subCategory = handoff["子类"].trim();
  writeProject(projectDir, project);
}

/** 生成一个 Stage 并走交互确认循环（确认 / 重写 / 手改后继续），返回最终产物内容 */
async function generateWithConfirm(
  model: LanguageModel,
  spec: StageSpec,
  projectDir: string,
  project: DuanjuProject,
  prior: Artifact[],
  opts: PackageOptions,
  initialNote?: string,
): Promise<string> {
  let reviseNote = initialNote;

  for (;;) {
    const ctx: StageContext = { projectDir, project, prior, reviseNote };
    const spinner = opts.yes ? null : p.spinner();
    if (spinner) {
      spinner.start(`正在生成 ${spec.outputFile}…`);
    } else {
      console.log(`正在生成 ${spec.outputFile}…`);
    }

    let result;
    try {
      result = await runStage(model, spec, ctx);
    } catch (err) {
      spinner?.stop(`${spec.outputFile} 生成失败。`, 1);
      throw err;
    }
    spinner?.stop(`${spec.outputFile} 已生成${result.retried ? "（经一次自动重试）" : ""}。`);
    if (opts.yes) {
      console.log(`${spec.outputFile} 已生成${result.retried ? "（经一次自动重试）" : ""}。`);
    }
    for (const warning of result.warnings) {
      console.log(`警告：${warning}`);
    }

    absorbHandoff(projectDir, project, result.handoff);

    if (opts.yes) return result.content;

    const action = assertNotCancelled(
      await p.select<"accept" | "rewrite" | "manual">({
        message: `「${spec.label}」已写入 ${spec.outputFile}，请审阅后选择：`,
        options: [
          { value: "accept", label: "确认，继续下一步" },
          { value: "rewrite", label: "重写本包" },
          { value: "manual", label: "我已手动修改文件，继续" },
        ],
      }),
    );

    if (action === "accept") return result.content;

    if (action === "manual") {
      for (;;) {
        const done = assertNotCancelled(
          await p.confirm({ message: `已完成对 ${spec.outputFile} 的手动修改？` }),
        );
        if (done) break;
      }
      const edited = (readArtifact(projectDir, spec.outputFile) ?? result.content).trim();
      absorbHandoff(projectDir, project, parseCommentBlock(edited, "handoff") ?? {});
      return edited;
    }

    // rewrite：可附带要求后重新生成
    const note = assertNotCancelled(
      await p.text({
        message: "重写要求（可留空直接回车）",
        defaultValue: "",
      }),
    );
    reviseNote = note.trim() || undefined;
  }
}

/** 风险自检回改：解析 revise 区块，对被点名的包带修订建议重新生成（仅一轮） */
async function applyRiskRevisions(
  model: LanguageModel,
  riskContent: string,
  projectDir: string,
  project: DuanjuProject,
  artifacts: Artifact[],
  opts: PackageOptions,
): Promise<void> {
  const revise = parseCommentBlock(riskContent, REVISE_BLOCK_TAG) ?? {};
  const entries = Object.entries(revise).filter(([file]) =>
    (PACKAGE_FILES as readonly string[]).includes(file),
  );
  if (entries.length === 0) {
    console.log("风险自检通过，无需修订。");
    return;
  }

  console.log(`风险自检建议修订 ${entries.length} 个包：`);
  for (const [file, note] of entries) {
    console.log(`  - ${file}：${note}`);
  }

  for (const [file, note] of entries) {
    const spec = stageByOutputFile(file);
    if (!spec) continue;

    if (!opts.yes) {
      const apply = assertNotCancelled(
        await p.confirm({ message: `按建议重新生成 ${file}？（选否则保留现版本）` }),
      );
      if (!apply) continue;
    }

    const index = PACKAGING_STAGES.indexOf(spec);
    const prior = artifacts.slice(0, index);
    const content = await generateWithConfirm(
      model,
      spec,
      projectDir,
      project,
      prior,
      opts,
      `风险自检指出：${note}。请在保持整体设定一致的前提下修订。`,
    );
    artifacts[index] = { file, content };
  }
}

/**
 * duanju package：七步生成六包 + 风险自检。
 * 已存在的产物默认跳过（续传），--force 全部重做；model 参数供测试注入。
 */
export async function runPackage(
  dir: string = process.cwd(),
  opts: PackageOptions = {},
  model?: LanguageModel,
): Promise<void> {
  const projectDir = path.resolve(dir);
  const project = readProject(projectDir);
  const llm =
    model ??
    createModel(
      mergeConfig({
        projectOverride: project.modelOverride,
        global: readGlobalConfig() ?? undefined,
      }),
    );

  console.log(`项目：${path.basename(projectDir)}`);
  console.log(`题材：${project.idea}`);
  console.log("");

  const artifacts: Artifact[] = [];
  let riskContent: string | undefined;
  let riskFreshlyGenerated = false;

  for (const spec of PACKAGING_STAGES) {
    const existing = opts.force ? null : readArtifact(projectDir, spec.outputFile);

    let content: string;
    if (existing !== null) {
      content = existing.trim();
      // 续传自愈：从已有产物重新吸收 handoff，避免 duanju.json 落后于手改
      absorbHandoff(projectDir, project, parseCommentBlock(content, "handoff") ?? {});
      console.log(`${spec.outputFile} 已存在，跳过（续传；如需重做请加 --force）。`);
    } else {
      content = await generateWithConfirm(llm, spec, projectDir, project, [...artifacts], opts);
      if (spec.outputFile === RISK_REPORT_FILE) riskFreshlyGenerated = true;
    }

    if ((PACKAGE_FILES as readonly string[]).includes(spec.outputFile)) {
      artifacts.push({ file: spec.outputFile, content });
    } else {
      riskContent = content;
    }
  }

  if (riskContent && riskFreshlyGenerated) {
    await applyRiskRevisions(llm, riskContent, projectDir, project, artifacts, opts);
  }

  console.log("");
  console.log("六包 + 风险自检已完成。");
  console.log("下一步：duanju title   # 生成 20 个书名候选并选定");
}
