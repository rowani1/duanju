import path from "node:path";
import { CliError } from "../core/errors.js";
import {
  backupFile,
  BLURB_FILE,
  chapterFileName,
  listChapters,
  readArtifact,
  readProject,
  sanitizeFileName,
  writeArtifact,
} from "../core/project.js";

export interface ExportOptions {
  /** 整本合并导出（两个标志都不给时的默认行为） */
  merged?: boolean;
  /** 分章导出到 exports/chapters/ */
  chapters?: boolean;
}

export interface ExportChapter {
  num: number;
  content: string;
}

/** 从 04-标题简介包.md 提取「简介版本」小节正文；小节缺失或为空返回 null */
export function extractBlurb(content: string): string | null {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s*简介版本/.test(line.trim()));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body.length > 0 ? body : null;
}

/** 从章正文首个非空行提取章题（# 第N章 <章题> → 章题）；无章题返回 null */
export function extractChapterTitle(content: string): string | null {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^#{1,6}\s*第\s*\d+\s*章\s*(.*)$/.exec(line);
    return m ? m[1].trim() || null : null;
  }
  return null;
}

/**
 * 章正文 → 导出用纯文本：首行"# 第N章 <章题>"去掉 # 前缀作分隔行；
 * 正文未含"第N章"行时补一行"第N章"分隔（已含章题则不重复）。
 */
export function chapterPlainText(content: string, n: number): string {
  const trimmed = content.trim();
  const lines = trimmed.split("\n");
  const first = (lines[0] ?? "").trim();
  const chapterMark = new RegExp(`第\\s*${n}\\s*章`);
  const heading = /^#{1,6}\s*(.*)$/.exec(first);
  if (heading && chapterMark.test(heading[1])) {
    lines[0] = heading[1].trim();
    return lines.join("\n").trim();
  }
  if (chapterMark.test(first)) {
    return trimmed;
  }
  return `第${n}章\n\n${trimmed}`;
}

/** 整本合并文本：书名 + 简介（可选）+ 各章正文顺序合并（章间以"第X章"行分隔） */
export function buildMergedText(
  title: string,
  blurb: string | null,
  chapters: ExportChapter[],
): string {
  const parts: string[] = [title];
  if (blurb) {
    parts.push(`【简介】\n${blurb}`);
  }
  for (const ch of chapters) {
    parts.push(chapterPlainText(ch.content, ch.num));
  }
  return parts.join("\n\n");
}

/** 分章导出文件名：编号 + 可选章题，如 001-替嫁婚礼.txt / 002.txt */
export function chapterExportName(num: number, chapterTitle: string | null): string {
  const base = String(num).padStart(3, "0");
  const cleaned = chapterTitle ? sanitizeFileName(chapterTitle) : "";
  return cleaned ? `${base}-${cleaned}.txt` : `${base}.txt`;
}

/** exports 下同名文件覆盖前备份 */
function backupIfExists(projectDir: string, rel: string): void {
  if (readArtifact(projectDir, rel) !== null) {
    const backup = backupFile(path.join(projectDir, rel));
    console.log(`已有同名文件，先备份为：${path.basename(backup)}`);
  }
}

/**
 * duanju export：导出成书 txt（纯本地，不调 AI，UTF-8）。
 * --merged 整本合并（默认），--chapters 分章导出；两者可同时使用。
 */
export function runExport(dir: string = process.cwd(), opts: ExportOptions = {}): void {
  const projectDir = path.resolve(dir);
  const project = readProject(projectDir);

  const written = listChapters(projectDir);
  if (written.length === 0) {
    throw new CliError("chapters/ 下还没有任何章节，无内容可导出。请先运行 duanju write 生成正文。");
  }
  const chapters: ExportChapter[] = written.map((entry) => ({
    num: entry.num,
    content: readArtifact(projectDir, `chapters/${chapterFileName(entry.num)}`) ?? "",
  }));

  const doMerged = Boolean(opts.merged) || !opts.chapters;
  const doChapters = Boolean(opts.chapters);

  if (doMerged) {
    const title = project.selectedTitle?.trim() || path.basename(projectDir);
    const blurbSource = readArtifact(projectDir, BLURB_FILE);
    const blurb = blurbSource !== null ? extractBlurb(blurbSource) : null;
    if (blurb === null) {
      console.log(`提示：未能从 ${BLURB_FILE} 提取「简介版本」小节，导出将不含简介。`);
    }
    const rel = `exports/${sanitizeFileName(title) || "未命名"}.txt`;
    backupIfExists(projectDir, rel);
    writeArtifact(projectDir, rel, buildMergedText(title, blurb, chapters));
    console.log(`整本已导出：${rel}（共 ${chapters.length} 章）`);
  }

  if (doChapters) {
    for (const ch of chapters) {
      const rel = `exports/chapters/${chapterExportName(ch.num, extractChapterTitle(ch.content))}`;
      backupIfExists(projectDir, rel);
      writeArtifact(projectDir, rel, chapterPlainText(ch.content, ch.num));
    }
    console.log(`分章已导出：exports/chapters/（共 ${chapters.length} 个 txt）`);
  }
}
