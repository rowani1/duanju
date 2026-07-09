import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWrite } from "../../src/commands/write.js";
import { createProject, readProject, writeProject } from "../../src/core/project.js";
import { CHAPTER_TARGET_CHARS } from "../../src/stages/writing.js";
import { scriptedModel } from "../helpers/scripted-model.js";

const PARA =
  "她攥紧请柬站在礼堂门口，妹妹的嘲笑像针一样扎过来，司仪第三次催促新娘入场，宾客的议论声浪一阵高过一阵。";

/** 正文体量：控制在目标字数 ±15% 区间内（预留 ~150 字给标记与收尾句） */
const REPEATS = Math.floor((CHAPTER_TARGET_CHARS - 150) / PARA.length);

const CH1 = `# 第1章 替嫁婚礼

MARK-CH1-HEAD ${PARA.repeat(REPEATS)}

${PARA} MARK-CH1-TAIL 他忽然出现在礼堂门口，声音冷得像刀：婚礼继续。`;

const CH2 = `# 第2章 契约夜谈

MARK-CH2-HEAD ${PARA.repeat(REPEATS)}

${PARA} MARK-CH2-TAIL 一纸股权协议拍在桌上，他说：签了它。`;

/** 低于目标 ±15% 但高于硬下限：触发字数警告而非自动重试 */
const CH1_SHORT = `# 第1章 替嫁婚礼

${PARA.repeat(Math.floor((CHAPTER_TARGET_CHARS * 0.5) / PARA.length))}`;

const SNAP1 = `# 角色状态快照 — 第2章开始前
## 女主：苏晚
- 当前身份：替嫁新娘
- 当前情绪：MARK-SNAP1 憋屈转坚定
- 当前关系位置：
  - 与男主：对立试探
- 已知信息：自己的真实身世
- 未知信息：男主早知替嫁
- 本章前最后一个动作：接过婚戒
## 男主：陆霆
- 当前身份：集团总裁
- 当前情绪：防备
- 当前关系位置：
  - 与女主：试探
- 已知信息：替嫁真相
- 未知信息：女主身世
- 本章前最后一个动作：宣布婚礼继续
## 核心反派：苏甜
- 当前身份：妹妹
- 当前情绪：不甘
- 当前威胁等级：中
- 已知信息：替嫁安排
- 未知信息：姐姐身世
- 本章前最后一个动作：当众发难
## 伏笔池
| 伏笔 ID | 伏笔内容 | 埋入章节 | 预计揭示章节 | 状态 |
|---------|---------|---------|------------|------|
| F001 | 爷爷的认亲信物 | 第1章 | 第8章 | 未揭 |`;

const SNAP2 = SNAP1.replace("第2章开始前", "第3章开始前").replace("MARK-SNAP1", "MARK-SNAP2");

const PERSONA = `# 人设包
## 女主
- 身份：隐藏首富之女 MARK-PERSONA
- 初始状态：情绪隐忍，与男主为契约关系
## 男主
- 身份：集团总裁
- 初始状态：冷淡防备
## 反派/阻力角色
- 白莲花妹妹
## 关系链
契约婚姻
## 核心冲突
替嫁真相与身份反转
## 角色禁忌
女主绝不下跪求情`;

const OPENING = `# 开篇包
## 开篇场景
MARK-OPENING 婚礼现场，新郎缺席
## 第一冲突
妹妹当众揭她替嫁身份`;

const OUTLINE = `# 章纲包
## 总纲
替嫁成婚 → 马甲渐掉 → 大结局
## 10-20章分章表
### 第1章 替嫁婚礼
- 核心事件：MARK-OUT1 婚礼被搅局
- 情绪点：憋屈转爽
- 反转点：首富爷爷进场
- 结尾钩子：男主要求婚礼继续
### 第2章 契约夜谈
- 核心事件：MARK-OUT2 两人立约
- 情绪点：张力拉扯
- 反转点：男主早知替嫁
- 结尾钩子：一纸股权协议`;

let parentDir: string;
let projectDir: string;

function seedWriteProject(): void {
  const project = readProject(projectDir);
  project.mainCategory = "总裁";
  project.selectedTitle = "替嫁新娘马甲掉不停";
  writeProject(projectDir, project);
  writeFileSync(path.join(projectDir, "03-人设包.md"), PERSONA, "utf-8");
  writeFileSync(path.join(projectDir, "05-开篇包.md"), OPENING, "utf-8");
  writeFileSync(path.join(projectDir, "06-章纲包.md"), OUTLINE, "utf-8");
}

