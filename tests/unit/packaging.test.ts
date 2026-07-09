import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { knowledgeRoot, MAIN_CATEGORIES } from "../../src/core/knowledge.js";
import type { StageContext } from "../../src/core/pipeline.js";
import { HANDOFF_KEYS, PACKAGE_FILES } from "../../src/core/project.js";
import { PACKAGING_STAGES, RISK_REPORT_FILE } from "../../src/stages/packaging.js";

function ctxOf(mainCategory?: string): StageContext {
  return {
    projectDir: "/tmp/ignored",
    project: { idea: "测试题材", mainCategory, createdAt: "2026-07-08T00:00:00.000Z" },
    prior: [],
  };
}

function stageById(id: string) {
  const spec = PACKAGING_STAGES.find((s) => s.id === id);
  if (!spec) throw new Error(`未找到步骤 ${id}`);
  return spec;
}

describe("七步产物路径声明（与共享常量对齐）", () => {
  it("outputFile 顺序 = PACKAGE_FILES + 风险自检（package 按文件名归类产物，禁止漂移）", () => {
    expect(PACKAGING_STAGES.map((s) => s.outputFile)).toEqual([
      ...PACKAGE_FILES,
      RISK_REPORT_FILE,
    ]);
  });
});

describe("七步声明的知识文件全部真实存在（4 主类 × 7 步）", () => {
  const root = knowledgeRoot();

  for (const category of MAIN_CATEGORIES) {
    it(`主类「${category}」下所有步骤的知识路径可解析且存在`, () => {
      for (const spec of PACKAGING_STAGES) {
        for (const rel of spec.knowledgeFiles(ctxOf(category))) {
          const full = path.join(root, ...rel.split("/"));
          expect(existsSync(full), `${spec.id} 声明的 ${rel} 不存在`).toBe(true);
        }
      }
    });
  }

  it("主类缺失时步骤②起报中文错误引导重跑", () => {
    expect(() => stageById("package-02").knowledgeFiles(ctxOf(undefined))).toThrow(/主类/);
  });
});

describe("handoff 九字段恰好由步骤①②③收齐（协议回归）", () => {
  it("①+②+③ 的 handoffKeys 合计与九字段集合完全一致，无遗漏无多余无重复", () => {
    const collected = PACKAGING_STAGES.flatMap((s) => s.handoffKeys ?? []);
    expect(collected).toHaveLength(9);
    expect(new Set(collected).size).toBe(9);
    expect([...collected].sort()).toEqual([...HANDOFF_KEYS].sort());
  });

  it("④⑤⑥⑦ 不再声明 handoff 键", () => {
    for (const id of ["package-04", "package-05", "package-06", "package-07"]) {
      expect(stageById(id).handoffKeys ?? []).toHaveLength(0);
    }
  });
});

describe("章纲包章数约束（硬拦 0 与 >30，10-20 外警告）", () => {
  const stage06 = stageById("package-06");

  function outlineOf(n: number): string {
    const chapters = Array.from(
      { length: n },
      (_, i) => `### 第${i + 1}章 章题\n- 核心事件：事\n- 情绪点：爽\n- 反转点：转\n- 结尾钩子：钩`,
    );
    return `# 章纲包\n## 总纲\n主线\n## 10-20章分章表\n${chapters.join("\n")}`;
  }

  function problemsOf(n: number): string[] {
    return stage06.extraValidate?.(outlineOf(n), {}, ctxOf("总裁")) ?? [];
  }

  function warningsOf(n: number): string[] {
    return stage06.warnValidate?.(outlineOf(n), {}, ctxOf("总裁")) ?? [];
  }

  it("无分章表（0 章）→ 硬性校验失败", () => {
    const problems = stage06.extraValidate?.("# 章纲包\n## 总纲\n只有总纲", {}, ctxOf("总裁"));
    expect(problems).toHaveLength(1);
    expect(problems?.[0]).toContain("分章表");
  });

  it("超过 30 章 → 硬性校验失败（skill 硬限制收紧执行）", () => {
    expect(problemsOf(31).join()).toContain("30");
    expect(problemsOf(50).join()).toContain("50");
  });

  it("10-20 章 → 无问题无警告", () => {
    for (const n of [10, 15, 20]) {
      expect(problemsOf(n)).toEqual([]);
      expect(warningsOf(n)).toEqual([]);
    }
  });

  it("少于 10 章 → 通过但警告篇幅可能不足", () => {
    expect(problemsOf(5)).toEqual([]);
    expect(warningsOf(5).join()).toContain("低于目标区间");
  });

  it("21-30 章 → 通过但警告控制篇幅", () => {
    expect(problemsOf(25)).toEqual([]);
    expect(warningsOf(25).join()).toContain("超出目标区间");
  });
});

describe("段1 角色设定内置 skill 硬限制", () => {
  it("每个步骤的 rolePrompt 均含工作原则与硬限制关键句", () => {
    for (const spec of PACKAGING_STAGES) {
      const role = spec.rolePrompt(ctxOf("总裁"));
      expect(role).toContain("硬限制");
      expect(role).toContain("50 章以上");
      expect(role).toContain("高情绪、高冲突、高可视化、低改编成本");
      expect(role).toContain("慢热开篇");
    }
  });
});
