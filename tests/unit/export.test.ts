import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMergedText,
  chapterExportName,
  chapterPlainText,
  extractBlurb,
  extractChapterTitle,
  runExport,
} from "../../src/commands/export.js";
import { createProject, readProject, writeProject } from "../../src/core/project.js";

const PKG04 = `# 标题简介包
## 书名候选
1. 初版候选
## 一句话卖点
婚礼当天，全城首富认她当继承人
## 简介版本
版本一：她替妹出嫁，被全场嘲讽……直到首富爷爷进场。
版本二：替嫁三年，马甲藏不住了。
## 标签
替嫁、总裁`;

describe("extractBlurb 简介提取", () => {
  it("提取「简介版本」小节正文，止于下一标题", () => {
    const blurb = extractBlurb(PKG04);
    expect(blurb).toContain("版本一：她替妹出嫁");
    expect(blurb).toContain("版本二");
    expect(blurb).not.toContain("标签");
    expect(blurb).not.toContain("一句话卖点");
  });

  it("小节缺失或为空时返回 null（提取失败跳过）", () => {
    expect(extractBlurb("# 标题简介包\n## 标签\n替嫁")).toBeNull();
    expect(extractBlurb("## 简介版本\n\n## 标签\n替嫁")).toBeNull();
    expect(extractBlurb("")).toBeNull();
  });
});

describe("extractChapterTitle 章题提取", () => {
  it("从首个标题行提取章题", () => {
    expect(extractChapterTitle("# 第1章 替嫁婚礼\n\n正文")).toBe("替嫁婚礼");
    expect(extractChapterTitle("\n\n## 第 12 章 认亲现场\n正文")).toBe("认亲现场");
  });

  it("无章题或非章标题行返回 null", () => {
    expect(extractChapterTitle("# 第1章\n正文")).toBeNull();
    expect(extractChapterTitle("直接正文开头")).toBeNull();
    expect(extractChapterTitle("")).toBeNull();
  });
});

describe("chapterPlainText 章正文转纯文本", () => {
  it("正文已含章题标题行：去掉 # 前缀，不重复加分隔行", () => {
    const text = chapterPlainText("# 第1章 替嫁婚礼\n\n她攥紧请柬。", 1);
    expect(text).toBe("第1章 替嫁婚礼\n\n她攥紧请柬。");
    expect(text.match(/第1章/g)).toHaveLength(1);
  });

  it("正文首行已是纯文本章题：原样保留", () => {
    const text = chapterPlainText("第2章 契约夜谈\n\n他把协议拍在桌上。", 2);
    expect(text).toBe("第2章 契约夜谈\n\n他把协议拍在桌上。");
  });

  it("正文未含章题：补一行「第N章」分隔", () => {
    const text = chapterPlainText("她攥紧请柬站在礼堂门口。", 3);
    expect(text).toBe("第3章\n\n她攥紧请柬站在礼堂门口。");
  });
});

describe("buildMergedText 整本合并", () => {
  const chapters = [
    { num: 1, content: "# 第1章 替嫁婚礼\n\n她攥紧请柬。" },
    { num: 2, content: "他把协议拍在桌上。" },
  ];

  it("书名 + 简介 + 各章顺序合并，章题不重复", () => {
    const text = buildMergedText("替嫁新娘马甲掉不停", "她替妹出嫁。", chapters);
    const lines = text.split("\n");
    expect(lines[0]).toBe("替嫁新娘马甲掉不停");
    expect(text).toContain("【简介】\n她替妹出嫁。");
    // 章序正确且第 1 章章题只出现一次（已含章题不重复）
    expect(text.indexOf("第1章 替嫁婚礼")).toBeLessThan(text.indexOf("第2章"));
    expect(text.match(/第1章/g)).toHaveLength(1);
    // 第 2 章正文无章题，补分隔行
    expect(text).toContain("第2章\n\n他把协议拍在桌上。");
  });

  it("简介为 null 时跳过简介段", () => {
    const text = buildMergedText("书名", null, chapters);
    expect(text).not.toContain("【简介】");
    expect(text.split("\n")[0]).toBe("书名");
  });
});