beforeEach(() => {
  parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-write-"));
  projectDir = createProject("总裁的替嫁新娘", parentDir);
  seedWriteProject();
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("duanju write（MockLanguageModel，--yes）", () => {
  it("连续两章：正文流式 + 快照更新，第 2 章上下文含上章尾部与快照、不含上章全文", async () => {
    // ---- 第 1 章 ----
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const m1 = scriptedModel([CH1, SNAP1]);
    await runWrite(projectDir, { yes: true }, m1.model);
    const streamedCalls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    stdoutSpy.mockRestore();

    expect(m1.calls()).toBe(2);
    // 正文走流式（调用 A），快照走非流式（调用 B）
    expect(m1.kinds()).toEqual(["stream", "generate"]);
    // 流式渲染：正文以多个增量块写到终端
    expect(streamedCalls.join("")).toContain("MARK-CH1-HEAD");
    expect(streamedCalls.length).toBeGreaterThan(5);

    // 第 1 章上下文：人设包 + 本章章纲 + 开篇包；无快照、无上章尾部
    expect(m1.prompts[0]).toContain("MARK-PERSONA");
    expect(m1.prompts[0]).toContain("MARK-OUT1");
    expect(m1.prompts[0]).not.toContain("MARK-OUT2"); // 只带本章章纲块
    expect(m1.prompts[0]).toContain("MARK-OPENING");
    expect(m1.prompts[0]).toContain("zongcai-story-patterns.md"); // 知识按主类注入
    // 快照调用：携带追踪模板与本章正文
    expect(m1.prompts[1]).toContain("character-state-tracker.md");
    expect(m1.prompts[1]).toContain("MARK-CH1-TAIL");

    expect(readFileSync(path.join(projectDir, "chapters", "001.md"), "utf-8")).toContain("MARK-CH1-HEAD");
    expect(readFileSync(path.join(projectDir, "state", "characters.md"), "utf-8")).toContain("MARK-SNAP1");

    // ---- 第 2 章（无参自动写下一章）----
    const stdoutSpy2 = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const m2 = scriptedModel([CH2, SNAP2]);
    await runWrite(projectDir, { yes: true }, m2.model);
    stdoutSpy2.mockRestore();

    expect(m2.kinds()).toEqual(["stream", "generate"]);
    expect(m2.prompts[0]).toContain("MARK-CH1-TAIL"); // 上一章尾部 500 字
    expect(m2.prompts[0]).toContain("MARK-SNAP1"); // 角色状态快照
    expect(m2.prompts[0]).toContain("MARK-OUT2"); // 本章章纲块
    expect(m2.prompts[0]).not.toContain("MARK-CH1-HEAD"); // token 防线：不携带上章全文
    expect(m2.prompts[0]).not.toContain("MARK-OPENING"); // 开篇包仅第 1 章注入
    expect(existsSync(path.join(projectDir, "chapters", "002.md"))).toBe(true);
    expect(readFileSync(path.join(projectDir, "state", "characters.md"), "utf-8")).toContain("MARK-SNAP2");
  });

  it("字数偏差超 ±15% 触发警告（--yes 自动接受，仍更新快照）", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { model, calls } = scriptedModel([CH1_SHORT, SNAP1]);
    await runWrite(projectDir, { yes: true }, model);

    expect(logs.some((l) => l.includes("字数偏差超限"))).toBe(true);
    expect(calls()).toBe(2);
    expect(existsSync(path.join(projectDir, "chapters", "001.md"))).toBe(true);
  });

  it("write <n> 重写指定章：覆盖前生成 .bak-<时间戳> 备份", async () => {
    writeFileSync(path.join(projectDir, "chapters", "001.md"), CH1, "utf-8");
    writeFileSync(path.join(projectDir, "state", "characters.md"), SNAP1, "utf-8");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const CH1_REWRITE = CH1.replace("MARK-CH1-HEAD", "MARK-CH1-REWRITE");
    const { model, prompts } = scriptedModel([CH1_REWRITE, SNAP1]);
    await runWrite(projectDir, { chapter: 1, yes: true }, model);

    // 重写最新章：快照照常注入与更新
    expect(prompts[0]).toContain("MARK-SNAP1");
    const files = readdirSync(path.join(projectDir, "chapters"));
    const backup = files.find((f) => /^001\.md\.bak-\d{8}-\d{6}$/.test(f));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(projectDir, "chapters", backup!), "utf-8")).toContain("MARK-CH1-HEAD");
    expect(readFileSync(path.join(projectDir, "chapters", "001.md"), "utf-8")).toContain("MARK-CH1-REWRITE");
  });

  it("章号越界与跳章写作被拦截，不调模型", async () => {
    const { model, calls } = scriptedModel([]);
    await expect(runWrite(projectDir, { chapter: 3, yes: true }, model)).rejects.toThrow("1-2");
    await expect(runWrite(projectDir, { chapter: 2, yes: true }, model)).rejects.toThrow("按顺序");
    expect(calls()).toBe(0);
  });

  it("全部章节完成后提示导出，不再调模型", async () => {
    writeFileSync(path.join(projectDir, "chapters", "001.md"), CH1, "utf-8");
    writeFileSync(path.join(projectDir, "chapters", "002.md"), CH2, "utf-8");
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const { model, calls } = scriptedModel([]);
    await runWrite(projectDir, { yes: true }, model);
    expect(calls()).toBe(0);
    expect(logs.some((l) => l.includes("duanju export"))).toBe(true);
  });
});
