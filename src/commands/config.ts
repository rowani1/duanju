import * as p from "@clack/prompts";
import { generateText } from "ai";
import {
  createModel,
  writeGlobalConfig,
  globalConfigPath,
  type LlmConfig,
  type ProviderName,
} from "../core/llm.js";
import { assertNotCancelled as sharedAssertNotCancelled } from "../ui/prompts.js";

/** 各厂商的常用模型建议（供选择，也可自定义） */
const MODEL_SUGGESTIONS: Record<ProviderName, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-5", "claude-3-5-haiku-latest"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  "openai-compatible": ["deepseek-chat", "moonshot-v1-32k"],
};

/** config 场景的取消文案：配置未保存，无产物续传语义 */
function assertNotCancelled<T>(value: T | symbol): T {
  return sharedAssertNotCancelled(value, "已取消配置，未保存任何修改。");
}

/** duanju config：交互式配置向导，验证连通后保存全局配置 */
export async function runConfigWizard(): Promise<void> {
  p.intro("duanju 模型配置向导");

  const provider = assertNotCancelled(
    await p.select<ProviderName>({
      message: "选择模型厂商",
      options: [
        { value: "openai", label: "OpenAI" },
        { value: "anthropic", label: "Anthropic (Claude)" },
        { value: "google", label: "Google (Gemini)" },
        { value: "openai-compatible", label: "OpenAI 兼容接口（DeepSeek / Kimi / 中转站等）" },
      ],
    }),
  );

  const apiKey = assertNotCancelled(
    await p.password({
      message: "输入 API Key（只存本机全局配置，不会写入项目目录）",
      validate: (v) => (v && v.trim().length > 0 ? undefined : "API Key 不能为空"),
    }),
  ).trim();

  const suggestions = MODEL_SUGGESTIONS[provider];
  const modelChoice = assertNotCancelled(
    await p.select<string>({
      message: "选择模型",
      options: [
        ...suggestions.map((m) => ({ value: m, label: m })),
        { value: "__custom__", label: "自定义模型名…" },
      ],
    }),
  );
  const model =
    modelChoice === "__custom__"
      ? assertNotCancelled(
          await p.text({
            message: "输入模型名称",
            validate: (v) => (v && v.trim().length > 0 ? undefined : "模型名称不能为空"),
          }),
        ).trim()
      : modelChoice;

  let baseURL: string | undefined;
  if (provider === "openai-compatible") {
    baseURL = assertNotCancelled(
      await p.text({
        message: "输入 baseURL（如 https://api.deepseek.com/v1）",
        validate: (v) => {
          if (!v || v.trim().length === 0) return "baseURL 不能为空";
          if (!/^https?:\/\//.test(v.trim())) return "baseURL 需以 http:// 或 https:// 开头";
          return undefined;
        },
      }),
    ).trim();
  }

  const config: LlmConfig = { provider, model, apiKey, ...(baseURL ? { baseURL } : {}) };

  const spinner = p.spinner();
  spinner.start("正在发送测试消息验证连通性…");
  try {
    const { text } = await generateText({
      model: createModel(config),
      prompt: "这是一条连通性测试消息，请只回复：OK",
      maxRetries: 1,
    });
    spinner.stop(`验证成功，模型回复：${text.trim().slice(0, 50)}`);
  } catch (err) {
    spinner.stop("验证失败。", 1);
    const message = err instanceof Error ? err.message : String(err);
    p.log.error(`连通性测试未通过：${message}`);
    p.log.info(
      "建议检查：1) API Key 是否正确；2) 模型名称是否可用；3) 网络/代理是否可达" +
        (provider === "openai-compatible" ? "；4) baseURL 是否正确（通常以 /v1 结尾）" : "") +
        "。修正后重新运行 duanju config。",
    );
    p.outro("配置未保存。");
    process.exitCode = 1;
    return;
  }

  writeGlobalConfig(config);
  p.outro(`配置已保存到 ${globalConfigPath()}`);
}
