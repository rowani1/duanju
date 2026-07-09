import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";

/** 四大主类 */
export const MAIN_CATEGORIES = ["总裁", "古言", "女频现实情感", "年代/穿越"] as const;
export type MainCategory = (typeof MAIN_CATEGORIES)[number];

/** 主类 → 知识文件名段（如 zongcai-subtypes.md 的 zongcai） */
const SEGMENT_BY_CATEGORY: Record<MainCategory, string> = {
  总裁: "zongcai",
  古言: "guyan",
  女频现实情感: "female-realistic",
  "年代/穿越": "niandai",
};

export function categorySegment(mainCategory: string): string {
  const seg = SEGMENT_BY_CATEGORY[mainCategory as MainCategory];
  if (!seg) {
    throw new CliError(
      `未知主类：「${mainCategory}」。有效主类为：${MAIN_CATEGORIES.join("、")}。`,
    );
  }
  return seg;
}

/**
 * 知识库根目录：相对编译产物推导（dist/core/ 或 src/core/ 均为包根下一级），
 * 兼容 npx / 全局安装，不依赖 process.cwd()。
 */
export function knowledgeRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // <pkg>/dist/core 或 <pkg>/src/core
  return path.resolve(here, "..", "..", "knowledge");
}

/** loadKnowledgeEx 的返回结构：拼接内容 + 自定义命中清单 + 边界警告 */
export interface KnowledgeResult {
  /** 拼接后的知识文本（文件间加分隔标题） */
  content: string;
  /** 命中自定义知识库的相对路径清单（顺序同 files） */
  customHits: string[];
  /** 边界警告（如自定义文件为空），由命令层展示，core 不打印 */
  warnings: string[];
}

/** 返回 files 中在自定义根目录下存在同构文件的相对路径（仅探测，不读取） */
export function findCustomHits(files: string[], customRoot?: string): string[] {
  if (!customRoot) return [];
  return files.filter((rel) => existsSync(path.join(customRoot, ...rel.split("/"))));
}

/**
 * 按相对 knowledge/ 的路径数组读取并拼接（文件间加分隔标题）。
 * 传入 customRoot 时逐文件回落解析：自定义目录存在同构文件则用自定义版
 * （空文件收集警告后照用），否则回落内置版；自定义目录中的多余文件忽略。
 */
export function loadKnowledgeEx(files: string[], customRoot?: string): KnowledgeResult {
  const root = knowledgeRoot();
  const parts: string[] = [];
  const customHits: string[] = [];
  const warnings: string[] = [];
  for (const rel of files) {
    const segments = rel.split("/");
    const customFull = customRoot ? path.join(customRoot, ...segments) : null;
    if (customFull !== null && existsSync(customFull)) {
      const raw = readFileSync(customFull, "utf-8").trim();
      customHits.push(rel);
      if (raw.length === 0) {
        warnings.push(`自定义知识文件为空：${rel}，将按空内容注入。`);
      }
      parts.push(`===== 知识文件：${rel} =====\n\n${raw}`);
      continue;
    }
    const full = path.join(root, ...segments);
    if (!existsSync(full)) {
      throw new CliError(
        `知识文件不存在：${rel}（查找路径：${full}）。请确认安装包完整，可尝试重新安装：npm i -g duanju-cli。`,
      );
    }
    parts.push(`===== 知识文件：${rel} =====\n\n${readFileSync(full, "utf-8").trim()}`);
  }
  return { content: parts.join("\n\n"), customHits, warnings };
}

/** loadKnowledgeEx 的内容简化版（唯一真实实现在 loadKnowledgeEx，本函数仅取 content） */
export function loadKnowledge(files: string[], customRoot?: string): string {
  return loadKnowledgeEx(files, customRoot).content;
}
