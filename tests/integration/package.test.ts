import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPackage } from "../../src/commands/package.js";
import { createProject, missingHandoffFields, readProject, PACKAGE_FILES } from "../../src/core/project.js";
import { RISK_REPORT_FILE } from "../../src/stages/packaging.js";
import { scriptedModel } from "../helpers/scripted-model.js";

/** 七步各自的合格 mock 输出（满足必需小节 + handoff/revise 区块） */
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
- 核心卖点：身份反转+替嫁+当众打脸（MARK-R02）
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
- 初始状态：情绪隐忍，与男主为契约关系，未知男主真实身份
## 男主
- 身份：集团总裁
- 初始状态：冷淡防备，误以为女主贪财
## 反派/阻力角色
- 白莲花妹妹
## 关系链
女主-男主契约婚姻，妹妹从中作梗
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
版本一：她替妹出嫁，被全场嘲讽……直到首富爷爷进场。
## 标签
替嫁、总裁、马甲
## 封面短句
替嫁三年，马甲藏不住了`;

const R05 = `# 开篇包
## 开篇场景
婚礼现场，新郎缺席，司仪催促
## 第一冲突
妹妹当众揭她替嫁身份
## 第一反转
首富爷爷进场喊她小姐
## 第一章章末钩子
男主突然出现说：婚礼继续
## 前3章推进
第1章冲突爆发，第2章契约谈判，第3章身份试探`;

const R06 = `# 章纲包
## 总纲
替嫁成婚 → 马甲渐掉 → 真心浮现 → 首富身份公开大结局
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

const R07_PASS = `# 风险自检
## 自检结论
- 结论：通过
## 逐项排查
对照风险清单逐项检查，无命中
## 修订建议
无

<!-- revise
-->`;

const R07_FLAG = `# 风险自检
## 自检结论
- 结论：需修订
## 逐项排查
题材包卖点存在空泛表述
## 修订建议
02-题材包.md 的核心卖点需改为可执行三连钩

<!-- revise
02-题材包.md: 核心卖点空泛，改为可执行三连钩
-->`;

const R02_REVISED = R02.replace("MARK-R02", "MARK-R02-REVISED");

let parentDir: string;
let projectDir: string;

beforeEach(() => {
  parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-pkg-"));
  projectDir = createProject("总裁的替嫁新娘", parentDir);
});

afterEach(() => {
  rmSync(parentDir, { recursive: true, force: true });
});

describe("duanju package 全流程（MockLanguageModel，--auto）", () => {
  it("七步依次生成六包 + 风险自检，handoff 九字段齐全", async () => {
    const { model, prompts, calls } = scriptedModel([R01, R02, R03, R04, R05, R06, R07_PASS]);
    await runPackage(projectDir, { yes: true }, model);

    expect(calls()).toBe(7);
    for (const f of PACKAGE_FILES) {
      expect(existsSync(path.join(projectDir, f))).toBe(true);
    }
    expect(existsSync(path.join(projectDir, RISK_REPORT_FILE))).toBe(true);

    const project = readProject(projectDir);
    expect(project.mainCategory).toBe("总裁");
    expect(project.subCategory).toBe("替嫁婚约");
    expect(missingHandoffFields(project.handoff)).toEqual([]);

    // 知识按主类动态注入：步骤②携带 zongcai-subtypes
    expect(prompts[1]).toContain("zongcai-subtypes.md");
    // 上下文逐步累积：步骤③携带步骤②产物
    expect(prompts[2]).toContain("MARK-R02");
    // 风险自检携带全部六包
    expect(prompts[6]).toContain("章纲包");
  });

  it("风险自检点名修订 → 自动带建议回改对应包", async () => {
    const { model, prompts, calls } = scriptedModel([
      R01, R02, R03, R04, R05, R06, R07_FLAG, R02_REVISED,
    ]);
    await runPackage(projectDir, { yes: true }, model);

    expect(calls()).toBe(8);
    // 第 8 次调用是 02 的回改，携带风险自检建议
    expect(prompts[7]).toContain("风险自检指出");
    expect(prompts[7]).toContain("三连钩");
    const content02 = readFileSync(path.join(projectDir, "02-题材包.md"), "utf-8");
    expect(content02).toContain("MARK-R02-REVISED");
  });
});

describe("duanju package 续传与 --force", () => {
  it("已有 01/02 时跳过并自愈 handoff，只调剩余五步", async () => {
    writeFileSync(path.join(projectDir, "01-题材归类.md"), R01, "utf-8");
    writeFileSync(path.join(projectDir, "02-题材包.md"), R02, "utf-8");

    const { model, calls } = scriptedModel([R03, R04, R05, R06, R07_PASS]);
    await runPackage(projectDir, { yes: true }, model);

    expect(calls()).toBe(5);
    // 既有产物未被改写
    expect(readFileSync(path.join(projectDir, "01-题材归类.md"), "utf-8")).toBe(R01);
    // handoff 从既有产物自愈进 duanju.json
    const project = readProject(projectDir);
    expect(project.mainCategory).toBe("总裁");
    expect(project.handoff?.["最强反转"]).toBe("女主才是隐藏首富");
  });

  it("API 失败中断后重跑，从未完成步骤继续", async () => {
    const failing = scriptedModel([R01, R02, new Error("模拟 API 限流")]);
    await expect(runPackage(projectDir, { yes: true }, failing.model)).rejects.toThrow(
      "模拟 API 限流",
    );
    // 已完成的两步保留
    expect(existsSync(path.join(projectDir, "01-题材归类.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "02-题材包.md"))).toBe(true);
    expect(existsSync(path.join(projectDir, "03-人设包.md"))).toBe(false);

    const resumed = scriptedModel([R03, R04, R05, R06, R07_PASS]);
    await runPackage(projectDir, { yes: true }, resumed.model);
    expect(resumed.calls()).toBe(5);
    expect(existsSync(path.join(projectDir, RISK_REPORT_FILE))).toBe(true);
  });

  it("--force 忽略既有产物，七步全部重做", async () => {
    const first = scriptedModel([R01, R02, R03, R04, R05, R06, R07_PASS]);
    await runPackage(projectDir, { yes: true }, first.model);

    const second = scriptedModel([R01, R02, R03, R04, R05, R06, R07_PASS]);
    await runPackage(projectDir, { yes: true, force: true }, second.model);
    expect(second.calls()).toBe(7);
  });

  it("结构不合格的输出触发带反馈重试后继续走完", async () => {
    const bad01 = "# 题材归类\n- 主类：总裁";
    const { model, prompts, calls } = scriptedModel([
      bad01, R01, R02, R03, R04, R05, R06, R07_PASS,
    ]);
    await runPackage(projectDir, { yes: true }, model);
    expect(calls()).toBe(8);
    expect(prompts[1]).toContain("存在以下问题");
  });
});
