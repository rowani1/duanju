import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModelV1StreamPart } from "@ai-sdk/provider";

export interface ScriptedModel {
  model: MockLanguageModelV1;
  /** 每次调用的完整 prompt（JSON 序列化，generate 与 stream 共用一条时间线） */
  prompts: string[];
  /** 已发生的调用次数 */
  calls(): number;
  /** 每次调用的类型，用于断言流式/非流式路径 */
  kinds(): Array<"generate" | "stream">;
}

/**
 * 顺序脚本化 mock：按序消费 outputs，记录每次调用的完整 prompt；
 * 输出耗尽时抛错暴露多余调用；Error 项模拟 API 失败。
 * 正文（streamText）与快照/包（generateText）走同一输出队列。
 */
export function scriptedModel(outputs: Array<string | Error>): ScriptedModel {
  const prompts: string[] = [];
  const kinds: Array<"generate" | "stream"> = [];
  let call = 0;

  const nextOutput = (): string => {
    if (call >= outputs.length) throw new Error(`mock 输出耗尽：第 ${call + 1} 次调用`);
    const out = outputs[call];
    call += 1;
    if (out instanceof Error) throw out;
    return out;
  };

  const model = new MockLanguageModelV1({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      kinds.push("generate");
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 20 },
        text: nextOutput(),
      };
    },
    doStream: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      kinds.push("stream");
      const text = nextOutput();
      const parts: LanguageModelV1StreamPart[] = chunk(text).map((piece) => ({
        type: "text-delta",
        textDelta: piece,
      }));
      parts.push({
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 20 },
      });
      return {
        stream: new ReadableStream<LanguageModelV1StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  });

  return { model, prompts, calls: () => call, kinds: () => [...kinds] };
}

/** 把文本切成多个增量块，模拟真实流式输出 */
function chunk(text: string, size = 200): string[] {
  if (text.length === 0) return [""];
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    pieces.push(text.slice(i, i + size));
  }
  return pieces;
}
