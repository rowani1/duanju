import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 仓库根 = tests/unit 向上两级
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const knowledgeRoot = path.join(repoRoot, "knowledge");

function countMd(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countMd(full);
    else if (entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

describe("知识库文件计数", () => {
  it("packaging：SKILL.md + 14 个 references = 15", () => {
    expect(countMd(path.join(knowledgeRoot, "packaging"))).toBe(15);
    expect(countMd(path.join(knowledgeRoot, "packaging", "references"))).toBe(14);
  });

  it("writing：SKILL.md + 15 个 references = 16", () => {
    expect(countMd(path.join(knowledgeRoot, "writing"))).toBe(16);
    expect(countMd(path.join(knowledgeRoot, "writing", "references"))).toBe(15);
  });

  it("title：SKILL.md + 10 个 references = 11", () => {
    expect(countMd(path.join(knowledgeRoot, "title"))).toBe(11);
    expect(countMd(path.join(knowledgeRoot, "title", "references"))).toBe(10);
  });

  it("总计 42 个 md 文件", () => {
    expect(countMd(knowledgeRoot)).toBe(42);
  });
});
