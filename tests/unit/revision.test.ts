import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { knowledgeRoot, MAIN_CATEGORIES } from "../../src/core/knowledge.js";
import type { StageContext } from "../../src/core/pipeline.js";
import {
  isRevisionMode,
  REVISION_MODES,
  revisionCharBand,
  revisionStage,
  type RevisionMaterials,
} from "../../src/stages/revision.js";
import { CHAPTER_MIN_CHARS } from "../../src/stages/writing.js";

describe("修订模式校验", () => {
  it("四模式合法", () => {
    expect(REVISION_MODES).toEqual(["改写", "扩写", "润色", "重写节奏"]);
    for (const mode of REVISION_MODES) {
      expect(isRevisionMode(mode)).toBe(true);
    }
  });

  it("其余取值非法", () => {
    for (const bad of ["重写", "expand", "润 色", "", "续写", "新写"]) {
      expect(isRevisionMode(bad)).toBe(false);
    }
  });
});

describe("revisionCharBand 目标字数区间", () => {
  it("扩写为原文 1.3-1.5 倍", () => {
    expect(revisionCharBand("扩写", 1000)).toEqual({ min: 1300, max: 1500 });
  });

  it("其他模式保持原文 ±15%", () => {
    expect(revisionCharBand("润色", 1000)).toEqual({ min: 850, max: 1150 });
    expect(revisionCharBand("改写", 2000)).toEqual({ min: 1700, max: 2300 });
    expect(revisionCharBand("重写节奏", 3000)).toEqual({ min: 2550, max: 3450 });
  });
});

describe("revisionStage 声明", () => {
  const materials: RevisionMaterials = {
    chapter: 2,
    mode: "扩写",
    original: "# 第2章 契约夜谈\n\nMARK-ORIGINAL 他把协议拍在桌上。",
    originalChars: 2000,
    outline: "### 第2章 契约夜谈\n- 核心事件：MARK-OUTLINE 两人立约\n- 结尾钩子：一纸股权协议",
    note: "MARK-NOTE 强化对峙",
  };
  const ctx: StageContext = {
    projectDir: "",
    project: { idea: "总裁的替嫁新娘", mainCategory: "总裁", createdAt: "" },
    prior: [],
  };

  it("知识注入：revision-modes + prose-style-guide + 主类 story-patterns", () => {
    expect(revisionStage(materials).knowledgeFiles(ctx)).toEqual([
      "writing/references/revision-modes.md",
      "writing/references/prose-style-guide.md",
      "writing/references/zongcai-story-patterns.md",
    ]);
  });

  it("用户消息含原文/模式说明/章纲/补充要求/目标字数", () => {
    const prompt = revisionStage(materials).userPrompt(ctx);
    expect(prompt).toContain("MARK-ORIGINAL");
    expect(prompt).toContain("扩写：");
    expect(prompt).toContain("MARK-OUTLINE");
    expect(prompt).toContain("MARK-NOTE");
    expect(prompt).toContain("2600-3000 字"); // 2000 字原文的 1.3-1.5 倍
  });

  it("章纲与补充要求缺省时对应段落省略", () => {
    const prompt = revisionStage({ ...materials, outline: null, note: undefined }).userPrompt(ctx);
    expect(prompt).not.toContain("本章章纲");
    expect(prompt).not.toContain("补充要求");
  });

  it("结构校验放宽：无必需小节，仅字数硬下限走 extraValidate", () => {
    const spec = revisionStage(materials);
    expect(spec.requiredSections).toEqual([]);
    const short = "太短。";
    expect(spec.extraValidate?.(short, {}, ctx)).toHaveLength(1);
    expect(spec.extraValidate?.(short, {}, ctx)?.[0]).toContain(String(CHAPTER_MIN_CHARS));
    const long = "字".repeat(CHAPTER_MIN_CHARS + 500);
    expect(spec.extraValidate?.(long, {}, ctx)).toEqual([]);
  });

  it("软校验：偏离目标区间给警告，区间内不警告", () => {
    const spec = revisionStage({ ...materials, mode: "润色" }); // 2000 字 → 1700-2300
    expect(spec.warnValidate?.("字".repeat(1200), {}, ctx)).toHaveLength(1);
    expect(spec.warnValidate?.("字".repeat(2000), {}, ctx)).toEqual([]);
  });

  it("知识注入文件在 4 主类下全部真实存在", () => {
    const root = knowledgeRoot();
    for (const category of MAIN_CATEGORIES) {
      const catCtx: StageContext = {
        projectDir: "",
        project: { idea: "测试题材", mainCategory: category, createdAt: "" },
        prior: [],
      };
      for (const rel of revisionStage(materials).knowledgeFiles(catCtx)) {
        expect(existsSync(path.join(root, ...rel.split("/"))), `${category} 的 ${rel} 不存在`).toBe(
          true,
        );
      }
    }
  });
});
