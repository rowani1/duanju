import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 四个 provider 工厂 mock：记录 create 参数与 model 调用参数
const mocks = vi.hoisted(() => {
  const make = (tag: string) => {
    const modelFn = vi.fn((id: string) => ({ tag, modelId: id }));
    const create = vi.fn(() => modelFn);
    return { create, modelFn };
  };
  return {
    openai: make("openai"),
    anthropic: make("anthropic"),
    google: make("google"),
    compat: make("compat"),
  };
});

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.openai.create }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mocks.anthropic.create }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: mocks.google.create }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: mocks.compat.create }));

import {
  createModel,
  mergeConfig,
  readGlobalConfig,
  writeGlobalConfig,
  globalConfigPath,
} from "../../src/core/llm.js";

describe("mergeConfig 配置优先级", () => {
  it("显式参数 > 项目覆盖 > 全局配置", () => {
    const merged = mergeConfig({
      explicit: { model: "explicit-model" },
      projectOverride: { model: "project-model", provider: "google" },
      global: { provider: "openai", model: "global-model", apiKey: "gk" },
      env: {},
    });
    expect(merged.model).toBe("explicit-model");
    expect(merged.provider).toBe("google");
    // 全局配置的 provider 是 openai，其 apiKey 不跨 provider 继承给 google
    expect(merged.apiKey).toBeUndefined();
  });

  it("项目覆盖 > 全局配置", () => {
    const merged = mergeConfig({
      projectOverride: { provider: "anthropic", model: "p-model" },
      global: { provider: "openai", model: "g-model", apiKey: "gk" },
      env: {},
    });
    expect(merged.provider).toBe("anthropic");
    expect(merged.model).toBe("p-model");
  });

  it("全局配置缺 apiKey 时按 provider 回落环境变量", () => {
    const cases: Array<[string, string, string]> = [
      ["openai", "OPENAI_API_KEY", "ek-openai"],
      ["anthropic", "ANTHROPIC_API_KEY", "ek-anthropic"],
      ["google", "GOOGLE_GENERATIVE_AI_API_KEY", "ek-google"],
      ["openai-compatible", "OPENAI_API_KEY", "ek-compat"],
    ];
    for (const [provider, envKey, envVal] of cases) {
      const merged = mergeConfig({
        global: { provider: provider as never, model: "m" },
        env: { [envKey]: envVal },
      });
      expect(merged.apiKey).toBe(envVal);
    }
  });

  it("配置源 apiKey 优先于环境变量", () => {
    const merged = mergeConfig({
      global: { provider: "openai", model: "m", apiKey: "gk" },
      env: { OPENAI_API_KEY: "ek" },
    });
    expect(merged.apiKey).toBe("gk");
  });

  it("项目覆盖里的 apiKey 被忽略（key 不落项目目录）", () => {
    const merged = mergeConfig({
      projectOverride: { apiKey: "leak" } as never,
      global: { provider: "openai", model: "m", apiKey: "gk" },
      env: {},
    });
    expect(merged.apiKey).toBe("gk");
  });

  it("项目覆盖切换 provider 时，不继承其他 provider 的 apiKey/baseURL（回落环境变量）", () => {
    const merged = mergeConfig({
      projectOverride: { provider: "anthropic", model: "claude-x" },
      global: {
        provider: "openai-compatible",
        model: "deepseek-chat",
        apiKey: "ds-key",
        baseURL: "https://api.deepseek.com/v1",
      },
      env: { ANTHROPIC_API_KEY: "ek-anthropic" },
    });
    expect(merged.provider).toBe("anthropic");
    expect(merged.apiKey).toBe("ek-anthropic");
    expect(merged.baseURL).toBeUndefined();
  });

  it("项目覆盖与全局 provider 相同时，正常继承全局 apiKey/baseURL", () => {
    const merged = mergeConfig({
      projectOverride: { provider: "openai-compatible", model: "kimi-x" },
      global: {
        provider: "openai-compatible",
        model: "deepseek-chat",
        apiKey: "gk",
        baseURL: "https://relay.example.com/v1",
      },
      env: {},
    });
    expect(merged.apiKey).toBe("gk");
    expect(merged.baseURL).toBe("https://relay.example.com/v1");
  });

  it("provider/model 均缺失时抛中文错误", () => {
    expect(() => mergeConfig({ env: {} })).toThrow(/duanju config/);
  });
});

describe("createModel provider 工厂", () => {
  afterEach(() => {
    for (const m of Object.values(mocks)) {
      m.create.mockClear();
      m.modelFn.mockClear();
    }
  });

  it("openai：传 apiKey 并按 model id 实例化", () => {
    const model = createModel({ provider: "openai", model: "gpt-x", apiKey: "k1" });
    expect(mocks.openai.create).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "k1" }));
    expect(mocks.openai.modelFn).toHaveBeenCalledWith("gpt-x");
    expect((model as { tag: string }).tag).toBe("openai");
  });

  it("anthropic：传 apiKey 并按 model id 实例化", () => {
    createModel({ provider: "anthropic", model: "claude-x", apiKey: "k2" });
    expect(mocks.anthropic.create).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "k2" }));
    expect(mocks.anthropic.modelFn).toHaveBeenCalledWith("claude-x");
  });

  it("google：传 apiKey 并按 model id 实例化", () => {
    createModel({ provider: "google", model: "gemini-x", apiKey: "k3" });
    expect(mocks.google.create).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "k3" }));
    expect(mocks.google.modelFn).toHaveBeenCalledWith("gemini-x");
  });

  it("openai-compatible：传 apiKey 与 baseURL", () => {
    createModel({
      provider: "openai-compatible",
      model: "deepseek-x",
      apiKey: "k4",
      baseURL: "https://api.example.com/v1",
    });
    expect(mocks.compat.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "k4", baseURL: "https://api.example.com/v1" }),
    );
    expect(mocks.compat.modelFn).toHaveBeenCalledWith("deepseek-x");
  });

  it("openai-compatible 缺 baseURL 抛中文错误", () => {
    expect(() =>
      createModel({ provider: "openai-compatible", model: "m", apiKey: "k" }),
    ).toThrow(/baseURL/);
  });
});

describe("全局配置读写", () => {
  it("写入后可读回，路径为 <home>/.duanju/config.json", () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), "duanju-test-"));
    try {
      const cfg = { provider: "openai" as const, model: "gpt-x", apiKey: "k" };
      writeGlobalConfig(cfg, tmpHome);
      expect(globalConfigPath(tmpHome)).toBe(path.join(tmpHome, ".duanju", "config.json"));
      expect(readGlobalConfig(tmpHome)).toEqual(cfg);
      const raw = JSON.parse(readFileSync(globalConfigPath(tmpHome), "utf-8"));
      expect(raw.model).toBe("gpt-x");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("配置文件不存在时返回 null", () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), "duanju-test-"));
    try {
      expect(readGlobalConfig(tmpHome)).toBeNull();
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("配置文件损坏时返回 null 而非抛错", () => {
    const tmpHome = mkdtempSync(path.join(os.tmpdir(), "duanju-test-"));
    try {
      mkdirSync(path.join(tmpHome, ".duanju"), { recursive: true });
      writeFileSync(path.join(tmpHome, ".duanju", "config.json"), "{broken", "utf-8");
      expect(readGlobalConfig(tmpHome)).toBeNull();
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
