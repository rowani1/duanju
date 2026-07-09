/**
 * 已知业务错误：面向用户的中文提示（含下一步建议），入口捕获后只打印 message 并以退出码 1 结束。
 * 与意外异常（程序缺陷/环境问题）区分：后者在入口以「意外错误」提示。
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
