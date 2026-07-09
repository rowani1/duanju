import * as p from "@clack/prompts";

/** clack 取消（Ctrl+C）统一处理：提示后正常退出。默认文案面向生成类命令（产物落盘即状态，重跑可续传）。 */
export function assertNotCancelled<T>(
  value: T | symbol,
  cancelMessage = "已中断。已生成的产物保留在项目目录，重新运行命令可续传。",
): T {
  if (p.isCancel(value)) {
    p.cancel(cancelMessage);
    process.exit(0);
  }
  return value as T;
}
