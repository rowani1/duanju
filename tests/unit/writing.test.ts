import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupFile, extractChapterOutline } from "../../src/core/project.js";
import { contentTail, countProseChars } from "../../src/stages/writing.js";

describe("countProseChars 正文字数统计", () => {
  it("剔除标题行与空白，仅统计正文字符", () => {
    const md = "# 第1章 替嫁婚礼\n\n她走了。\n\n  好。  \n## 小节\n再见";
    // 她走了。好。再见 = 8 个字符
    expect(countProseChars(md)).toBe(8);
  });

  it("空文档与纯标题为 0", () => {
    expect(countProseChars("")).toBe(0);
    expect(countProseChars("# 第1章")).toBe(0);
  });
});

describe("contentTail 尾部截取", () => {
  it("不足 500 字时返回全量（去尾部空白）", () => {
    expect(contentTail("短内容\n\n")).toBe("短内容");
  });

  it("超长时取末尾 500 字", () => {
    const body = "前".repeat(600) + "后".repeat(500);
    const tail = contentTail(body, 500);
    expect(tail).toHaveLength(500);
    expect(tail).toBe("后".repeat(500));
  });
});

describe("extractChapterOutline 章纲块提取", () => {
  const outline = `# 章纲包
## 总纲
主线走向
## 10-20章分章表
### 第1章 替嫁婚礼
- 核心事件：婚礼被搅局
- 结尾钩子：婚礼继续
### 第2章 契约夜谈
- 核心事件：两人立约
- 结尾钩子：股权协议
## 备注
其他说明`;

  it("提取指定章块，止于下一章标题", () => {
    const block = extractChapterOutline(outline, 1);
    expect(block).toContain("第1章 替嫁婚礼");
    expect(block).toContain("婚礼被搅局");
    expect(block).not.toContain("两人立约");
  });

  it("最后一章止于更高层级标题，不吞备注小节", () => {
    const block = extractChapterOutline(outline, 2);
    expect(block).toContain("两人立约");
    expect(block).not.toContain("其他说明");
  });

  it("支持「第 N 章」空格变体；找不到返回 null", () => {
    expect(extractChapterOutline("### 第 3 章 试探\n- 核心事件：试探", 3)).toContain("试探");
    expect(extractChapterOutline(outline, 9)).toBeNull();
  });
});

describe("backupFile 覆盖前备份", () => {
  it("生成 .bak-<时间戳> 副本且保留原内容", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "duanju-bak-"));
    try {
      const file = path.join(dir, "001.md");
      writeFileSync(file, "原始内容", "utf-8");
      const backup = backupFile(file);
      expect(path.basename(backup)).toMatch(/^001\.md\.bak-\d{8}-\d{6}$/);
      expect(existsSync(backup)).toBe(true);
      expect(readFileSync(backup, "utf-8")).toBe("原始内容");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
