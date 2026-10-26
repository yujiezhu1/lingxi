// Manual smoke test for background consultation (real model calls). Not part of `npm test`.
//   node scripts/consult-smoke.mjs <ref> "<question>"
const [ref, ...q] = process.argv.slice(2);
const { LingxiStore } = await import("../dist/core/index.js");
const { estimateConsult, consultSession, fmtEstimate, fmtConsult } = await import("../dist/consult/index.js");
const s = new LingxiStore();
console.log(fmtEstimate(estimateConsult(s, ref)));
try {
  const r = await consultSession(s, ref, q.join(" "), { timeoutMs: 240_000 });
  console.log("\n" + fmtConsult(r));
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  s.close();
}
