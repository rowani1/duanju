import { describe, expect, it } from "vitest";
import {
  categorySegment,
  findCustomHits,
  knowledgeRoot,
  loadKnowledge,
  loadKnowledgeEx,
  MAIN_CATEGORIES,
} from "../../src/core/knowledge.js";
import type { StageContext, StageSpec } from "../../src/core/pipeline.js";
import { PACKAGING_STAGES } from "../../src/stages/packaging.js";
import { TITLE_STAGE } from "../../src/stages/title.js";
import { chapterStage, snapshotStage } from "../../src/stages/writing.js";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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

describe("loadKnowledgeEx 自定义知识库回落矩阵", () => {
  const withCustomRoot = (fn: (root: string) => void): void => {
    const root = mkdtempSync(path.join(os.tmpdir(), "duanju-custom-"));
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  it("同构文件命中时使用自定义版并记入 customHits", () => {
    withCustomRoot((root) => {
      mkdirSync(path.join(root, "title", "references"), { recursive: true });
      writeFileSync(
        path.join(root, "title", "references", "keyword-bank.md"),
        "CUSTOM-KEYWORD-MARK 自定义词库",
        "utf-8",
      );
      const result = loadKnowledgeEx(
        ["title/references/keyword-bank.md", "packaging/SKILL.md"],
        root,
      );
      expect(result.content).toContain("CUSTOM-KEYWORD-MARK");
      expect(result.customHits).toEqual(["title/references/keyword-bank.md"]);
      expect(result.warnings).toEqual([]);
      // 未命中的文件回落内置版
      expect(result.content).toContain("===== 知识文件：packaging/SKILL.md =====");
    });
  });

  it("未命中时全部回落内置，customHits 为空", () => {
    withCustomRoot((root) => {
      const result = loadKnowledgeEx(["packaging/SKILL.md"], root);
      expect(result.customHits).toEqual([]);
      expect(result.content).toBe(loadKnowledge(["packaging/SKILL.md"]));
    });
  });

  it("自定义文件为空时收集警告并按空内容注入", () => {
    withCustomRoot((root) => {
      mkdirSync(path.join(root, "packaging"), { recursive: true });
      writeFileSync(path.join(root, "packaging", "SKILL.md"), "   \n", "utf-8");
      const result = loadKnowledgeEx(["packaging/SKILL.md"], root);
      expect(result.customHits).toEqual(["packaging/SKILL.md"]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/自定义知识文件为空.*packaging\/SKILL\.md/);
      expect(result.content).toBe("===== 知识文件：packaging/SKILL.md =====\n\n");
    });
  });

  it("自定义目录中的多余文件被忽略", () => {
    withCustomRoot((root) => {
      writeFileSync(path.join(root, "多余文件.md"), "内置不认识", "utf-8");
      const result = loadKnowledgeEx(["packaging/SKILL.md"], root);
      expect(result.customHits).toEqual([]);
      expect(result.content).not.toContain("内置不认识");
    });
  });

  it("不传 customRoot 时行为与既有 loadKnowledge 完全一致", () => {
    const files = ["packaging/SKILL.md", "title/SKILL.md"];
    const result = loadKnowledgeEx(files);
    expect(result.customHits).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.content).toBe(loadKnowledge(files));
  });

  it("findCustomHits 仅探测存在性，保持 files 顺序", () => {
    withCustomRoot((root) => {
      mkdirSync(path.join(root, "title", "references"), { recursive: true });
      writeFileSync(path.join(root, "title", "references", "keyword-bank.md"), "x", "utf-8");
      expect(
        findCustomHits(["packaging/SKILL.md", "title/references/keyword-bank.md"], root),
      ).toEqual(["title/references/keyword-bank.md"]);
      expect(findCustomHits(["title/references/keyword-bank.md"], undefined)).toEqual([]);
    });
  });
});
