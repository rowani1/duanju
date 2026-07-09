import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTitle } from "../../src/commands/title.js";
import { createProject, readProject, writeProject } from "../../src/core/project.js";
import { scriptedModel } from "../helpers/scripted-model.js";

const tier1 = Array.from({ length: 10 }, (_, i) => `替嫁新娘马甲掉不停${String(i + 1).padStart(2, "0")}`);
const tier2 = Array.from({ length: 10 }, (_, i) => `首富爷爷婚礼认亲现场${String(i + 1).padStart(2, "0")}`);

const TITLES_OK = `# 书名候选
## 第一梯队（优先推荐）
${tier1.map((t, i) => `${i + 1}. 《${t}》——身份感：马甲直给；反转感：当场掀桌`).join("\n")}
## 第二梯队（备选）
${tier2.map((t, i) => `${i + 11}. 《${t}》——备选`).join("\n")}

<!-- titles
${tier1.map((t, i) => `一梯队${i + 1}: ${t}`).join("\n")}
${tier2.map((t, i) => `二梯队${i + 1}: ${t}`).join("\n")}
-->`;

const PKG04 = `# 标题简介包
## 书名候选
1. 初版候选
## 一句话卖点
婚礼当天，全城首富认她当继承人
## 简介版本
版本一
## 标签
替嫁、总裁
## 封面短句
替嫁三年，马甲藏不住了`;

const CUSTOM_MARK = "CUSTOM-KEYWORD-BANK-MARK-自定义词库独特标记";

let parentDir: string;
let projectDir: string;

function seedProject(): void {
  const project = readProject(projectDir);
  project.mainCategory = "总裁";
  project.subCategory = "替嫁婚约";
  project.handoff = {
    主类: "总裁",
    子类: "替嫁婚约",
    一句话选题: "替嫁新娘婚礼当天马甲掉落",
    核心卖点: "身份反转+替嫁+当众打脸",
    女主身份: "隐藏首富之女",
    男主身份: "集团总裁",
    核心关系: "契约替嫁夫妻",
    核心冲突: "替嫁真相与身份反转",
    最强反转: "女主才是隐藏首富",
  };
  writeProject(projectDir, project);
  writeFileSync(path.join(projectDir, "04-标题简介包.md"), PKG04, "utf-8");
}

/** 在项目目录旁建一个自定义知识库：只覆盖 title/references/keyword-bank.md */
function seedCustomKnowledge(): string {
  const customRoot = path.join(parentDir, "my-knowledge");
  mkdirSync(path.join(customRoot, "title", "references"), { recursive: true });
  writeFileSync(
    path.join(customRoot, "title", "references", "keyword-bank.md"),
    `# 自定义词库\n\n${CUSTOM_MARK}\n`,
    "utf-8",
  );
  return customRoot;
}

beforeEach(() => {
  parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-customkb-"));
  projectDir = createProject("总裁的替嫁新娘", parentDir);
  seedProject();
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("自定义知识库覆盖（MockLanguageModel，title 流程）", () => {
  it("项目 duanju.json 配置 knowledgePath（相对项目目录）：prompt 注入自定义内容并打印命中提示", async () => {
    seedCustomKnowledge();
    const project = readProject(projectDir);
    project.knowledgePath = "../my-knowledge";
    writeProject(projectDir, project);

    const logSpy = vi.spyOn(console, "log");
    const { model, prompts, calls } = scriptedModel([TITLES_OK]);
    await runTitle(projectDir, { yes: true }, model);

    expect(calls()).toBe(1);
    // 被覆盖的文件注入自定义内容，其余文件仍回落内置
    expect(prompts[0]).toContain(CUSTOM_MARK);
    expect(prompts[0]).toContain("naming-principles.md");
    expect(prompts[0]).toContain("rejection-rules.md");
    // 命令层的命中提示只打印一次且清单正确
    const hintLines = logSpy.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes("使用自定义知识文件"));
    expect(hintLines).toEqual([
      "使用自定义知识文件：title/references/keyword-bank.md（共 1 个）",
    ]);
  });

  it("CLI --knowledge 优先于项目配置：指向不存在目录时报错含路径与来源，不调模型", async () => {
    seedCustomKnowledge();
    const project = readProject(projectDir);
    project.knowledgePath = "../my-knowledge";
    writeProject(projectDir, project);

    const badDir = path.join(parentDir, "no-such-kb");
    const { model, calls } = scriptedModel([]);
    await expect(
      runTitle(projectDir, { yes: true, knowledge: badDir }, model),
    ).rejects.toThrow(/自定义知识库目录不存在.*来源：命令行参数/s);
    expect(calls()).toBe(0);
  });

  it("titles.md 已存在（续传分支）时坏路径同样前置报错，不静默跳过", async () => {
    writeFileSync(path.join(projectDir, "titles.md"), TITLES_OK, "utf-8");
    const badDir = path.join(parentDir, "no-such-kb");
    const { model, calls } = scriptedModel([]);
    await expect(
      runTitle(projectDir, { yes: true, knowledge: badDir }, model),
    ).rejects.toThrow(/自定义知识库目录不存在/);
    expect(calls()).toBe(0);
  });

  it("未配置 knowledgePath 时无命中提示、prompt 不含自定义标记（回归）", async () => {
    seedCustomKnowledge(); // 目录存在但未被任何配置引用
    const logSpy = vi.spyOn(console, "log");
    const { model, prompts } = scriptedModel([TITLES_OK]);
    await runTitle(projectDir, { yes: true }, model);

    expect(prompts[0]).not.toContain(CUSTOM_MARK);
    const hintLines = logSpy.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes("使用自定义知识文件"));
    expect(hintLines).toEqual([]);
  });
});
