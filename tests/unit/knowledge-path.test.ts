import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveKnowledgePath, validateGlobalKnowledgePath } from "../../src/core/llm.js";

let base: string;
let projectDir: string;
let cwd: string;

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "duanju-kpath-"));
  projectDir = path.join(base, "project");
  cwd = path.join(base, "cwd");
  mkdirSync(projectDir);
  mkdirSync(cwd);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveKnowledgePath 三级优先级与路径基准", () => {
  it("三级均未配置时返回 undefined（与 v0.1.1 行为一致）", () => {
    expect(resolveKnowledgePath({ projectDir, cwd })).toBeUndefined();
  });

  it("CLI 参数优先级最高，相对路径相对 cwd 解析", () => {
    mkdirSync(path.join(cwd, "kb-cli"));
    mkdirSync(path.join(projectDir, "kb-proj"));
    const resolved = resolveKnowledgePath({
      cliArg: "kb-cli",
      projectDir,
      projectValue: "kb-proj",
      globalValue: path.join(base, "kb-global"),
      cwd,
    });
    expect(resolved).toBe(path.join(cwd, "kb-cli"));
  });

  it("项目配置次之，相对路径相对项目目录解析", () => {
    mkdirSync(path.join(projectDir, "kb-proj"));
    const resolved = resolveKnowledgePath({
      projectDir,
      projectValue: "kb-proj",
      globalValue: path.join(base, "kb-global"),
      cwd,
    });
    expect(resolved).toBe(path.join(projectDir, "kb-proj"));
  });

  it("全局配置兜底，必须为绝对路径", () => {
    const globalDir = path.join(base, "kb-global");
    mkdirSync(globalDir);
    expect(resolveKnowledgePath({ projectDir, globalValue: globalDir, cwd })).toBe(globalDir);
  });

  it("全局配置为相对路径时抛 CliError 引导改绝对路径", () => {
    expect(() =>
      resolveKnowledgePath({ projectDir, globalValue: "relative/kb", cwd }),
    ).toThrow(/knowledgePath 必须为绝对路径.*relative\/kb/s);
  });

  it("目录不存在时报错含解析后完整路径与来源（命令行参数）", () => {
    expect(() =>
      resolveKnowledgePath({ cliArg: "no-such-dir", projectDir, cwd }),
    ).toThrow(
      new RegExp(
        `自定义知识库目录不存在.*${path.join(cwd, "no-such-dir").replace(/\\/g, "\\\\")}.*来源：命令行参数`,
        "s",
      ),
    );
  });

  it("目录不存在时报错含来源（项目配置 / 全局配置）", () => {
    expect(() =>
      resolveKnowledgePath({ projectDir, projectValue: "missing", cwd }),
    ).toThrow(/来源：项目配置/);
    expect(() =>
      resolveKnowledgePath({ projectDir, globalValue: path.join(base, "missing"), cwd }),
    ).toThrow(/来源：全局配置/);
  });
});

describe("validateGlobalKnowledgePath（config 向导校验）", () => {
  it("相对路径返回中文错误", () => {
    expect(validateGlobalKnowledgePath("relative/kb")).toMatch(/绝对路径/);
  });

  it("目录不存在返回中文错误", () => {
    expect(validateGlobalKnowledgePath(path.join(base, "missing"))).toMatch(/目录不存在/);
  });

  it("存在的绝对路径目录通过校验", () => {
    expect(validateGlobalKnowledgePath(projectDir)).toBeUndefined();
  });
});
