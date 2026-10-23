import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LingxiStore, fmtTimeline, matchProject, normalizeProjectPath, parseTimeBound } from "../src/core/index.js";

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

describe("project paths", () => {
  it("normalizes Windows paths", () => {
    expect(normalizeProjectPath("d:\\Proj\\App\\", "win32")).toBe("D:/Proj/App");
  });

  it("matches exact / ancestor / descendant, case-insensitive on Windows", () => {
    expect(matchProject("D:/proj", "d:\\PROJ", "win32")).toBe("exact");
    expect(matchProject("D:/proj", "D:/proj/apps/web", "win32")).toBe("ancestor");
    expect(matchProject("D:/proj/apps/web", "D:/proj", "win32")).toBe("descendant");
    expect(matchProject("D:/proj", "D:/project-other", "win32")).toBeNull();
  });
});

describe("topic ↔ project binding", () => {
  it("binds on create, lists by project and unbinds", () => {
    const proj = join(home, "repo");
    store.createTopic("仓库主线", "项目背景与进度", proj);
    store.createTopic("子包重构");
    store.linkTopic("子包重构", "project", join(proj, "packages", "core"));
    store.createTopic("无关");

    const fromRoot = store.listTopics({ project: proj });
    expect(fromRoot.map((t) => [t.name, t.match])).toEqual([
      ["仓库主线", "exact"],
      ["子包重构", "descendant"],
    ]);
    const fromSub = store.listTopics({ project: join(proj, "packages", "core", "src") });
    expect(fromSub.map((t) => t.name).sort()).toEqual(["仓库主线", "子包重构"].sort());
    expect(store.listTopics({ project: join(home, "elsewhere") })).toHaveLength(0);

    const ov = store.topicOverview("仓库主线");
    expect(ov.projects).toEqual([normalizeProjectPath(proj)]);
    expect(ov.links).toHaveLength(0); // project links are reported separately

    expect(store.unlinkTopic("仓库主线", "project", proj.toUpperCase())).toBe(process.platform === "win32");
    if (process.platform === "win32") expect(store.topicProjects("仓库主线")).toEqual([]);
  });
});

describe("timeline", () => {
  it("lists topic events chronologically including superseded/archived items", async () => {
    const proj = join(home, "repo");
    store.createTopic("主线", null, proj);
    const tick = () => new Promise((r) => setTimeout(r, 5));
    await tick();
    const h1 = store.saveHandoff({ title: "v1 现状", body_md: "初版", topic: "主线", author_agent: "codex" });
    await tick();
    const c = store.remember({ kind: "decision", content: "采用方案B", topic: "主线" });
    await tick();
    store.saveHandoff({ title: "v2 现状", body_md: "新版", topic: "主线", supersedes: h1.id });
    await tick();
    store.forget(c.id);

    const ev = store.timeline({ topic: "主线" });
    expect(ev.map((e) => e.type)).toEqual(["topic", "link", "handoff", "card", "handoff"]);
    expect(ev.find((e) => e.id === h1.id)?.status).toBe("superseded");
    expect(ev.find((e) => e.id === c.id)?.status).toBe("archived");

    expect(store.timeline({ topic: "主线", includeInactive: false }).map((e) => e.type)).toEqual(["topic", "link", "handoff"]);
    expect(store.timeline({ topic: "主线", order: "desc", limit: 1 })[0]?.text).toBe("v2 现状");

    const byProject = store.timeline({ project: join(proj, "src") });
    expect(byProject).toHaveLength(5);
    const text = fmtTimeline(byProject, store, { showTopic: true });
    expect(text).toContain("{主线}");
    expect(text).toContain("(by codex)");
    expect(text).toMatch(/^## \d{4}-\d{2}-\d{2}/);
  });

  it("filters by since/until", () => {
    store.saveHandoff({ title: "x", body_md: "y", topic: "T" });
    const future = Date.now() + 60_000;
    expect(store.timeline({ topic: "T", since: future })).toHaveLength(0);
    expect(store.timeline({ topic: "T", until: future }).length).toBeGreaterThan(0);
  });
});

describe("parseTimeBound", () => {
  const now = new Date(2026, 9, 23, 12, 0, 0).getTime();
  it("parses relative and absolute values", () => {
    expect(parseTimeBound("7d", { now })).toBe(now - 7 * 86_400_000);
    expect(parseTimeBound("2026-10-01")).toBe(new Date(2026, 9, 1).getTime());
    expect(parseTimeBound("2026-10-01", { endOfDay: true })).toBe(new Date(2026, 9, 1, 23, 59, 59, 999).getTime());
    expect(parseTimeBound(undefined)).toBeUndefined();
    expect(() => parseTimeBound("yesterday")).toThrow(/Cannot parse/);
  });
});
