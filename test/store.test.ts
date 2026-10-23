import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LingxiStore } from "../src/core/index.js";

let home: string;
let store: LingxiStore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lingxi-test-"));
  store = new LingxiStore({ home });
});
afterEach(() => {
  store.close();
  rmSync(home, { recursive: true, force: true });
});

describe("topics", () => {
  it("creates, finds case-insensitively and rejects duplicates", () => {
    const t = store.createTopic("Feishu-Sync", "飞书同步需求");
    expect(store.findTopic("feishu-sync")?.id).toBe(t.id);
    expect(store.findTopic(t.id)?.name).toBe("Feishu-Sync");
    expect(() => store.createTopic("FEISHU-SYNC")).toThrow(/exists/);
  });

  it("auto-creates topics when saving handoffs and links items", () => {
    const h = store.saveHandoff({ title: "调研结论", body_md: "## 结论\n方案 B 更好", topic: "调研X" });
    const ov = store.topicOverview("调研X");
    expect(ov.latestHandoff?.id).toBe(h.id);
    store.linkTopic("调研X", "session", "pi:01a16790", "调研会话");
    store.linkTopic("调研X", "session", "pi:01a16790"); // idempotent
    expect(store.topicOverview("调研X").links).toHaveLength(1);
  });
});

describe("handoffs", () => {
  it("mirrors to vault markdown with frontmatter", () => {
    const h = store.saveHandoff({
      title: "需求对接",
      body_md: "## 目标\n同步飞书文档",
      topic: "需求A",
      author_agent: "doubao",
      refs: ["https://feishu.cn/docx/abc", "https://feishu.cn/docx/abc"],
    });
    expect(h.refs).toEqual(["https://feishu.cn/docx/abc"]);
    const text = readFileSync(h.file_path!, "utf8");
    expect(text).toContain(`id: ${h.id}`);
    expect(text).toContain('topic: "需求A"');
    expect(text).toContain("同步飞书文档");
  });

  it("supersedes older handoffs", () => {
    const a = store.saveHandoff({ title: "v1", body_md: "old", topic: "T" });
    const b = store.saveHandoff({ title: "v2", body_md: "new", topic: "T", supersedes: a.id });
    expect(store.getHandoff(a.id).status).toBe("superseded");
    expect(store.latestHandoff("T")?.id).toBe(b.id);
    expect(store.listHandoffs({ topic: "T" })).toHaveLength(1);
    expect(store.listHandoffs({ topic: "T", includeSuperseded: true })).toHaveLength(2);
  });
});

describe("cards and search", () => {
  it("searches CJK with long (FTS) and short (LIKE) terms, filtered by topic", () => {
    store.saveHandoff({ title: "性能调研", body_md: "方案B在一万QPS下延迟低于20毫秒", topic: "调研X" });
    store.remember({ kind: "decision", content: "采用方案B作为默认实现", topic: "开发Y" });
    store.remember({ kind: "fact", content: "项目实际使用 FastAPI 框架", topic: "开发Y" });

    expect(store.search("方案B").length).toBe(2); // FTS (3 chars)
    expect(store.search("延迟").length).toBe(1); // LIKE fallback (2 chars)
    expect(store.search("方案B", { topic: "开发Y" })).toHaveLength(1);
    expect(store.search("FastAPI")[0]?.doc_type).toBe("card");
    expect(store.search("方案B 默认")[0]?.snippet).toContain("«");
  });

  it("forget removes a card from search", () => {
    const c = store.remember({ kind: "todo", content: "补充基准测试脚本" });
    expect(store.search("基准测试")).toHaveLength(1);
    store.forget(c.id);
    expect(store.search("基准测试")).toHaveLength(0);
    expect(store.listCards()).toHaveLength(0);
  });

  it("excludes superseded handoffs from search by default", () => {
    const a = store.saveHandoff({ title: "旧版结论", body_md: "过时的结论内容", topic: "T" });
    store.saveHandoff({ title: "新版结论", body_md: "最新的结论内容", topic: "T", supersedes: a.id });
    expect(store.search("结论内容")).toHaveLength(1);
    expect(store.search("结论内容", { includeSuperseded: true })).toHaveLength(2);
  });
});

describe("concurrency", () => {
  it("two store instances share one database", () => {
    const other = new LingxiStore({ home });
    store.saveHandoff({ title: "from A", body_md: "written by agent A", topic: "shared" });
    expect(other.latestHandoff("shared")?.title).toBe("from A");
    other.close();
  });
});
