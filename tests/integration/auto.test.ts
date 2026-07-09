import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAuto } from "../../src/commands/run.js";
import { createProject, PACKAGE_FILES, readProject } from "../../src/core/project.js";
import { scriptedModel } from "../helpers/scripted-model.js";

// ---- 七步 package 合格输出（同 package.test 固定格式） ----

const R01 = `# 题材归类
- 主类：总裁
- 子类：替嫁婚约
- 短剧适配判断：适合，冲突集中场景成本低
- 风险：注意合同婚姻同质化

<!-- handoff
主类: 总裁
子类: 替嫁婚约
-->`;

const R02 = `# 题材包
- 一句话选题：替嫁新娘婚礼当天马甲掉落
- 核心卖点：身份反转+替嫁+当众打脸
- 目标情绪：爽
- 短剧化优势：高冲突强可视化
- 场景成本：低，婚礼与公司两景
- 风险点：反转过密需留缓冲

<!-- handoff
一句话选题: 替嫁新娘婚礼当天马甲掉落
核心卖点: 身份反转+替嫁+当众打脸
最强反转: 女主才是隐藏首富
-->`;

const R03 = `# 人设包
## 女主
- 身份：隐藏首富之女
- 初始状态：情绪隐忍，与男主为契约关系
## 男主
- 身份：集团总裁
- 初始状态：冷淡防备
## 反派/阻力角色
- 白莲花妹妹
## 关系链
女主-男主契约婚姻
## 核心冲突
替嫁真相与身份反转
## 角色禁忌
女主绝不下跪求情

<!-- handoff
女主身份: 隐藏首富之女
男主身份: 集团总裁
核心关系: 契约替嫁夫妻
核心冲突: 替嫁真相与身份反转
-->`;

const R04 = `# 标题简介包
## 书名候选
1. 替嫁新娘马甲掉了
## 一句话卖点
婚礼当天，全城首富认她当继承人
## 简介版本
MARK-BLURB 她替妹出嫁，被全场嘲讽……直到首富爷爷进场。
## 标签
替嫁、总裁、马甲
## 封面短句
替嫁三年，马甲藏不住了`;

const R05 = `# 开篇包
## 开篇场景
婚礼现场，新郎缺席
## 第一冲突
妹妹当众揭她替嫁身份
## 第一反转
首富爷爷进场喊她小姐
## 第一章章末钩子
男主突然出现说：婚礼继续
## 前3章推进
第1章冲突爆发，第2章契约谈判`;

const R06 = `# 章纲包
## 总纲
替嫁成婚 → 马甲渐掉 → 大结局
## 10-20章分章表
### 第1章 替嫁婚礼
- 核心事件：婚礼被搅局
- 情绪点：憋屈转爽
- 反转点：首富爷爷进场
- 结尾钩子：男主要求婚礼继续
### 第2章 契约夜谈
- 核心事件：两人立约
- 情绪点：张力拉扯
- 反转点：男主早知替嫁
- 结尾钩子：一纸股权协议`;

const R07 = `# 风险自检
## 自检结论
- 结论：通过
## 逐项排查
对照风险清单逐项检查，无命中
## 修订建议
无

<!-- revise
-->`;

// ---- title 合格输出（两梯队各 10 + titles 区块） ----

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

// ---- 正文与快照输出（--words 2500，体量控制在 ±15% 内） ----

const WORDS = 2500;
const PARA =
  "她攥紧请柬站在礼堂门口，妹妹的嘲笑像针一样扎过来，司仪第三次催促新娘入场，宾客的议论声浪一阵高过一阵。";
const REPEATS = Math.floor((WORDS - 150) / PARA.length);

const CH1 = `# 第1章 替嫁婚礼

MARK-CH1 ${PARA.repeat(REPEATS)}

${PARA} 他忽然出现在礼堂门口：婚礼继续。`;

const CH2 = `# 第2章 契约夜谈

MARK-CH2 ${PARA.repeat(REPEATS)}

${PARA} 一纸股权协议拍在桌上：签了它。`;

function snap(nextChapter: number, mark: string): string {
  return `# 角色状态快照 — 第${nextChapter}章开始前
## 女主：苏晚
- 当前身份：替嫁新娘
- 当前情绪：${mark} 憋屈转坚定
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
- 已知信息：替嫁安排
- 未知信息：姐姐身世
- 本章前最后一个动作：当众发难
## 伏笔池
| 伏笔 ID | 伏笔内容 | 埋入章节 | 预计揭示章节 | 状态 |
|---------|---------|---------|------------|------|
| F001 | 爷爷的认亲信物 | 第1章 | 第8章 | 未揭 |`;
}

const SNAP1 = snap(2, "MARK-SNAP1");
const SNAP2 = snap(3, "MARK-SNAP2");

/** 全流程 12 次调用：7 包 + 1 书名 + 2×（正文流式 + 快照） */
const FULL_OUTPUTS = [R01, R02, R03, R04, R05, R06, R07, TITLES_OK, CH1, SNAP1, CH2, SNAP2];
const RESUME_AFTER_R02 = [R03, R04, R05, R06, R07, TITLES_OK, CH1, SNAP1, CH2, SNAP2];

const IDEA = "总裁的替嫁新娘";
/** sanitizeProjectDirName(IDEA)：7 字无非法字符，目录名即题材 */
const DIR_NAME = IDEA;

