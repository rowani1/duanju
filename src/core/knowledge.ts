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

/** 按相对 knowledge/ 的路径数组读取并拼接，文件间加分隔标题 */
export function loadKnowledge(files: string[]): string {
  const root = knowledgeRoot();
  const parts: string[] = [];
  for (const rel of files) {
    const full = path.join(root, ...rel.split("/"));
    if (!existsSync(full)) {
      throw new CliError(
        `知识文件不存在：${rel}（查找路径：${full}）。请确认安装包完整，可尝试重新安装：npm i -g duanju-cli。`,
      );
    }
    parts.push(`===== 知识文件：${rel} =====\n\n${readFileSync(full, "utf-8").trim()}`);
  }
  return parts.join("\n\n");
}
