import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, readProject } from "../../src/core/project.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "duanju-new-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createProject", () => {
  it("创建目录结构：duanju.json + chapters/ + state/ + exports/", () => {
    const dir = createProject("总裁的替嫁新娘", tmpDir);
    expect(path.basename(dir)).toBe("总裁的替嫁新娘");
    expect(existsSync(path.join(dir, "duanju.json"))).toBe(true);
    for (const sub of ["chapters", "state", "exports"]) {
      expect(existsSync(path.join(dir, sub))).toBe(true);
    }
    const project = readProject(dir);
    expect(project.idea).toBe("总裁的替嫁新娘");
    expect(project.createdAt).toBeTruthy();
  });

  it("题材含非法字符时目录名被清洗，idea 保留原文", () => {
    const dir = createProject("替嫁:新娘?", tmpDir);
    expect(path.basename(dir)).toBe("替嫁新娘");
    expect(readProject(dir).idea).toBe("替嫁:新娘?");
  });

  it("截断后目录名不残留首尾标点", () => {
    const dir = createProject("替嫁给残疾大佬冲喜，新婚夜他站起来了", tmpDir);
    expect(path.basename(dir)).toBe("替嫁给残疾大佬冲喜");
  });

  it("目录已存在时抛中文错误", () => {
    createProject("替嫁新娘", tmpDir);
    expect(() => createProject("替嫁新娘", tmpDir)).toThrow(/目录已存在/);
  });

  it("空题材抛中文错误", () => {
    expect(() => createProject("   ", tmpDir)).toThrow(/题材不能为空/);
  });
});
