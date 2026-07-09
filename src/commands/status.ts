import path from "node:path";
import { inferProgress, readProject } from "../core/project.js";

/** duanju status 命令入口：展示项目进度（纯本地，不调 AI） */
export function runStatus(dir: string = process.cwd()): void {
  const projectDir = path.resolve(dir);
  const project = readProject(projectDir);
  const progress = inferProgress(projectDir);

  console.log(`项目：${path.basename(projectDir)}`);
  console.log(`题材：${project.idea}`);
  if (project.mainCategory) {
    console.log(`主类：${project.mainCategory}${project.subCategory ? ` / ${project.subCategory}` : ""}`);
  }
  if (project.selectedTitle) {
    console.log(`书名：《${project.selectedTitle}》`);
  }

  console.log("");
  console.log("六包状态：");
  for (const pkg of progress.packages) {
    console.log(`  ${pkg.done ? "[已完成]" : "[未生成]"} ${pkg.file}`);
  }

  console.log("");
  if (progress.titlesGenerated || progress.titleSelected) {
    console.log(
      `书名候选：${progress.titlesGenerated ? "已生成" : "未生成"}，` +
        `${progress.titleSelected ? "已选定" : "未选定"}`,
    );
  }
  if (progress.totalChapters !== undefined) {
    console.log(`章节进度：已写 ${progress.chaptersWritten}/${progress.totalChapters} 章`);
  } else if (progress.chaptersWritten > 0) {
    console.log(`章节进度：已写 ${progress.chaptersWritten} 章（章纲未生成，总章数未知）`);
  }

  console.log("");
  console.log(`下一步：${progress.nextCommand}`);
  console.log(`说明：${progress.nextHint}`);
}
