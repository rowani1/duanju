#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { AISDKError } from "ai";
import { runConfigWizard } from "./commands/config.js";
import { runExport } from "./commands/export.js";
import { runNew } from "./commands/new.js";
import { runPackage } from "./commands/package.js";
import { runRevise } from "./commands/revise.js";
import { runAuto } from "./commands/run.js";
import { runStatus } from "./commands/status.js";
import { runTitle } from "./commands/title.js";
import { runWrite } from "./commands/write.js";
import { CliError } from "./core/errors.js";
import { REVISION_MODES } from "./stages/revision.js";
import { CHAPTER_MIN_CHARS } from "./stages/writing.js";

/** 版本号唯一来源：package.json（dist/index.js 与 src/index.ts 相对包根均为一级目录） */
const { version: VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const program = new Command();

program
  .name("duanju")
  .description("短剧向女频短故事生成命令行工具")
  .version(VERSION, "-V, --version", "显示版本号")
  .helpOption("-h, --help", "显示帮助")
  .helpCommand("help [命令]", "显示指定命令的帮助")
  .showHelpAfterError("（提示：运行 duanju 不带参数可查看中文命令总览，或 duanju <命令> --help 查看该命令用法。）");

program
  .command("config")
  .description("交互式配置模型厂商 / API Key / 模型（保存前发送测试消息验证连通）")
  .action(async () => {
    await runConfigWizard();
  });

program
  .command("new")
  .description("创建新的故事项目目录")
  .argument("<题材>", "题材一句话，如：总裁的替嫁新娘")
  .action((idea: string) => {
    runNew(idea);
  });

program
  .command("package")
  .description("生成六包（题材归类 → 章纲包）+ 风险自检；已有产物自动续传")
  .argument("[目录]", "项目目录，默认当前目录")
  .option("--force", "忽略已有产物，全部重新生成")
  .option("--yes", "跳过逐包交互确认，自动接受生成结果")
  .option("--knowledge <路径>", "自定义知识库目录（按文件覆盖内置知识库，相对路径相对当前目录）")
  .action(async (dir: string | undefined, options: { force?: boolean; yes?: boolean; knowledge?: string }) => {
    await runPackage(dir, { force: options.force, yes: options.yes, knowledge: options.knowledge });
  });

program
  .command("title")
  .description("生成 20 个书名候选（两梯队+理由），选定后回填 04-标题简介包.md 与 duanju.json")
  .argument("[目录]", "项目目录，默认当前目录")
  .option("--force", "忽略已有 titles.md，重新生成")
  .option("--yes", "跳过交互选择，自动选定第一梯队第 1 个候选")
  .option("--knowledge <路径>", "自定义知识库目录（按文件覆盖内置知识库，相对路径相对当前目录）")
  .action(async (dir: string | undefined, options: { force?: boolean; yes?: boolean; knowledge?: string }) => {
    await runTitle(dir, { force: options.force, yes: options.yes, knowledge: options.knowledge });
  });

program
  .command("write")
  .description("逐章生成正文（流式输出）；带章号则重写指定章（覆盖前自动备份）")
  .argument("[章号]", "要重写的章号；省略则写下一未完成章")
  .option("--yes", "跳过字数偏差询问，自动接受")
  .option("--knowledge <路径>", "自定义知识库目录（按文件覆盖内置知识库，相对路径相对当前目录）")
  .action(async (num: string | undefined, options: { yes?: boolean; knowledge?: string }) => {
    let chapter: number | undefined;
    if (num !== undefined) {
      chapter = Number(num);
      if (!Number.isInteger(chapter) || chapter < 1) {
        throw new CliError("章号必须是正整数，如：duanju write 3");
      }
    }
    await runWrite(undefined, { chapter, yes: options.yes, knowledge: options.knowledge });
  });

program
  .command("revise")
  .description(`按指定模式修订章节正文（${REVISION_MODES.join(" / ")}），覆盖前自动备份`)
  .argument("<章号>", "要修订的章号，如 3")
  .option("--mode <模式>", `修订模式：${REVISION_MODES.join(" / ")}`)
  .option("--note <要求>", "补充修订要求（可选）")
  .option("--yes", "跳过交互（不询问是否更新角色状态快照）")
  .option("--knowledge <路径>", "自定义知识库目录（按文件覆盖内置知识库，相对路径相对当前目录）")
  .action(async (num: string, options: { mode?: string; note?: string; yes?: boolean; knowledge?: string }) => {
    const chapter = Number(num);
    if (!Number.isInteger(chapter) || chapter < 1) {
      throw new CliError("章号必须是正整数，如：duanju revise 3 --mode 润色");
    }
    await runRevise(chapter, undefined, {
      mode: options.mode,
      note: options.note,
      yes: options.yes,
      knowledge: options.knowledge,
    });
  });

program
  .command("export")
  .description("导出成书 txt（纯本地，不调模型）：--merged 整本合并（默认）/ --chapters 分章")
  .argument("[目录]", "项目目录，默认当前目录")
  .option("--merged", "导出整本合并 txt（书名 + 简介 + 全部章节）")
  .option("--chapters", "每章导出一个 txt 到 exports/chapters/")
  .action((dir: string | undefined, options: { merged?: boolean; chapters?: boolean }) => {
    runExport(dir, { merged: options.merged, chapters: options.chapters });
  });

program
  .command("status")
  .description("展示项目进度与下一步建议（纯本地）")
  .argument("[目录]", "项目目录，默认当前目录")
  .action((dir?: string) => {
    runStatus(dir);
  });

program
  .command("run")
  .description("全自动模式：串联 new → package → title → write 全部章 → export --merged（须加 --auto 启动）")
  .argument("[题材]", "题材一句话；当前目录已是项目时可省略")
  .option("--auto", "确认启动全自动模式（必填，防止误触发连续调用模型）")
  .option("--words <字数>", "单章目标字数，透传给 write")
  .option("--knowledge <路径>", "自定义知识库目录（按文件覆盖内置知识库，相对路径相对当前目录）")
  .action(async (idea: string | undefined, options: { auto?: boolean; words?: string; knowledge?: string }) => {
    if (!options.auto) {
      console.log(
        "duanju run 是全自动模式：不加交互确认地连续调用模型，串联 new → package → title → write 全部章 → export，会产生持续的 API 费用。",
      );
      console.log('确认无误后加 --auto 启动：duanju run --auto "<题材一句话>"');
      console.log("如需分步可控地推进，请使用 duanju package / title / write / export。");
      return;
    }
    let words: number | undefined;
    if (options.words !== undefined) {
      words = Number(options.words);
      if (!Number.isInteger(words) || words < CHAPTER_MIN_CHARS) {
        throw new CliError(`目标字数必须是不小于 ${CHAPTER_MIN_CHARS} 的整数，如：--words 2500`);
      }
    }
    await runAuto(idea, undefined, { words, knowledge: options.knowledge });
  });

/** 不带子命令时的中文帮助概览：典型流程 + 命令清单（描述取自各命令注册，单一来源） */
function printOverview(): void {
  const lines = [
    `duanju v${VERSION} — 短剧向女频短故事创作命令行工具`,
    "",
    "从一句话题材到可投稿的成书 txt，典型流程：",
    "  1. duanju config              首次使用：配置 AI 模型（OpenAI / Claude / Gemini / DeepSeek 等）",
    '  2. duanju new "<题材一句话>"    创建作品项目，然后 cd 进入项目目录',
    "  3. duanju package             生成六包（题材归类 → 章纲包）+ 风险自检",
    "  4. duanju title               生成书名候选并选定",
    "  5. duanju write               逐章生成正文（重复运行直到写完）",
    "  6. duanju export              导出成书 txt，即可投稿",
    "",
    "全部命令：",
  ];
  const width = Math.max(...program.commands.map((cmd) => cmd.name().length)) + 3;
  for (const cmd of program.commands) {
    lines.push(`  ${cmd.name().padEnd(width)}${cmd.description()}`);
  }
  lines.push("");
  lines.push("查看单个命令的参数：duanju <命令> --help（如 duanju write --help）");
  console.log(lines.join("\n"));
}

// 不带任何参数时显示中文概览（而非英文 Usage 帮助），正常退出
if (process.argv.slice(2).length === 0) {
  printOverview();
} else {
  program.parseAsync(process.argv).catch((err: unknown) => {
    process.exitCode = 1;
    // 已知业务错误：中文提示自带下一步建议，直接展示
    if (err instanceof CliError) {
      console.error(`出错了：${err.message}`);
      return;
    }
    // 模型/网络类错误（AI SDK 抛出）：附排查建议与续传提示
    if (AISDKError.isInstance(err)) {
      console.error(`模型调用失败：${err.message}`);
      console.error(
        "建议检查：1) API Key 是否有效、账户是否有余额；2) 模型名称是否可用；3) 网络/代理是否可达；" +
          "4) openai-compatible 的 baseURL 是否正确（通常以 /v1 结尾）。可运行 duanju config 重新验证配置。",
      );
      console.error("已生成的产物已保留在项目目录，修复后重新运行原命令可从中断处续传。");
      return;
    }
    // 意外异常（程序缺陷/环境问题）：与用户错误区分展示
    const brief = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`意外错误：${brief}`);
    console.error(
      "这不是预期中的使用错误，可能是程序缺陷或运行环境问题。已生成的产物已保留，重新运行命令可续传；若反复出现请携带以上信息反馈。",
    );
  });
}
