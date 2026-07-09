import { findCustomHits } from "../core/knowledge.js";
import { readGlobalConfig, resolveKnowledgePath } from "../core/llm.js";
import type { DuanjuProject } from "../core/project.js";

/**
 * 命令层的自定义知识库句柄：解析后的根目录 + 命中提示（去重，只在首次命中时打印）。
 * core 不做终端输出，命中清单的打印统一收敛在这里（commands 层）。
 */
export interface CustomKnowledge {
  /** 解析并校验后的自定义知识库根目录；未配置为 undefined */
  root: string | undefined;
  /** 生成前调用：对 files 探测自定义命中，打印尚未播报过的文件（同一命令内去重） */
  announce(files: string[]): void;
}

/**
 * 按三级优先级解析自定义知识库根目录（命令行参数 > 项目 duanju.json > 全局配置），
 * 并返回带去重播报能力的句柄。五个调模型命令共用。
 */
export function setupCustomKnowledge(
  cliArg: string | undefined,
  projectDir: string,
  project: DuanjuProject,
): CustomKnowledge {
  const root = resolveKnowledgePath({
    cliArg,
    projectDir,
    projectValue: project.knowledgePath,
    globalValue: readGlobalConfig()?.knowledgePath,
  });

  const announced = new Set<string>();
  return {
    root,
    announce(files: string[]): void {
      const hits = findCustomHits(files, root).filter((rel) => !announced.has(rel));
      if (hits.length === 0) return;
      for (const rel of hits) announced.add(rel);
      console.log(`使用自定义知识文件：${hits.join("、")}（共 ${hits.length} 个）`);
    },
  };
}
