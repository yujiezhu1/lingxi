import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_END, GUIDE_START, extractGuide } from "../src/cli/guide.js";

describe("lingxi guide", () => {
  it("extracts the quick-reference block between markers", () => {
    const md = `# t\nintro\n${GUIDE_START}\n## 速查\nA\n${GUIDE_END}\nrest`;
    expect(extractGuide(md)).toBe("## 速查\nA");
  });

  it("docs/USAGE.md contains a non-empty guide block", () => {
    const md = readFileSync(resolve(__dirname, "../docs/USAGE.md"), "utf8");
    expect(md).toContain(GUIDE_START);
    expect(md).toContain(GUIDE_END);
    const g = extractGuide(md);
    expect(g).toContain("三个习惯");
    expect(g).not.toContain("场景一");
  });
});