let parentDir: string;
let logs: string[];

beforeEach(() => {
  parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-auto-"));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(parentDir, { recursive: true, force: true });
});

describe("duanju run --auto 全流程（MockLanguageModel）", () => {
  it("端到端：new → package → title → write 全部章 → export，产物齐全且步骤顺序正确", async () => {
    const { model, prompts, calls, kinds } = scriptedModel(FULL_OUTPUTS);
    await runAuto(IDEA, parentDir, { words: WORDS }, model);

    const projectDir = path.join(parentDir, DIR_NAME);
    expect(calls()).toBe(12);
    // 步骤顺序：7 包 + 1 书名走 generate，两章正文走 stream、各随一次快照 generate
    expect(kinds()).toEqual([
      ...Array.from({ length: 8 }, () => "generate"),
      "stream",
      "generate",
      "stream",
      "generate",
    ]);

    // 全部产物落盘
    for (const f of PACKAGE_FILES) {
      expect(existsSync(path.join(projectDir, f))).toBe(true);
    }
    expect(existsSync(path.join(projectDir, "07-风险自检.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "titles.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "chapters", "001.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "chapters", "002.md"))).toBe(true);
    expect(readFileSync(path.join(projectDir, "state", "characters.md"), "utf-8")).toContain(
      "MARK-SNAP2",
    );

    // title --yes 自动选第一梯队第 1 并回填
    expect(readProject(projectDir).selectedTitle).toBe(tier1[0]);

    // --words 透传 write：正文调用声明目标字数
    expect(prompts[8]).toContain(String(WORDS));

    // export --merged：书名命名，含书名/简介/两章，章题不重复
    const merged = path.join(projectDir, "exports", `${tier1[0]}.txt`);
    expect(existsSync(merged)).toBe(true);
    const text = readFileSync(merged, "utf-8");
    expect(text.startsWith(`${tier1[0]}\n`)).toBe(true);
    expect(text).toContain("MARK-BLURB");
    expect(text).toContain("MARK-CH1");
    expect(text).toContain("MARK-CH2");
    expect(text.match(/第1章 替嫁婚礼/g)).toHaveLength(1);
  });

  it("当前目录已是项目时复用并跳过 new", async () => {
    const projectDir = createProject(IDEA, parentDir);
    const { model, calls } = scriptedModel(FULL_OUTPUTS);
    await runAuto(undefined, projectDir, { words: WORDS }, model);

    expect(calls()).toBe(12);
    expect(logs.some((l) => l.includes("复用"))).toBe(true);
    expect(existsSync(path.join(projectDir, "exports", `${tier1[0]}.txt`))).toBe(true);
    // 未在项目目录下再嵌套建项目
    expect(existsSync(path.join(projectDir, DIR_NAME))).toBe(false);
  });

  it("不是项目且未给题材时中文报错", async () => {
    const { model, calls } = scriptedModel([]);
    await expect(runAuto(undefined, parentDir, {}, model)).rejects.toThrow("题材");
    expect(calls()).toBe(0);
  });

  it("中途失败：现场保留、打印续传提示、错误上抛（非零退出由入口兜底）", async () => {
    const { model } = scriptedModel([R01, R02, new Error("模拟 API 限流")]);
    await expect(runAuto(IDEA, parentDir, {}, model)).rejects.toThrow("模拟 API 限流");

    const projectDir = path.join(parentDir, DIR_NAME);
    // 已完成产物保留，未完成不落盘
    expect(existsSync(path.join(projectDir, "01-题材归类.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "02-题材包.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "03-人设包.md"))).toBe(false);
    // 中文续传提示
    expect(logs.some((l) => l.includes("已保留"))).toBe(true);
    expect(logs.some((l) => l.includes("run --auto"))).toBe(true);
    expect(logs.some((l) => l.includes("续传"))).toBe(true);
  });

  it("重跑续传：跳过已完成步骤，只补剩余调用；完成后再重跑零调用", async () => {
    // 第一轮：在 03 处注错中断
    const failing = scriptedModel([R01, R02, new Error("模拟 API 限流")]);
    await expect(runAuto(IDEA, parentDir, { words: WORDS }, failing.model)).rejects.toThrow(
      "模拟 API 限流",
    );

    // 第二轮：同题材同目录重跑 → 检测既有项目目录复用，package 跳过 01/02
    const resumed = scriptedModel(RESUME_AFTER_R02);
    await runAuto(IDEA, parentDir, { words: WORDS }, resumed.model);

    const projectDir = path.join(parentDir, DIR_NAME);
    expect(resumed.calls()).toBe(10);
    // 既有产物未被重写
    expect(readFileSync(path.join(projectDir, "01-题材归类.md"), "utf-8")).toBe(`${R01}\n`);
    expect(readProject(projectDir).selectedTitle).toBe(tier1[0]);
    expect(existsSync(path.join(projectDir, "exports", `${tier1[0]}.txt`))).toBe(true);

    // 第三轮：全部完成后重跑，除本地导出外零模型调用
    const idle = scriptedModel([]);
    await runAuto(IDEA, parentDir, { words: WORDS }, idle.model);
    expect(idle.calls()).toBe(0);
    // 导出重跑对同名文件先备份
    const files = readdirSync(path.join(projectDir, "exports"));
    expect(files.some((f) => /\.txt\.bak-\d{8}-\d{6}$/.test(f))).toBe(true);
  });
});
