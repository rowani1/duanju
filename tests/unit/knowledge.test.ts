import { describe, expect, it } from "vitest";
import {
  categorySegment,
  knowledgeRoot,
  loadKnowledge,
  MAIN_CATEGORIES,
} from "../../src/core/knowledge.js";
import type { StageContext, StageSpec } from "../../src/core/pipeline.js";
import { PACKAGING_STAGES } from "../../src/stages/packaging.js";
import { TITLE_STAGE } from "../../src/stages/title.js";
import { chapterStage, snapshotStage } from "../../src/stages/writing.js";
import { existsSync } from "node:fs";
import path from "node:path";

describe("主类 → 文件名段映射", () => {
  it("四大主类映射正确", () => {
    expect(categorySegment("总裁")).toBe("zongcai");
    expect(categorySegment("古言")).toBe("guyan");
    expect(categorySegment("女频现实情感")).toBe("female-realistic");
    expect(categorySegment("年代/穿越")).toBe("niandai");
  });

  it("未知主类抛中文错误", () => {
    expect(() => categorySegment("科幻")).toThrow(/主类/);
  });

  it("MAIN_CATEGORIES 恰含四大主类", () => {
    expect(MAIN_CATEGORIES).toHaveLength(4);
  });
});

describe("知识库根定位", () => {
  it("指向仓库内 knowledge/ 目录且存在", () => {
    const root = knowledgeRoot();
    expect(path.basename(root)).toBe("knowledge");
    expect(existsSync(path.join(root, "packaging", "SKILL.md"))).toBe(true);
  });
});

describe("loadKnowledge 拼接", () => {
  it("按相对路径读取并以分隔标题拼接，保持顺序", () => {
    const out = loadKnowledge(["packaging/SKILL.md", "title/SKILL.md"]);
    const i1 = out.indexOf("packaging/SKILL.md");
    const i2 = out.indexOf("title/SKILL.md");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(out).toContain("===== 知识文件");
    expect(out.length).toBeGreaterThan(500);
  });

  it("按主类段名可加载对应知识文件", () => {
    const seg = categorySegment("总裁");
    const out = loadKnowledge([`packaging/references/${seg}-subtypes.md`]);
    expect(out).toContain("zongcai-subtypes.md");
  });

  it("文件不存在时抛含路径的中文错误", () => {
    expect(() => loadKnowledge(["packaging/references/不存在.md"])).toThrow(/不存在\.md/);
    expect(() => loadKnowledge(["packaging/references/不存在.md"])).toThrow(/知识文件/);
  });
});

describe("Stage 知识声明 × 四大主类：文件必须都在 knowledge/ 中（跨层契约回归）", () => {
  const allStages = (): StageSpec[] => [
    ...PACKAGING_STAGES,
    TITLE_STAGE,
    chapterStage({
      chapter: 2,
      outline: "### 第2章",
      persona: "人设",
      snapshot: null,
      prevTail: null,
      opening: null,
      targetChars: 3000,
    }),
    snapshotStage({ chapter: 2, persona: "人设", previousSnapshot: null, chapterText: "正文" }),
  ];

  it.each(MAIN_CATEGORIES)("主类「%s」下所有 Stage 声明的知识文件存在", (category) => {
    const ctx: StageContext = {
      projectDir: "/tmp",
      project: {
        idea: "测试题材",
        mainCategory: category,
        handoff: { 主类: category },
        createdAt: new Date().toISOString(),
      },
      prior: [],
    };
    const root = knowledgeRoot();
    for (const stage of allStages()) {
      const files = stage.knowledgeFiles(ctx);
      expect(files.length).toBeGreaterThan(0);
      for (const rel of files) {
        expect(
          existsSync(path.join(root, ...rel.split("/"))),
          `Stage「${stage.id}」在主类「${category}」下声明的知识文件缺失：${rel}`,
        ).toBe(true);
      }
    }
  });
});
