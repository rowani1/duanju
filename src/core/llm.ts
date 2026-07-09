import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { CliError } from "./errors.js";

export type ProviderName = "openai" | "anthropic" | "google" | "openai-compatible";

export interface LlmConfig {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export type PartialLlmConfig = Partial<LlmConfig>;

/** 项目侧覆盖：只允许 provider/model/baseURL，apiKey 绝不落项目目录 */
export type ModelOverride = Pick<PartialLlmConfig, "provider" | "model" | "baseURL">;

/** 各 provider 对应的 apiKey 环境变量 */
const ENV_KEY_BY_PROVIDER: Record<ProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "openai-compatible": "OPENAI_API_KEY",
};

export interface MergeSources {
  /** 显式传入参数（如命令行） */
  explicit?: PartialLlmConfig;
  /** 项目 duanju.json 的 modelOverride */
  projectOverride?: ModelOverride;
  /** 全局 ~/.duanju/config.json */
  global?: PartialLlmConfig;
  /** 环境变量 */
  env?: NodeJS.ProcessEnv;
}

/**
 * 配置合并，优先级：显式参数 > 项目 modelOverride > 全局配置 > 环境变量。
 * 环境变量仅提供 apiKey（按最终 provider 选择变量名）。
 */
export function mergeConfig(sources: MergeSources): LlmConfig {
  const { explicit = {}, projectOverride = {}, global: globalCfg = {}, env = process.env } = sources;

  const provider = explicit.provider ?? projectOverride.provider ?? globalCfg.provider;
  const model = explicit.model ?? projectOverride.model ?? globalCfg.model;

  if (!provider || !model) {
    throw new CliError("尚未配置模型。请先运行 duanju config 完成配置，或通过参数指定 provider 与 model。");
  }

  // 配置源声明了不同 provider 时，其 apiKey/baseURL 视为该 provider 专属，不跨 provider 继承
  const matchesFinal = (source: { provider?: ProviderName }): boolean =>
    source.provider === undefined || source.provider === provider;

  // apiKey 只来自显式参数 / 全局配置 / 环境变量，项目目录不存 key
  const apiKey =
    explicit.apiKey ??
    (matchesFinal(globalCfg) ? globalCfg.apiKey : undefined) ??
    env[ENV_KEY_BY_PROVIDER[provider]];
  const baseURL =
    explicit.baseURL ??
    (matchesFinal(projectOverride) ? projectOverride.baseURL : undefined) ??
    (matchesFinal(globalCfg) ? globalCfg.baseURL : undefined);

  const merged: LlmConfig = { provider, model };
  if (apiKey) merged.apiKey = apiKey;
  if (baseURL) merged.baseURL = baseURL;
  return merged;
}

/** 按 provider 返回 AI SDK LanguageModel 实例 */
export function createModel(config: LlmConfig): LanguageModel {
  const { provider, model, apiKey, baseURL } = config;
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(model);
    case "anthropic":
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(model);
    case "openai-compatible":
      if (!baseURL) {
        throw new CliError(
          "openai-compatible 需要配置 baseURL（如 https://api.deepseek.com/v1）。请运行 duanju config 补充。",
        );
      }
      return createOpenAICompatible({ name: "openai-compatible", apiKey, baseURL })(model);
    default: {
      const never: never = provider;
      throw new CliError(
        `不支持的 provider：${String(never)}。有效取值：openai / anthropic / google / openai-compatible。请运行 duanju config 重新配置，或检查 ~/.duanju/config.json 的手动修改。`,
      );
    }
  }
}

/** 全局配置文件路径：<home>/.duanju/config.json */
export function globalConfigPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".duanju", "config.json");
}

/** 读取全局配置；不存在或损坏时返回 null */
export function readGlobalConfig(homeDir: string = os.homedir()): PartialLlmConfig | null {
  const file = globalConfigPath(homeDir);
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    if (parsed && typeof parsed === "object") return parsed as PartialLlmConfig;
    return null;
  } catch {
    return null;
  }
}

/** 写入全局配置（目录不存在则创建） */
export function writeGlobalConfig(config: LlmConfig, homeDir: string = os.homedir()): void {
  const file = globalConfigPath(homeDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
