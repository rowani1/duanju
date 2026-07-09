import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV1 } from "ai/test";
import {
  parseCommentBlock,
  runStage,
  StageValidationError,
  validateStructure,
  type StageContext,
  type StageSpec,
} from "../../src/core/pipeline.js";
import { mergeHandoff, missingHandoffFields, HANDOFF_KEYS } from "../../src/core/project.js";

describe("parseCommentBlock（handoff 解析器）", () => {
  it("解析文末 handoff 区块的键值对", () => {
    const md = "# 题材归类\n- 主类：总裁\n\n<!-- handoff\n主类: 总裁\n子类: 追妻火葬场\n-->";
    expect(parseCommentBlock(md, "handoff")).toEqual({ 主类: "总裁", 子类: "追妻火葬场" });
  });

  it("支持全角冒号与列表前缀，忽略空行/无冒号行/代码围栏", () => {
    const md = "<!-- handoff\n```yaml\n- 主类：古言\n\n随便一行\n子类: 宅斗\n```\n-->";
    expect(parseCommentBlock(md, "handoff")).toEqual({ 主类: "古言", 子类: "宅斗" });
  });

  it("值中含冒号时取第一个冒号后的完整内容", () => {
    const md = "<!-- handoff\n一句话选题: 离婚三年：她带娃回国\n-->";
    expect(parseCommentBlock(md, "handoff")).toEqual({ 一句话选题: "离婚三年：她带娃回国" });
  });

  it("多个区块时取最后一个（文末约定）", () => {
    const md = "<!-- handoff\n主类: 总裁\n-->\n正文\n<!-- handoff\n主类: 古言\n-->";
    expect(parseCommentBlock(md, "handoff")).toEqual({ 主类: "古言" });
  });

  it("无区块返回 null，空区块返回空对象", () => {
    expect(parseCommentBlock("# 无区块", "handoff")).toBeNull();
    expect(parseCommentBlock("<!-- revise\n-->", "revise")).toEqual({});
  });

  it("按标签区分 handoff 与 revise 区块", () => {
    const md = "<!-- handoff\n主类: 总裁\n-->\n<!-- revise\n02-题材包.md: 卖点空泛\n-->";
    expect(parseCommentBlock(md, "revise")).toEqual({ "02-题材包.md": "卖点空泛" });
  });
});

describe("validateStructure（结构校验器）", () => {
  const md = [
    "# 题材包",
    "- 一句话选题：离婚带娃回国",
    "- 核心卖点：身份反转",
    "## 第一章章末钩子",
    "**目标情绪**：爽",
    "3、场景成本：低",
    "短剧化优势：正文段落里提到的不算……除非行首",
  ].join("\n");

  it("标题/列表/加粗/编号行中的小节名均判存在", () => {
    expect(validateStructure(md, ["一句话选题", "核心卖点", "章末钩子", "目标情绪", "场景成本"])).toEqual([]);
  });

  it("行首直写的小节名也判存在", () => {
    expect(validateStructure(md, ["短剧化优势"])).toEqual([]);
  });

  it("缺失的小节被完整列出", () => {
    expect(validateStructure(md, ["风险点", "封面短句"])).toEqual(["风险点", "封面短句"]);
  });

  it("小节名只出现在普通段落中间时判缺失", () => {
    expect(validateStructure("这段正文顺带提了一句风险点而已", ["风险点"])).toEqual(["风险点"]);
  });
});

describe("mergeHandoff / missingHandoffFields", () => {
  it("只吸收九个已知字段，忽略未知键与空值", () => {
    const merged = mergeHandoff(undefined, {
      主类: "总裁",
      子类: " 追妻火葬场 ",
      无关键: "x",
      核心卖点: "  ",
    });
    expect(merged).toEqual({ 主类: "总裁", 子类: "追妻火葬场" });
  });

  it("增量合并且新值覆盖旧值", () => {
    const merged = mergeHandoff({ 主类: "总裁" }, { 主类: "古言", 一句话选题: "选题" });
    expect(merged).toEqual({ 主类: "古言", 一句话选题: "选题" });
  });

  it("九字段齐全时 missing 为空，否则列出缺失字段", () => {
    expect(missingHandoffFields(undefined)).toHaveLength(9);
    const full = Object.fromEntries(HANDOFF_KEYS.map((k) => [k, "值"]));
    expect(missingHandoffFields(full)).toEqual([]);
    delete (full as Record<string, string>)["最强反转"];
    expect(missingHandoffFields(full)).toEqual(["最强反转"]);
  });
});

