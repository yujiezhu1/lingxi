import { LingxiStore } from "../core/store.js";
import { fmtInbox, getPresence, inboxFor, listPresence, markRead, removePresence, touchPresence, upsertPresence } from "../core/messages.js";

/**
 * pi extension: registers the pi session with Lingxi and delivers messages from other sessions in real time.
 * Installed by `lingxi install pi` as ~/.pi/agent/extensions/lingxi.ts (a one-line re-export of this file).
 *
 * - idle session  → the message starts a new turn (set LINGXI_PI_AUTOTRIGGER=0 to only queue it for the next turn)
 * - busy session  → queued as a follow-up, delivered after the current run (never interrupts)
 */

// Minimal structural types so this file does not depend on pi's packages.
interface Ctx {
  isIdle(): boolean;
  hasUI?: boolean;
  ui?: { notify?(msg: string, level?: string): void; setStatus?(key: string, text: string | undefined): void };
  sessionManager: { getSessionId(): string; getCwd(): string };
}
interface PiApi {
  on(event: string, handler: (event: unknown, ctx: Ctx) => unknown): unknown;
  sendMessage(message: { customType: string; content: string; display: boolean }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
  registerCommand?(name: string, def: { description: string; handler: (args: string, ctx: Ctx) => unknown }): void;
}

const POLL_MS = Number(process.env.LINGXI_PI_POLL_MS ?? 3000);
const HEARTBEAT_MS = 15_000;

export default function lingxiPiExtension(pi: PiApi): void {
  let store: LingxiStore | null = null;
  let key: string | null = null;
  let poll: NodeJS.Timeout | null = null;
  let beat: NodeJS.Timeout | null = null;
  let ctxRef: Ctx | null = null;

  const stop = () => {
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
    poll = beat = null;
    try {
      if (store && key) {
        const p = getPresence(store.db, key);
        if (p && p.via === "pi-extension" && p.pid === process.pid) removePresence(store.db, key);
      }
    } catch {
      /* ignore */
    }
    store?.close();
    store = null;
  };

  const deliver = () => {
    if (!store || !key || !ctxRef) return;
    try {
      const me = getPresence(store.db, key);
      if (!me) return;
      const msgs = inboxFor(store.db, me);
      if (!msgs.length) return;
      markRead(store.db, key, msgs.map((m) => m.id));
      const content = `[Lingxi] Messages from other agent sessions:\n\n${fmtInbox(msgs)}`;
      const auto = process.env.LINGXI_PI_AUTOTRIGGER !== "0";
      if (ctxRef.isIdle()) pi.sendMessage({ customType: "lingxi-message", content, display: true }, auto ? { triggerTurn: true } : { deliverAs: "nextTurn" });
      else pi.sendMessage({ customType: "lingxi-message", content, display: true }, { deliverAs: "followUp", triggerTurn: auto });
      if (ctxRef.hasUI) ctxRef.ui?.notify?.(`灵犀：收到 ${msgs.length} 条来自其他会话的消息`, "info");
    } catch {
      /* never break the session */
    }
  };

  pi.on("session_start", (_event, ctx) => {
    stop();
    try {
      ctxRef = ctx;
      store = new LingxiStore({ mirrorVault: false });
      const sid = ctx.sessionManager.getSessionId();
      key = `pi:${sid}`;
      upsertPresence(store.db, { key, agent: "pi", session_native: sid, cwd: ctx.sessionManager.getCwd(), pid: process.pid, via: "pi-extension" });
      beat = setInterval(() => {
        try {
          if (store && key) touchPresence(store.db, key);
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);
      poll = setInterval(deliver, POLL_MS);
      beat.unref?.();
      poll.unref?.();
    } catch {
      stop();
    }
  });

  pi.on("session_shutdown", () => stop());

  pi.registerCommand?.("lingxi", {
    description: "灵犀：查看在线会话和本会话的未读消息",
    handler: (_args, ctx) => {
      if (!store || !key) return ctx.ui?.notify?.("灵犀未连接", "warning");
      const me = getPresence(store.db, key);
      const online = listPresence(store.db).filter((p) => p.agent !== "user");
      const unread = me ? inboxFor(store.db, me).length : 0;
      ctx.ui?.notify?.(
        `你是 ${me?.label ?? key}；在线会话 ${online.length} 个：${online.map((p) => p.label).join("、") || "无"}；未读消息 ${unread} 条`,
        "info",
      );
    },
  });
}
