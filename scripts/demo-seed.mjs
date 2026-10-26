#!/usr/bin/env node
/**
 * Seed an isolated Lingxi home with demo data for screenshots / GIF recording.
 * Never touches your real ~/.lingxi and imports no real sessions.
 *
 *   npm run build
 *   node scripts/demo-seed.mjs [dir]      # prints the LINGXI_HOME to use
 *
 * Pass a short, neutral directory (e.g. D:\lingxi-demo or /tmp/lingxi-demo) so recordings don't show your user name.
 *   export LINGXI_HOME=<printed path> LINGXI_INGEST=none
 *   lingxi topic ls
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { LingxiStore } = await import("../dist/core/index.js");

const home = process.argv[2] || mkdtempSync(join(tmpdir(), "lingxi-demo-"));
mkdirSync(home, { recursive: true });
// A fake, neutral project path (it does not need to exist).
const project = process.platform === "win32" ? "D:/projects/shop-app" : "/home/demo/projects/shop-app";
process.env.LINGXI_INGEST = "none";

const s = new LingxiStore({ home });
const T = "export-feature";

s.createTopic(T, "PDF export for orders: requirements, decisions and progress", project);

const h1 = s.saveHandoff({
  topic: T,
  title: "Requirements from the product sync",
  author_agent: "doubao",
  source_session: "doubao:38440000000000001",
  refs: ["https://example.feishu.cn/docx/export-spec"],
  body_md: `## Goal
Let customers export an order as a PDF invoice.

## Status
Requirements agreed with PM; implementation not started.

## Confirmed conclusions & decisions
- Only A4 portrait, Chinese and English  [ref: https://example.feishu.cn/docx/export-spec]
- Must include company seal image and order QR code

## Constraints
- Deadline: next Friday
- Must work on the existing FastAPI backend

## Key resources
- Spec: https://example.feishu.cn/docx/export-spec
- PM: Alice, Backend owner: Bob

## Suggested next steps
1. Pick a PDF rendering approach
2. Implement /orders/{id}/pdf`,
});

s.remember({ topic: T, kind: "finding", author_agent: "pi", content: "wkhtmltopdf is unmaintained; Playwright renders CJK fonts correctly with NotoSansCJK installed" });
s.remember({ topic: T, kind: "decision", author_agent: "codex", content: "Render PDFs with Playwright (headless Chromium), A4 portrait only" });
s.remember({ topic: T, kind: "constraint", author_agent: "codex", content: "The project uses FastAPI; do not introduce Django" });
s.remember({ topic: T, kind: "dead_end", author_agent: "claude-code", content: "ReportLab: CJK line wrapping breaks table layout — abandoned" });
s.remember({ topic: T, kind: "todo", author_agent: "codex", content: "Add a font check to the Docker image build" });

s.saveHandoff({
  topic: T,
  title: "Export endpoint implemented",
  author_agent: "codex",
  supersedes: h1.id,
  source_session: "codex:da497af449db",
  refs: ["app/export.py", "tests/test_export.py"],
  body_md: `## Goal
Let customers export an order as a PDF invoice.

## Status
/orders/{id}/pdf works locally; tests pass. Not deployed yet.

## Confirmed conclusions & decisions
- Playwright + Jinja2 template, A4 portrait
- Fonts: NotoSansCJK bundled in the image

## Open questions
- Should the seal image be configurable per tenant?

## Suggested next steps
1. Add the font check to the Docker build
2. Deploy to staging and ask PM to verify`,
});

s.createTopic("pdf-research", "Comparison of PDF rendering libraries");
s.remember({ topic: "pdf-research", kind: "finding", author_agent: "pi", content: "Playwright: best CJK support; WeasyPrint: good CSS but slower; ReportLab: low-level" });

s.close();
console.log(home);
