import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CliError } from "./errors.js";
import type { ModelOverride } from "./llm.js";

/** packaging → title/writing 的九个交接字段（字段名不可增减） */
export const HANDOFF_KEYS = [
  "主类",
  "子类",
  "一句话选题",
  "核心卖点",
  "女主身份",
  "男主身份",
  "核心关系",
  "核心冲突",
  "最强反转",
] as const;

export type HandoffKey = (typeof HANDOFF_KEYS)[number];
export type HandoffFields = Record<HandoffKey, string>;

export interface DuanjuProject {
  idea: string;
  mainCategory?: string;
  subCategory?: string;
  /** package 阶段逐步累积，九字段齐全后才可进入 title/write */
  handoff?: Partial<HandoffFields>;
  selectedTitle?: string;
  modelOverride?: ModelOverride;
  createdAt: string;
}

/** 将解析到的键值合并进 handoff：只收九个已知字段，忽略空值与未知键 */
export function mergeHandoff(
  current: Partial<HandoffFields> | undefined,
  incoming: Record<string, string>,
): Partial<HandoffFields> {
  const merged: Partial<HandoffFields> = { ...current };
  for (const key of HANDOFF_KEYS) {
    const value = incoming[key]?.trim();
    if (value) merged[key] = value;
  }
  return merged;
}

/** 返回缺失的交接字段名（九字段齐全时为空数组） */
export function missingHandoffFields(handoff?: Partial<HandoffFields>): HandoffKey[] {
  return HANDOFF_KEYS.filter((key) => !handoff?.[key]?.trim());
}

/** 取项目主类（知识文件按主类动态选择的依据）；缺失时抛中文错误。packaging/title/writing 共用。 */
export function requireMainCategory(project: DuanjuProject): string {
  const category = project.mainCategory ?? project.handoff?.主类;
  if (!category) {
    throw new CliError(
      "尚未确定主类（题材归类步骤未完成或 01-题材归类.md 的 handoff 区块缺失）。请先运行 duanju package 生成六包，必要时加 --force 重做。",
    );
  }
  return category;
}

/** 命令层共用的六包产物文件名（write/title/revise/export 等按名引用，单一来源） */
export const PERSONA_FILE = "03-人设包.md";
export const BLURB_FILE = "04-标题简介包.md";
export const OPENING_FILE = "05-开篇包.md";
export const OUTLINE_FILE = "06-章纲包.md";

/** 书名候选产物文件名（title 生成，进度推断按名探测） */
export const TITLES_FILE = "titles.md";

/** 六包产物文件名（顺序即生成顺序） */
export const PACKAGE_FILES = [
  "01-题材归类.md",
  "02-题材包.md",
  PERSONA_FILE,
  BLURB_FILE,
  OPENING_FILE,
  OUTLINE_FILE,
] as const;

const PROJECT_META = "duanju.json";

export function projectMetaPath(dir: string): string {
  return path.join(dir, PROJECT_META);
}

/** 目录是否已是 duanju 项目（存在 duanju.json）；run 全自动模式据此复用/跳过 new */
export function isProject(dir: string): boolean {
  return existsSync(projectMetaPath(dir));
}

/** 读取项目元数据；缺失/损坏/缺必需字段时抛中文错误（duanju.json 的唯一解析入口） */
export function readProject(dir: string): DuanjuProject {
  const file = projectMetaPath(dir);
  if (!existsSync(file)) {
    throw new CliError(
      `当前目录不是 duanju 项目（缺少 ${PROJECT_META}）。请先运行 duanju new "<题材一句话>" 创建项目，或进入项目目录后重试。`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    throw new CliError(
      `${PROJECT_META} 不是合法 JSON（${file}）。请检查最近的手动修改并修复，或重新运行 duanju new 创建项目。`,
    );
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { idea?: unknown }).idea !== "string") {
    throw new CliError(
      `${PROJECT_META} 缺少必需字段 idea（${file}）。请检查最近的手动修改并修复，或重新运行 duanju new 创建项目。`,
    );
  }
  return parsed as DuanjuProject;
}

/** 写入项目元数据（UTF-8） */
export function writeProject(dir: string, project: DuanjuProject): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(projectMetaPath(dir), JSON.stringify(project, null, 2) + "\n", "utf-8");
}

/**
 * 创建项目目录（duanju.json + chapters/ + state/ + exports/），返回项目绝对路径。
 * 题材为空或目录已存在时抛中文错误。
 */
export function createProject(idea: string, parentDir: string): string {
  const trimmed = idea.trim();
  if (!trimmed) {
    throw new CliError('题材不能为空。用法：duanju new "<题材一句话>"');
  }
  const dirName = sanitizeProjectDirName(trimmed);
  const projectDir = path.resolve(parentDir, dirName);
  if (existsSync(projectDir)) {
    throw new CliError(`目录已存在：${projectDir}。请换一个题材表述，或删除/重命名旧目录后重试。`);
  }
  mkdirSync(projectDir, { recursive: true });
  for (const sub of ["chapters", "state", "exports"]) {
    mkdirSync(path.join(projectDir, sub));
  }
  const project: DuanjuProject = { idea: trimmed, createdAt: new Date().toISOString() };
  writeProject(projectDir, project);
  return projectDir;
}

/** 文件名清洗：过滤 Windows 非法路径字符/控制字符/空白，去首尾点（可能返回空串，调用方兜底） */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f\s]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

