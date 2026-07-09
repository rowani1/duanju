import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRevise } from "../../src/commands/revise.js";
import { createProject, readProject, writeProject } from "../../src/core/project.js";
import { scriptedModel } from "../helpers/scripted-model.js";

/** 交互 confirm 打桩（仅"更新快照"选项会用到；--yes 路径不触发） */
const clack = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@clack/prompts", () => ({
  confirm: clack.confirm,
  isCancel: () => false,
}));

const PARA =
  "她攥紧请柬站在礼堂门口，妹妹的嘲笑像针一样扎过来，司仪第三次催促新娘入场，宾客的议论声浪一阵高过一阵。";

/** 章正文体量 ~1200 字：高于硬下限 1000，修订前后同体量（±15% 内不触发软警告） */
const BODY = PARA.repeat(24);

const CH1 = `# 第1章 替嫁婚礼\n\nMARK-CH1-ORIGINAL ${BODY}`;
const CH2 = `# 第2章 契约夜谈\n\nMARK-CH2-ORIGINAL ${BODY}`;
const CH1_REVISED = `# 第1章 替嫁婚礼\n\nMARK-CH1-REVISED ${BODY}`;
const CH2_REVISED = `# 第2章 契约夜谈\n\nMARK-CH2-REVISED ${BODY}`;

const PERSONA = `# 人设包
## 女主
- 身份：隐藏首富之女 MARK-PERSONA
- 初始状态：情绪隐忍
## 男主
- 身份：集团总裁
- 初始状态：冷淡防备`;

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

const SNAP = `# 角色状态快照 — 第3章开始前
## 女主：苏晚
- 当前身份：替嫁新娘
- 当前情绪：MARK-SNAP-NEW 坚定
- 当前关系位置：
  - 与男主：契约同盟
- 已知信息：自己的真实身世
- 未知信息：男主早知替嫁
- 本章前最后一个动作：收下股权协议
## 男主：陆霆
- 当前身份：集团总裁
- 当前情绪：动摇
- 当前关系位置：
  - 与女主：试探
- 已知信息：替嫁真相
- 未知信息：女主身世
- 本章前最后一个动作：递出协议
## 核心反派：苏甜
- 当前身份：妹妹
- 当前情绪：不甘
- 已知信息：替嫁安排
- 未知信息：姐姐身世
- 本章前最后一个动作：偷听夜谈
## 伏笔池
| 伏笔 ID | 伏笔内容 | 埋入章节 | 预计揭示章节 | 状态 |
|---------|---------|---------|------------|------|
| F001 | 爷爷的认亲信物 | 第1章 | 第8章 | 未揭 |`;

let parentDir: string;
let projectDir: string;
let logs: string[];

beforeEach(() => {
  parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-revise-"));
  projectDir = createProject("总裁的替嫁新娘", parentDir);
  const project = readProject(projectDir);
  project.mainCategory = "总裁";
  writeProject(projectDir, project);
  writeFileSync(path.join(projectDir, "03-人设包.md"), PERSONA, "utf-8");
  writeFileSync(path.join(projectDir, "06-章纲包.md"), OUTLINE, "utf-8");
  writeFileSync(path.join(projectDir, "chapters", "001.md"), CH1, "utf-8");
  writeFileSync(path.join(projectDir, "chapters", "002.md"), CH2, "utf-8");

  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  clack.confirm.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(parentDir, { recursive: true, force: true });
});

describe("duanju revise（MockLanguageModel）", () => {
  it("修订早期章：备份原文 + 纯正文落盘 + 原文/模式/章纲/note 进 prompt，快照不动", async () => {
    const { model, prompts, calls, kinds } = scriptedModel([CH1_REVISED]);
    await runRevise(1, projectDir, { mode: "改写", note: "MARK-NOTE 强化对峙", yes: true }, model);

    expect(calls()).toBe(1);
    expect(kinds()).toEqual(["stream"]); // 修订走流式输出

    // 上下文：原文 + 本章章纲块 + 补充要求 + 按主类知识注入
    expect(prompts[0]).toContain("MARK-CH1-ORIGINAL");
    expect(prompts[0]).toContain("MARK-OUT1");
    expect(prompts[0]).not.toContain("MARK-OUT2");
    expect(prompts[0]).toContain("MARK-NOTE");
    expect(prompts[0]).toContain("revision-modes.md");
    expect(prompts[0]).toContain("prose-style-guide.md");
    expect(prompts[0]).toContain("zongcai-story-patterns.md");

    // 覆盖前备份 .bak-<时间戳>，新正文落盘
    const files = readdirSync(path.join(projectDir, "chapters"));
    const backup = files.find((f) => /^001\.md\.bak-\d{8}-\d{6}$/.test(f));
    expect(backup).toBeDefined();
    expect(readFileSync(path.join(projectDir, "chapters", backup!), "utf-8")).toContain(
      "MARK-CH1-ORIGINAL",
    );
    expect(readFileSync(path.join(projectDir, "chapters", "001.md"), "utf-8")).toContain(
      "MARK-CH1-REVISED",
    );

    // 早期章不动快照
    expect(existsSync(path.join(projectDir, "state", "characters.md"))).toBe(false);
    expect(logs.some((l) => l.includes("不是最新章"))).toBe(true);
  });

  it("修订最新章（--yes）：提示快照基于原文，但不更新快照", async () => {
    const { model, calls } = scriptedModel([CH2_REVISED]);
    await runRevise(2, projectDir, { mode: "润色", yes: true }, model);

    expect(calls()).toBe(1);
    expect(logs.some((l) => l.includes("建议重跑快照"))).toBe(true);
    expect(existsSync(path.join(projectDir, "state", "characters.md"))).toBe(false);
    expect(clack.confirm).not.toHaveBeenCalled();
  });

  it("修订最新章（交互）：选择更新快照 → 复用写作快照 Stage 落盘", async () => {
    clack.confirm.mockResolvedValue(true);
    const { model, prompts, calls, kinds } = scriptedModel([CH2_REVISED, SNAP]);
    await runRevise(2, projectDir, { mode: "重写节奏" }, model);

    expect(calls()).toBe(2);
    expect(kinds()).toEqual(["stream", "generate"]);
    // 快照调用：携带追踪模板 + 修订后的正文
    expect(prompts[1]).toContain("character-state-tracker.md");
    expect(prompts[1]).toContain("MARK-CH2-REVISED");
    expect(readFileSync(path.join(projectDir, "state", "characters.md"), "utf-8")).toContain(
      "MARK-SNAP-NEW",
    );
  });

  it("非法/缺失 mode 中文报错并列出四模式，不调模型、不动原文", async () => {
    const { model, calls } = scriptedModel([]);
    await expect(runRevise(1, projectDir, { mode: "重写", yes: true }, model)).rejects.toThrow(
      /改写 \/ 扩写 \/ 润色 \/ 重写节奏/,
    );
    await expect(runRevise(1, projectDir, { yes: true }, model)).rejects.toThrow("--mode");
    expect(calls()).toBe(0);
    expect(readFileSync(path.join(projectDir, "chapters", "001.md"), "utf-8")).toBe(CH1);
    expect(readdirSync(path.join(projectDir, "chapters"))).toHaveLength(2); // 无备份产生
  });

  it("章节不存在时中文报错，不调模型", async () => {
    const { model, calls } = scriptedModel([]);
    await expect(runRevise(9, projectDir, { mode: "润色", yes: true }, model)).rejects.toThrow(
      "第 9 章不存在",
    );
    expect(calls()).toBe(0);
  });
});