describe("runStage（执行器：校验 → 带反馈重试 → 落盘）", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "duanju-stage-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const spec: StageSpec = {
    id: "t",
    label: "测试步骤",
    outputFile: "01-题材归类.md",
    knowledgeFiles: () => ["packaging/SKILL.md"],
    rolePrompt: () => "角色设定",
    outputSpecPrompt: () => "输出规约",
    userPrompt: (ctx) => `题材：${ctx.project.idea}`,
    requiredSections: ["主类", "子类"],
    handoffKeys: ["主类"],
  };

  function ctxOf(reviseNote?: string): StageContext {
    return {
      projectDir: tmpDir,
      project: { idea: "替嫁", createdAt: "2026-07-08T00:00:00.000Z" },
      prior: [{ file: "00-上一步.md", content: "上一步内容" }],
      reviseNote,
    };
  }

  const VALID = "# 归类\n- 主类：总裁\n- 子类：替嫁\n<!-- handoff\n主类: 总裁\n-->";

  function scriptedModel(outputs: string[]) {
    const prompts: string[] = [];
    let call = 0;
    const model = new MockLanguageModelV1({
      doGenerate: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        const text = outputs[Math.min(call, outputs.length - 1)];
        call += 1;
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop" as const,
          usage: { promptTokens: 10, completionTokens: 20 },
          text,
        };
      },
    });
    return { model, prompts, calls: () => call };
  }

  it("一次通过：三段式 system + 用户消息含累积上下文，产物落盘", async () => {
    const { model, prompts, calls } = scriptedModel([VALID]);
    const result = await runStage(model, spec, ctxOf());

    expect(calls()).toBe(1);
    expect(result.retried).toBe(false);
    expect(result.handoff).toEqual({ 主类: "总裁" });
    expect(existsSync(result.file)).toBe(true);
    expect(readFileSync(result.file, "utf-8")).toBe(VALID + "\n");

    // system 三段式：角色 + 知识注入 + 输出规约；user 含题材与修订要求缺省
    expect(prompts[0]).toContain("角色设定");
    expect(prompts[0]).toContain("packaging/SKILL.md");
    expect(prompts[0]).toContain("输出规约");
    expect(prompts[0]).toContain("题材：替嫁");
  });

  it("首次缺小节/缺 handoff → 带错误反馈自动重试 1 次后成功", async () => {
    const { model, prompts, calls } = scriptedModel(["# 只有主类\n- 主类：总裁", VALID]);
    const result = await runStage(model, spec, ctxOf());

    expect(calls()).toBe(2);
    expect(result.retried).toBe(true);
    // 第二次调用携带首次输出与问题清单反馈
    expect(prompts[1]).toContain("存在以下问题");
    expect(prompts[1]).toContain("子类");
    expect(prompts[1]).toContain("handoff");
  });

  it("重试后仍不合格 → 抛 StageValidationError 且不落盘", async () => {
    const { model, calls } = scriptedModel(["无效", "还是无效"]);
    await expect(runStage(model, spec, ctxOf())).rejects.toThrow(StageValidationError);
    expect(calls()).toBe(2);
    expect(existsSync(path.join(tmpDir, spec.outputFile))).toBe(false);
  });

  it("reviseNote 追加为修订要求", async () => {
    const { model, prompts } = scriptedModel([VALID]);
    await runStage(model, spec, ctxOf("卖点更狠一点"));
    expect(prompts[0]).toContain("【修订要求】");
    expect(prompts[0]).toContain("卖点更狠一点");
  });

  it("extraValidate 的错误同样触发重试与反馈", async () => {
    const strictSpec: StageSpec = {
      ...spec,
      extraValidate: (_md, handoff) =>
        handoff["主类"] === "科幻" ? ["主类不在四大主类内"] : [],
    };
    const bad = "# 归类\n- 主类：科幻\n- 子类：机甲\n<!-- handoff\n主类: 科幻\n-->";
    const { model, prompts } = scriptedModel([bad, VALID]);
    const result = await runStage(model, strictSpec, ctxOf());
    expect(result.retried).toBe(true);
    expect(prompts[1]).toContain("四大主类");
  });

  it("warnValidate 只产生警告：不重试、不阻断落盘", async () => {
    const warnSpec: StageSpec = {
      ...spec,
      warnValidate: () => ["章数偏少"],
    };
    const { model, calls } = scriptedModel([VALID]);
    const result = await runStage(model, warnSpec, ctxOf());
    expect(calls()).toBe(1);
    expect(result.retried).toBe(false);
    expect(result.warnings).toEqual(["章数偏少"]);
    expect(existsSync(result.file)).toBe(true);
  });

  it("无 warnValidate 时 warnings 为空数组", async () => {
    const { model } = scriptedModel([VALID]);
    const result = await runStage(model, spec, ctxOf());
    expect(result.warnings).toEqual([]);
  });
});
