import path from "node:path";
import { createProject } from "../core/project.js";

/** duanju new 命令入口：创建项目并提示下一步 */
export function runNew(idea: string): void {
  const projectDir = createProject(idea, process.cwd());
  console.log(`项目已创建：${projectDir}`);
  console.log("下一步：");
  console.log(`  cd "${path.basename(projectDir)}"`);
  console.log("  duanju package   # 生成六包（题材归类 → 章纲包）");
}
