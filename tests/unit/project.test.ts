import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PACKAGE_FILES,
  chapterFileName,
  countOutlineChapters,
  inferProgress,
  listChapters,
  readProject,
  sanitizeProjectDirName,
  writeProject,
  type DuanjuProject,
} from "../../src/core/project.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "duanju-proj-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function baseProject(extra: Partial<DuanjuProject> = {}): DuanjuProject {
  return { idea: "总裁的替嫁新娘", createdAt: "2026-07-08T00:00:00.000Z", ...extra };
}

describe("duanju.json 读写", () => {
  it("写入后读回一致", () => {
    const proj = baseProject({ mainCategory: "总裁", selectedTitle: "替嫁新娘" });
    writeProject(tmpDir, proj);
    expect(readProject(tmpDir)).toEqual(proj);
  });

  it("duanju.json 不存在时抛中文错误提示 duanju new", () => {
    expect(() => readProject(tmpDir)).toThrow(/duanju new/);
  });

  it("duanju.json 损坏（非法 JSON）时抛中文错误", () => {
    writeFileSync(path.join(tmpDir, "duanju.json"), "{broken", "utf-8");
    expect(() => readProject(tmpDir)).toThrow(/不是合法 JSON/);
  });

  it("duanju.json 缺少 idea 字段时抛中文错误", () => {
    writeFileSync(path.join(tmpDir, "duanju.json"), JSON.stringify({ foo: 1 }), "utf-8");
    expect(() => readProject(tmpDir)).toThrow(/idea/);
  });
});

describe("目录名清洗", () => {
  it("取题材前几个字", () => {
    expect(sanitizeProjectDirName("总裁的替嫁新娘她马甲掉了一地惊呆全场")).toBe(
      "总裁的替嫁新娘她马甲",
    );
  });

  it("过滤 Windows 非法路径字符", () => {
    expect(sanitizeProjectDirName('替嫁<>:"/\\|?*新娘')).toBe("替嫁新娘");
  });

  it("去除首尾空格与点", () => {
    expect(sanitizeProjectDirName("  .替嫁新娘. ")).toBe("替嫁新娘");
  });

  it("清洗后为空时回落默认名", () => {
    expect(sanitizeProjectDirName("???***")).toBe("未命名项目");
  });
});

describe("章节文件", () => {
  it("编号 001 起三位数", () => {
    expect(chapterFileName(1)).toBe("001.md");
    expect(chapterFileName(12)).toBe("012.md");
    expect(chapterFileName(123)).toBe("123.md");
  });

  it("枚举 chapters/ 下的 NNN.md 并按编号排序", () => {
    mkdirSync(path.join(tmpDir, "chapters"));
    for (const f of ["002.md", "001.md", "010.md", "notes.txt", "3.md"]) {
      writeFileSync(path.join(tmpDir, "chapters", f), "x", "utf-8");
    }
    expect(listChapters(tmpDir).map((c) => c.num)).toEqual([1, 2, 10]);
  });

  it("chapters/ 不存在时返回空数组", () => {
    expect(listChapters(tmpDir)).toEqual([]);
  });
});

describe("章纲总章数解析", () => {
  it("取分章表中最大章号", () => {
    const content = "## 分章表\n\n### 第1章\n…\n### 第2章\n…\n### 第12章\n…";
    expect(countOutlineChapters(content)).toBe(12);
  });

  it("无章号时返回 0", () => {
    expect(countOutlineChapters("## 总纲\n只有总纲")).toBe(0);
  });
});

describe("进度推断矩阵", () => {
  it("空项目 → 下一步 duanju package", () => {
    writeProject(tmpDir, baseProject());
    const prog = inferProgress(tmpDir);
    expect(prog.packages.every((s) => !s.done)).toBe(true);
    expect(prog.packagesDone).toBe(false);
    expect(prog.nextCommand).toBe("duanju package");
  });

  it("六包部分完成 → 仍是 duanju package", () => {
    writeProject(tmpDir, baseProject());
    for (const f of PACKAGE_FILES.slice(0, 3)) {
      writeFileSync(path.join(tmpDir, f), "# 内容", "utf-8");
    }
    const prog = inferProgress(tmpDir);
    expect(prog.packages.filter((s) => s.done)).toHaveLength(3);
    expect(prog.nextCommand).toBe("duanju package");
  });

  it("六包齐全未选书名 → duanju title", () => {
    writeProject(tmpDir, baseProject());
    for (const f of PACKAGE_FILES) {
      writeFileSync(path.join(tmpDir, f), "### 第10章", "utf-8");
    }
    const prog = inferProgress(tmpDir);
    expect(prog.packagesDone).toBe(true);
    expect(prog.nextCommand).toBe("duanju title");
  });

  it("titles.md 已生成但未选定 → 仍是 duanju title", () => {
    writeProject(tmpDir, baseProject());
    for (const f of PACKAGE_FILES) writeFileSync(path.join(tmpDir, f), "x", "utf-8");
    writeFileSync(path.join(tmpDir, "titles.md"), "# 候选", "utf-8");
    const prog = inferProgress(tmpDir);
    expect(prog.titlesGenerated).toBe(true);
    expect(prog.titleSelected).toBe(false);
    expect(prog.nextCommand).toBe("duanju title");
  });

  it("已选书名、章节写到一半 → duanju write，并报告 已写/总章数", () => {
    writeProject(tmpDir, baseProject({ selectedTitle: "替嫁新娘" }));
    for (const f of PACKAGE_FILES) writeFileSync(path.join(tmpDir, f), "x", "utf-8");
    writeFileSync(
      path.join(tmpDir, "06-章纲包.md"),
      "### 第1章\n### 第2章\n### 第3章\n### 第4章",
      "utf-8",
    );
    writeFileSync(path.join(tmpDir, "titles.md"), "# 候选", "utf-8");
    mkdirSync(path.join(tmpDir, "chapters"));
    writeFileSync(path.join(tmpDir, "chapters", "001.md"), "第一章", "utf-8");
    writeFileSync(path.join(tmpDir, "chapters", "002.md"), "第二章", "utf-8");
    const prog = inferProgress(tmpDir);
    expect(prog.chaptersWritten).toBe(2);
    expect(prog.totalChapters).toBe(4);
    expect(prog.nextCommand).toBe("duanju write");
  });

  it("全部章节完成 → duanju export", () => {
    writeProject(tmpDir, baseProject({ selectedTitle: "替嫁新娘" }));
    for (const f of PACKAGE_FILES) writeFileSync(path.join(tmpDir, f), "x", "utf-8");
    writeFileSync(path.join(tmpDir, "06-章纲包.md"), "### 第1章\n### 第2章", "utf-8");
    writeFileSync(path.join(tmpDir, "titles.md"), "x", "utf-8");
    mkdirSync(path.join(tmpDir, "chapters"));
    writeFileSync(path.join(tmpDir, "chapters", "001.md"), "x", "utf-8");
    writeFileSync(path.join(tmpDir, "chapters", "002.md"), "x", "utf-8");
    const prog = inferProgress(tmpDir);
    expect(prog.nextCommand).toBe("duanju export");
  });
});
