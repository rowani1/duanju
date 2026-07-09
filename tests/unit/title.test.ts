import { describe, expect, it } from "vitest";
import {
  backfillSelectedTitle,
  parseTitleCandidates,
  validateTierOneReasons,
} from "../../src/stages/title.js";

const tier1 = Array.from({ length: 10 }, (_, i) => `替嫁新娘马甲掉不停${String(i + 1).padStart(2, "0")}`);
const tier2 = Array.from({ length: 10 }, (_, i) => `首富爷爷婚礼认亲现场${String(i + 1).padStart(2, "0")}`);

function titlesDoc(t1: string[] = tier1, t2: string[] = tier2): string {
  return `# 书名候选
## 第一梯队（优先推荐）
${t1.map((t, i) => `${i + 1}. 《${t}》——身份感：马甲直给；反转感：当场掀桌`).join("\n")}
## 第二梯队（备选）
${t2.map((t, i) => `${i + 11}. 《${t}》——备选`).join("\n")}

<!-- titles
${t1.map((t, i) => `一梯队${i + 1}: ${t}`).join("\n")}
${t2.map((t, i) => `二梯队${i + 1}: 《${t}》`).join("\n")}
-->`;
}

describe("parseTitleCandidates", () => {
  it("解析两梯队各 10 个候选，并剥掉书名号", () => {
    const parsed = parseTitleCandidates(titlesDoc());
    expect(parsed).not.toBeNull();
    expect(parsed!.tier1).toEqual(tier1);
    expect(parsed!.tier2).toEqual(tier2); // 值带《》也能剥出纯书名
  });

  it("缺少 titles 区块时返回 null", () => {
    expect(parseTitleCandidates("# 书名候选\n1. 《某书》")).toBeNull();
  });
});

describe("validateTierOneReasons", () => {
  it("合格文档通过", () => {
    expect(validateTierOneReasons(titlesDoc())).toEqual([]);
  });

  it("缺分节标题时报错", () => {
    const problems = validateTierOneReasons("# 书名候选\n1. 《某书》——身份感强");
    expect(problems.join("")).toContain("分节标题");
  });

  it("候选不足与空泛理由分别报错", () => {
    const doc = `# 书名候选
## 第一梯队
1. 《替嫁新娘马甲掉了》——很好很强
2. 《首富爷爷来认亲了》——冲突感：当众撕破
## 第二梯队
11. 《某书》`;
    const problems = validateTierOneReasons(doc);
    expect(problems.some((p) => p.includes("仅 2 个"))).toBe(true);
    expect(problems.some((p) => p.includes("未点名具体维度"))).toBe(true);
  });
});

describe("backfillSelectedTitle", () => {
  const pkg04 = `# 标题简介包
## 书名候选
1. 初版候选
## 一句话卖点
钩子`;

  it("无选定书名小节时插入到 H1 之后", () => {
    const updated = backfillSelectedTitle(pkg04, "替嫁新娘马甲掉了");
    const lines = updated.split("\n");
    expect(lines[0]).toBe("# 标题简介包");
    expect(updated).toContain("## 选定书名");
    expect(updated).toContain("《替嫁新娘马甲掉了》");
    // 原有小节保留
    expect(updated).toContain("## 书名候选");
    expect(updated).toContain("## 一句话卖点");
    // 选定书名小节位于书名候选之前
    expect(updated.indexOf("## 选定书名")).toBeLessThan(updated.indexOf("## 书名候选"));
  });

  it("重复回填幂等：替换旧书名而非追加小节", () => {
    const once = backfillSelectedTitle(pkg04, "第一个书名占位用例");
    const twice = backfillSelectedTitle(once, "第二个书名占位用例");
    expect(twice.match(/## 选定书名/g)).toHaveLength(1);
    expect(twice).toContain("《第二个书名占位用例》");
    expect(twice).not.toContain("第一个书名占位用例");
  });

  it("无 H1 时插到文档顶部", () => {
    const updated = backfillSelectedTitle("正文内容", "某个书名");
    expect(updated.split("\n")[1]).toBe("## 选定书名");
  });
});