describe("chapterExportName 分章文件名", () => {
  it("编号 + 章题；非法字符清洗；无章题只留编号", () => {
    expect(chapterExportName(1, "替嫁婚礼")).toBe("001-替嫁婚礼.txt");
    expect(chapterExportName(12, "认亲?现场")).toBe("012-认亲现场.txt");
    expect(chapterExportName(2, null)).toBe("002.txt");
    expect(chapterExportName(3, "???")).toBe("003.txt");
  });
});

describe("runExport 命令（纯本地）", () => {
  let parentDir: string;
  let projectDir: string;

  beforeEach(() => {
    parentDir = mkdtempSync(path.join(os.tmpdir(), "duanju-export-"));
    projectDir = createProject("总裁的替嫁新娘", parentDir);
    writeFileSync(
      path.join(projectDir, "chapters", "001.md"),
      "# 第1章 替嫁婚礼\n\n她攥紧请柬。",
      "utf-8",
    );
    writeFileSync(
      path.join(projectDir, "chapters", "002.md"),
      "# 第2章 契约夜谈\n\n他把协议拍在桌上。",
      "utf-8",
    );
    writeFileSync(path.join(projectDir, "04-标题简介包.md"), PKG04, "utf-8");
  });

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true });
  });

  it("默认 --merged：以选定书名命名，含书名/简介/全章", () => {
    const project = readProject(projectDir);
    project.selectedTitle = "替嫁新娘马甲掉不停";
    writeProject(projectDir, project);

    runExport(projectDir);

    const file = path.join(projectDir, "exports", "替嫁新娘马甲掉不停.txt");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf-8");
    expect(text.startsWith("替嫁新娘马甲掉不停\n")).toBe(true);
    expect(text).toContain("版本一：她替妹出嫁");
    expect(text).toContain("第1章 替嫁婚礼");
    expect(text).toContain("第2章 契约夜谈");
  });

  it("未选书名时以项目目录名命名；简介提取失败时跳过简介", () => {
    // 注意：本机 Node 24 的 rmSync 对含中文的路径参数会静默失效，删除单文件须用 unlinkSync
    unlinkSync(path.join(projectDir, "04-标题简介包.md"));
    runExport(projectDir, { merged: true });

    const file = path.join(projectDir, "exports", `${path.basename(projectDir)}.txt`);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf-8");
    expect(text).not.toContain("【简介】");
    expect(text).toContain("第1章 替嫁婚礼");
  });

  it("--chapters 分章导出：编号+章题命名，去 # 前缀", () => {
    runExport(projectDir, { chapters: true });

    const dir = path.join(projectDir, "exports", "chapters");
    expect(readdirSync(dir).sort()).toEqual(["001-替嫁婚礼.txt", "002-契约夜谈.txt"]);
    const text = readFileSync(path.join(dir, "001-替嫁婚礼.txt"), "utf-8");
    expect(text.startsWith("第1章 替嫁婚礼\n")).toBe(true);
    // 只给 --chapters 时不生成合并文件
    expect(readdirSync(path.join(projectDir, "exports")).filter((f) => f.endsWith(".txt"))).toEqual(
      [],
    );
  });

  it("同名文件覆盖前生成 .bak-<时间戳> 备份", () => {
    runExport(projectDir, { merged: true });
    runExport(projectDir, { merged: true });

    const files = readdirSync(path.join(projectDir, "exports"));
    expect(files.some((f) => /\.txt\.bak-\d{8}-\d{6}$/.test(f))).toBe(true);
  });

  it("没有任何章节时中文报错", () => {
    // 新建空项目（chapters/ 为空目录）验证前置校验，绕开 rmSync 对中文路径的静默失效
    const emptyDir = createProject("空章节项目", parentDir);
    expect(() => runExport(emptyDir)).toThrow("duanju write");
  });
});