/** 目录名清洗：复用文件名清洗，取前 10 个字 */
export function sanitizeProjectDirName(idea: string): string {
  const cleaned = sanitizeFileName(idea).slice(0, 10).replace(/^\.+|\.+$/g, "");
  return cleaned.length > 0 ? cleaned : "未命名项目";
}

/**
 * 读取项目目录下的产物文件（UTF-8）；不存在返回 null。
 * 产物读取的统一入口，命令层不直接操作 fs。
 */
export function readArtifact(dir: string, file: string): string | null {
  const full = path.join(dir, file);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf-8");
}

/** 写入项目目录下的产物文件（UTF-8，保证尾部换行）。命令层写产物的统一入口。 */
export function writeArtifact(dir: string, file: string, content: string): void {
  const full = path.join(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content.endsWith("\n") ? content : content + "\n", "utf-8");
}

/** 覆盖前备份：复制为 <file>.bak-<yyyyMMdd-HHmmss>（Windows 安全字符），返回备份绝对路径 */
export function backupFile(file: string): string {
  const now = new Date();
  const pad = (v: number): string => String(v).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backup = `${file}.bak-${stamp}`;
  copyFileSync(file, backup);
  return backup;
}

/** 章节文件名：001 起三位数 */
export function chapterFileName(n: number): string {
  return `${String(n).padStart(3, "0")}.md`;
}

export interface ChapterEntry {
  num: number;
  file: string;
}

/** 枚举 chapters/ 下的 NNN.md，按编号升序 */
export function listChapters(dir: string): ChapterEntry[] {
  const chaptersDir = path.join(dir, "chapters");
  if (!existsSync(chaptersDir)) return [];
  const entries: ChapterEntry[] = [];
  for (const name of readdirSync(chaptersDir)) {
    const m = /^(\d{3})\.md$/.exec(name);
    if (m) entries.push({ num: Number(m[1]), file: path.join(chaptersDir, name) });
  }
  return entries.sort((a, b) => a.num - b.num);
}

/** 从章纲包内容解析总章数：取「第N章」的最大 N，无匹配返回 0 */
export function countOutlineChapters(content: string): number {
  let max = 0;
  for (const m of content.matchAll(/第\s*(\d+)\s*章/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * 从章纲包内容提取第 n 章的章纲块：自「第n章」标题行起，
 * 至下一个章标题或更高层级标题（# / ##）止。未找到返回 null。
 */
export function extractChapterOutline(content: string, n: number): string | null {
  const lines = content.split("\n");
  const chapterOf = (line: string): number | null => {
    const m = /^#{1,6}\s*第\s*(\d+)\s*章/.exec(line.trim());
    return m ? Number(m[1]) : null;
  };
  const start = lines.findIndex((line) => chapterOf(line) === n);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (chapterOf(line) !== null || /^#{1,2}\s/.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

export interface PackageStatus {
  file: string;
  done: boolean;
}

export interface ProjectProgress {
  packages: PackageStatus[];
  packagesDone: boolean;
  titlesGenerated: boolean;
  titleSelected: boolean;
  chaptersWritten: number;
  /** 章纲包解析出的总章数；章纲未生成或解析不到时为 undefined */
  totalChapters?: number;
  nextCommand: string;
  nextHint: string;
}

/** 由产物文件存在性 + duanju.json 推断项目进度与下一步命令 */
export function inferProgress(dir: string): ProjectProgress {
  const project = readProject(dir);

  const packages: PackageStatus[] = PACKAGE_FILES.map((file) => ({
    file,
    done: existsSync(path.join(dir, file)),
  }));
  const packagesDone = packages.every((s) => s.done);
  const titlesGenerated = existsSync(path.join(dir, TITLES_FILE));
  const titleSelected = Boolean(project.selectedTitle);
  const chaptersWritten = listChapters(dir).length;

  let totalChapters: number | undefined;
  const outlinePath = path.join(dir, OUTLINE_FILE);
  if (existsSync(outlinePath)) {
    const n = countOutlineChapters(readFileSync(outlinePath, "utf-8"));
    if (n > 0) totalChapters = n;
  }

  let nextCommand: string;
  let nextHint: string;
  if (!packagesDone) {
    const missing = packages.filter((s) => !s.done).map((s) => s.file);
    nextCommand = "duanju package";
    nextHint = `六包尚未齐全（缺 ${missing.join("、")}），运行 duanju package 生成/续传。`;
  } else if (!titleSelected) {
    nextCommand = "duanju title";
    nextHint = titlesGenerated
      ? "候选书名已生成但未选定，运行 duanju title 完成选定与回填。"
      : "六包已齐全，运行 duanju title 生成书名候选。";
  } else if (totalChapters !== undefined && chaptersWritten >= totalChapters) {
    nextCommand = "duanju export";
    nextHint = `全部 ${totalChapters} 章已完成，运行 duanju export 导出成书。`;
  } else {
    nextCommand = "duanju write";
    nextHint =
      totalChapters !== undefined
        ? `已写 ${chaptersWritten}/${totalChapters} 章，运行 duanju write 继续写下一章。`
        : "书名已选定，运行 duanju write 开始逐章写作。";
  }

  return {
    packages,
    packagesDone,
    titlesGenerated,
    titleSelected,
    chaptersWritten,
    totalChapters,
    nextCommand,
    nextHint,
  };
}
