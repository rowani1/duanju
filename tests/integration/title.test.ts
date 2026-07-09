import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** 缺第二梯队分节与区块键：触发结构校验失败 → 带反馈重试 */
const TITLES_BAD = `# 书名候选
## 第一梯队（优先推荐）
${tier1.map((t, i) => `${i + 1}. 《${t}》——身份感：马甲直给`).join("\n")}

<!-- titles
${tier1.map((t, i) => `一梯队${i + 1}: ${t}`).join("\n")}
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

let parentDir: string;
let projectDir: string;

/** 造一个九字段齐全、04 已生成的项目 */
function seedProject(handoffOverride?: Record<string, string | undefined>): void {
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
    最强反转: "女主才是隐藏首富 MARK-HANDOFF",
    ...handoffOverride,
  } as typeof project.handoff;
  writeProject(projectDir, project);
  writeFileSync(path.join(projectDir, "04-标题简介包.md"), PKG04, "utf-8");
}

beforeEach(() => {
  parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-title-"));
  projectDir = createProject("总裁的替嫁新娘", parentDir);
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
});

describe("duanju title（MockLanguageModel，--yes）", () => {
  it("九字段齐全时生成 titles.md，自动选定一梯队第 1 个并回填 04 与 duanju.json", async () => {
    seedProject();
    const { model, prompts, calls } = scriptedModel([TITLES_OK]);
    await runTitle(projectDir, { yes: true }, model);

    expect(calls()).toBe(1);
    // 知识按主类动态注入 + 交接字段进上下文
    expect(prompts[0]).toContain("zongcai-title-patterns.md");
    expect(prompts[0]).toContain("naming-principles.md");
    expect(prompts[0]).toContain("rejection-rules.md");
    expect(prompts[0]).toContain("MARK-HANDOFF");

    expect(existsSync(path.join(projectDir, "titles.md"))).toBe(true);
    // 回填协议：duanju.json + 04-标题简介包.md
    expect(readProject(projectDir).selectedTitle).toBe(tier1[0]);
    const pkg04 = readFileSync(path.join(projectDir, "04-标题简介包.md"), "utf-8");
    expect(pkg04).toContain("## 选定书名");
    expect(pkg04).toContain(`《${tier1[0]}》`);
  });

  it("交接字段缺失时直接报错引导补跑 package，不调模型", async () => {
    seedProject({ 女主身份: undefined, 最强反转: undefined });
    const { model, calls } = scriptedModel([]);
    await expect(runTitle(projectDir, { yes: true }, model)).rejects.toThrow(/交接字段缺失.*女主身份.*最强反转.*duanju package/s);
    expect(calls()).toBe(0);
  });

  it("titles.md 已存在时跳过生成，直接选定回填", async () => {
    seedProject();
    writeFileSync(path.join(projectDir, "titles.md"), TITLES_OK, "utf-8");
    const { model, calls } = scriptedModel([]);
    await runTitle(projectDir, { yes: true }, model);
    expect(calls()).toBe(0);
    expect(readProject(projectDir).selectedTitle).toBe(tier1[0]);
  });

  it("首版缺第二梯队时带反馈自动重试一次", async () => {
    seedProject();
    const { model, prompts, calls } = scriptedModel([TITLES_BAD, TITLES_OK]);
    await runTitle(projectDir, { yes: true }, model);
    expect(calls()).toBe(2);
    expect(prompts[1]).toContain("存在以下问题");
    expect(prompts[1]).toContain("第二梯队");
    expect(readProject(projectDir).selectedTitle).toBe(tier1[0]);
  });

  it("04 未生成时报错引导补跑 package", async () => {
    const project = readProject(projectDir);
    project.handoff = {
      主类: "总裁", 子类: "替嫁婚约", 一句话选题: "x", 核心卖点: "x", 女主身份: "x",
      男主身份: "x", 核心关系: "x", 核心冲突: "x", 最强反转: "x",
    };
    writeProject(projectDir, project);
    const { model, calls } = scriptedModel([]);
    await expect(runTitle(projectDir, { yes: true }, model)).rejects.toThrow("04-标题简介包.md");
    expect(calls()).toBe(0);
  });
});
