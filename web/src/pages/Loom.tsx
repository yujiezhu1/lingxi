import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../router";
import type { WeaveData } from "../types";
import { prefersReducedMotion, useTheme } from "../theme";
import { KINDS, agentColor, agentName, fmtTime } from "../ui";

const LABEL_W = 116;
const RIGHT_PAD = 18;
const LANE_H = 46;
const HOUR = 3_600_000;
const ORDER = ["claude-code", "codex", "pi", "cursor", "doubao", "workbuddy", "user"];

type Tip = { x: number; y: number; html: React.ReactNode } | null;

/**
 * 今日织机 — one thread per agent session across the day; brass knots where handoffs / cards were saved;
 * dashed arcs where a message passed from one agent to another.
 */
export function Loom({ data, isToday }: { data: WeaveData; isToday: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  const [tip, setTip] = useState<Tip>(null);
  const [now, setNow] = useState(Date.now());
  const night = useTheme() === "night";
  const motion = night && !prefersReducedMotion();
  const TOP = night ? 54 : 34;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      ro.disconnect();
      clearInterval(t);
    };
  }, []);

  const model = useMemo(() => {
    const dayStart = new Date(data.since);
    dayStart.setHours(0, 0, 0, 0);
    const d0 = dayStart.getTime();
    let first = d0 + 8 * HOUR;
    let last = d0 + 20 * HOUR;
    const consider = (t: number) => {
      first = Math.min(first, t);
      last = Math.max(last, t);
    };
    for (const l of data.lanes) for (const s of l.sessions) for (const [a, b] of s.segments) consider(a), consider(b);
    for (const k of data.knots) consider(k.ts);
    for (const k of data.links) consider(k.ts);
    if (isToday) last = Math.max(last, now + HOUR / 2);
    const t0 = Math.floor((first - d0) / HOUR) * HOUR + d0;
    const t1 = Math.min(d0 + 24 * HOUR, Math.ceil((last - d0) / HOUR) * HOUR + d0);

    const agents = new Set<string>(data.lanes.map((l) => l.agent));
    for (const k of data.knots) agents.add(k.agent);
    for (const k of data.links) agents.add(k.from_agent), agents.add(k.to_agent);
    agents.delete("cli");
    const order = [...agents].sort((a, b) => (ORDER.indexOf(a) + 99) % 99 - ((ORDER.indexOf(b) + 99) % 99));

    // stack overlapping sessions inside a lane into up to 3 sub-rows
    const rows = new Map<string, number>();
    const rowCount = new Map<string, number>();
    for (const l of data.lanes) {
      const ends: number[] = [];
      for (const s of l.sessions) {
        const start = s.segments[0]![0];
        let r = ends.findIndex((e) => e + 10 * 60_000 < start);
        if (r === -1) r = Math.min(ends.length, 2);
        ends[r] = Math.max(ends[r] ?? 0, s.segments[s.segments.length - 1]![1]);
        rows.set(s.id, r);
      }
      rowCount.set(l.agent, Math.max(1, Math.min(3, ends.length)));
    }
    return { t0, t1, order, rows, rowCount };
  }, [data, isToday, now]);

  const { t0, t1, order, rows, rowCount } = model;
  const plotW = Math.max(200, width - LABEL_W - RIGHT_PAD);
  const x = (t: number) => LABEL_W + ((t - t0) / (t1 - t0)) * plotW;
  const laneY = (agent: string) => TOP + order.indexOf(agent) * LANE_H + LANE_H / 2;
  const height = TOP + Math.max(1, order.length) * LANE_H + 20;
  const hours: number[] = [];
  const step = (t1 - t0) / HOUR > 14 ? 2 : 1;
  for (let t = t0; t <= t1; t += HOUR * step) hours.push(t);

  const show = (e: React.MouseEvent, html: React.ReactNode) => setTip({ x: e.clientX + 14, y: e.clientY + 14, html });
  const hide = () => setTip(null);

  if (order.length === 0) {
    return (
      <div className="loom" ref={wrap}>
        <div className="empty">
          <b>这一天还没有织出任何线</b>各个 agent 一开始工作，它们的线就会出现在这里。
        </div>
      </div>
    );
  }

  let laneIndex = 0;
  return (
    <div className="loom" ref={wrap}>
      <svg height={height} viewBox={`0 0 ${width} ${height}`} className="loom-draw" role="img" aria-label="今日各 agent 的工作时间线">
        <defs>
          <filter id="glow" filterUnits="userSpaceOnUse" x={-20} y={-20} width={width + 40} height={height + 40}>
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-strong" filterUnits="userSpaceOnUse" x={-20} y={-20} width={width + 40} height={height + 40}>
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="now-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={height}>
            <stop offset="0" stopColor="#5eead4" stopOpacity="1" />
            <stop offset="1" stopColor="#5eead4" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5eead4" stopOpacity="0" />
            <stop offset="0.5" stopColor="#99f6e4" stopOpacity="0.16" />
            <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--moss)" />
          </marker>
        </defs>
        {hours.map((t) => (
          <g key={t}>
            <line className="hour" x1={x(t)} x2={x(t)} y1={TOP - 8} y2={height - 4} />
            <text className="hour-label" x={x(t)} y={TOP - 18} textAnchor="middle">
              {fmtTime(t, false)}
            </text>
          </g>
        ))}
        {order.map((a) => (
          <g key={a}>
            <rect className="lane-band" x={LABEL_W - 6} y={laneY(a) - 13} width={plotW + 12} height={26} rx={13} fill={agentColor(a)} fillOpacity={0.07} />
            <circle cx={12} cy={laneY(a)} r={5} fill={agentColor(a)} filter={night ? "url(#glow-strong)" : undefined} />
            <text className="lane-label" x={24} y={laneY(a) + 4.5}>
              {agentName(a)}
            </text>
            <line className="lane-rule" x1={LABEL_W} x2={width - RIGHT_PAD} y1={laneY(a)} y2={laneY(a)} />
          </g>
        ))}
        {data.lanes.map((l) => {
          const n = rowCount.get(l.agent) ?? 1;
          const sw = night ? (n > 1 ? 7 : 10) : n > 1 ? 6 : 8;
          const li = laneIndex++;
          return l.sessions.map((s) => {
            const r = rows.get(s.id) ?? 0;
            const y = laneY(l.agent) + (r - (n - 1) / 2) * 8;
            return s.segments.map(([a, b], i) => {
              const x1 = x(a);
              const x2 = Math.max(x(b), x1 + 9);
              const len = Math.ceil(x2 - x1) + 2;
              return (
                <g key={`${s.id}-${i}`}>
                <line
                  className="thread"
                  filter={night ? "url(#glow)" : undefined}
                  x1={x1}
                  x2={x2}
                  y1={y}
                  y2={y}
                  stroke={agentColor(l.agent)}
                  strokeWidth={sw}
                  style={{ ["--len" as string]: `${len}px`, ["--delay" as string]: `${li * 0.09 + i * 0.05}s` }}
                  onMouseMove={(e) =>
                    show(
                      e,
                      <>
                        <b>{s.title || "（无标题会话）"}</b>
                        <br />
                        <span className="faint">
                          {agentName(l.agent)} · {fmtTime(a, false)}–{fmtTime(b, false)} · 共 {s.turns} 条
                        </span>
                      </>,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={() => navigate(`/sessions/${encodeURIComponent(s.id)}`)}
                />
                {x2 - x1 > 14 && <circle className="cap" cx={x1 + sw / 2} cy={y} r={sw / 3.2} pointerEvents="none" />}
                {x2 - x1 > 14 && <circle className="cap" cx={x2 - sw / 2} cy={y} r={sw / 3.2} pointerEvents="none" />}
                </g>
              );
            });
          });
        })}
        {data.links.map((k) => {
          const xa = x(k.ts);
          const ya = laneY(k.from_agent);
          const yb = laneY(k.to_agent);
          if (Number.isNaN(ya) || Number.isNaN(yb) || ya === yb) return null;
          const xb = xa + 22;
          const d = `M ${xa} ${ya} C ${xa + 18} ${ya}, ${xb - 14} ${yb}, ${xb} ${yb + (yb > ya ? -6 : 6)}`;
          return (
            <g key={k.id}>
            {motion && (
              <circle className="particle" r={2.3}>
                <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
              </circle>
            )}
            <path
              className="link"
              filter={night ? "url(#glow-strong)" : undefined}
              d={d}
              markerEnd="url(#arrow)"
              onMouseMove={(e) =>
                show(
                  e,
                  <>
                    <b>
                      {k.from_label ?? agentName(k.from_agent)} → {k.to_label ?? agentName(k.to_agent)}
                    </b>{" "}
                    <span className="faint">{fmtTime(k.ts, false)}</span>
                    <br />
                    {k.body.length > 120 ? k.body.slice(0, 120) + "…" : k.body}
                  </>,
                )
              }
              onMouseLeave={hide}
              onClick={() => navigate("/messages")}
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
            />
            </g>
          );
        })}
        {data.knots.map((k) => (
          <circle
            key={k.id}
            className="knot"
            cx={x(k.ts)}
            cy={laneY(k.agent)}
            r={5}
            onMouseMove={(e) =>
              show(
                e,
                <>
                  <b>{k.type === "handoff" ? "交接包" : KINDS[k.kind ?? "note"]}</b> <span className="faint">· {k.topic ?? "未归类"} · {fmtTime(k.ts, false)}</span>
                  <br />
                  {k.text.length > 120 ? k.text.slice(0, 120) + "…" : k.text}
                </>,
              )
            }
            onMouseLeave={hide}
            onClick={() => k.topic_id && navigate(`/topics/${encodeURIComponent(k.topic_id)}`)}
          />
        ))}
        {motion && (
          <rect x={LABEL_W} y={TOP - 8} width={140} height={height - TOP + 4} fill="url(#sweep)" pointerEvents="none">
            <animate attributeName="x" from={LABEL_W - 140} to={width} dur="7s" repeatCount="indefinite" />
          </rect>
        )}
        {isToday && now >= t0 && now <= t1 && (
          night ? (
            <g>
              <line className="now" x1={x(now)} x2={x(now)} y1={22} y2={height - 6} />
              <rect x={x(now) - 40} y={4} width={80} height={20} rx={10} fill="rgba(94,234,212,0.14)" stroke="#5eead4" strokeOpacity={0.7} />
              <text className="now-label" x={x(now)} y={18} textAnchor="middle">
                {fmtTime(now, false)} 进行中
              </text>
            </g>
          ) : (
            <g>
              <line className="now" x1={x(now)} x2={x(now)} y1={TOP - 6} y2={height - 16} />
              <text className="now-label" x={x(now)} y={height - 3} textAnchor="middle">
                现在 {fmtTime(now, false)}
              </text>
            </g>
          )
        )}
      </svg>
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y }}>
          {tip.html}
        </div>
      )}
    </div>
  );
}
