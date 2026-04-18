"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { SessionRole } from "../../lib/types";

// ── Constants ──────────────────────────────────────────────────────────────

const NR = 40;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const ROLE_COLOR: Record<SessionRole, string> = {
  Requester:   "#4ECDC4",
  Contributor: "#818CF8",
  Reviewer:    "#F59E0B",
  Observer:    "#64748B",
};

const HUMAN_COLOR = "#F0A500";

type MessageType = "TASK" | "DELIVERABLE" | "VERIFYING" | "EXIT KEY" | "SYSTEM";
type SessionStatus = "OPEN" | "VERIFYING" | "CLOSED_SUCCESS" | "CLOSED_DISPUTED";

const MSG_COLOR: Record<MessageType, { bg: string; text: string; border: string }> = {
  TASK:        { bg: "rgba(129,140,248,0.12)", text: "#818CF8", border: "rgba(129,140,248,0.35)" },
  DELIVERABLE: { bg: "rgba(78,205,196,0.12)",  text: "#4ECDC4", border: "rgba(78,205,196,0.35)"  },
  VERIFYING:   { bg: "rgba(245,158,11,0.12)",  text: "#F59E0B", border: "rgba(245,158,11,0.35)"  },
  "EXIT KEY":  { bg: "rgba(168,85,247,0.12)",  text: "#A855F7", border: "rgba(168,85,247,0.35)"  },
  SYSTEM:      { bg: "rgba(100,116,139,0.12)", text: "#94A3B8", border: "rgba(100,116,139,0.35)" },
};

const STATUS_STEP: Record<SessionStatus, number> = {
  OPEN: 1, VERIFYING: 2, CLOSED_SUCCESS: 3, CLOSED_DISPUTED: 3,
};

// ── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  x: number;
  y: number;
  label: string;
  role: SessionRole;
  isHuman?: boolean;
}

interface GraphEdge {
  fromId: string;
  toId: string;
}

interface Message {
  id: string;
  agentId: string;
  agentName: string;
  agentOrg: string;
  role: SessionRole;
  type: MessageType;
  content: string;
  sigValid: boolean;
  ts: string;
  isHuman?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(/[-\s]/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_GRAPH_NODES: GraphNode[] = [
  { id: "human",  x: 200, y:  80, label: "YOU",      role: "Requester",   isHuman: true },
  { id: "nexus",  x: 360, y: 200, label: "Nexus-7",  role: "Contributor" },
  { id: "aria",   x: 300, y: 370, label: "Aria-ML",  role: "Contributor" },
  { id: "sigma",  x:  80, y: 280, label: "Sigma-QA", role: "Reviewer"    },
];

const MOCK_GRAPH_EDGES: GraphEdge[] = [
  { fromId: "human", toId: "nexus"  },
  { fromId: "nexus", toId: "aria"   },
  { fromId: "aria",  toId: "sigma"  },
  { fromId: "sigma", toId: "human"  },
  { fromId: "human", toId: "aria"   },
];

function makeMockMessages(sid: string): Message[] {
  const now = () => new Date().toISOString();
  return [
    {
      id: "m0", agentId: "system", agentName: "AgentLink", agentOrg: "Protocol",
      role: "Observer", type: "SYSTEM", sigValid: true, ts: now(),
      content: `Session ${sid} opened. 4 participants connected. Contract hash: 0x7f3a…c912. All agents verified on-chain.`,
    },
    {
      id: "m1", agentId: "human", agentName: "YOU", agentOrg: "Human",
      role: "Requester", type: "TASK", sigValid: true, ts: now(), isHuman: true,
      content: "Build a Python data pipeline that ingests daily sales CSV, computes rolling 30-day revenue by product category, and outputs an interactive chart dashboard. Deliverable: working code + README.",
    },
    {
      id: "m2", agentId: "nexus", agentName: "Nexus-7", agentOrg: "Claude · API Specialist",
      role: "Contributor", type: "TASK", sigValid: true, ts: now(),
      content: "Acknowledged. I will scaffold the REST API and data ingestion layer. Aria-ML: please own the analytics engine and chart generation. Sigma-QA: prepare automated test suite for both components once deliverable is ready.",
    },
    {
      id: "m3", agentId: "aria", agentName: "Aria-ML", agentOrg: "LangChain · ML Specialist",
      role: "Contributor", type: "DELIVERABLE", sigValid: true, ts: now(),
      content: "Deliverable complete.\n\n• pipeline.py — 218 lines, ingests CSV, computes rolling 30-day revenue by category\n• dashboard.py — interactive Plotly chart with date-range filters and category drill-down\n• README.md — setup, usage, and test instructions\n\nAll contract criteria met. Awaiting QA verification.",
    },
    {
      id: "m4", agentId: "sigma", agentName: "Sigma-QA", agentOrg: "AutoGen · QA Specialist",
      role: "Reviewer", type: "VERIFYING", sigValid: true, ts: now(),
      content: "QA complete.\n\n✓ 14/14 tests passed\n✓ Code quality 94/100\n✓ Correctness verified on 3-month synthetic dataset\n✓ No regressions on edge cases (empty CSV, single category, leap year boundary)\n\nDeliverable meets all contract criteria. Recommend CONFORME.",
    },
  ];
}

function buildGraphFromParticipants(participants: Array<{
  agent_id: string;
  name: string;
  role: SessionRole;
  is_human?: boolean;
}>): GraphNode[] {
  const count = participants.length;
  const r = count <= 1 ? 0 : 160;
  return participants.map((p, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    return {
      id: p.agent_id,
      x: 220 + Math.cos(angle) * r,
      y: 220 + Math.sin(angle) * r,
      label: p.name,
      role: p.role,
      isHuman: p.is_human,
    };
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SessionRoomClient() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? "AL-UNKNOWN";

  // Canvas
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(0);
  const [canvasH, setCanvasH] = useState(0);

  // Graph
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>(MOCK_GRAPH_NODES);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>(MOCK_GRAPH_EDGES);

  // Chat
  const [messages, setMessages]           = useState<Message[]>([]);
  const [status, setStatus]               = useState<SessionStatus>("OPEN");
  const [participantCount, setParticipantCount] = useState(4);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Input
  const [inputText, setInputText] = useState("");
  const [inputType, setInputType] = useState<MessageType>("TASK");

  // Controls / modal
  const [hasDeliverable, setHasDeliverable] = useState(false);
  const [showModal, setShowModal]           = useState(false);
  const [outcome, setOutcome]               = useState<"SUCCESS" | "DISPUTED" | null>(null);

  // WS ref
  const [isMock, setIsMock] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Canvas resize ────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => {
      setCanvasW(e.contentRect.width);
      setCanvasH(e.contentRect.height);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Canvas draw (static, read-only) ──────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasW === 0 || canvasH === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width  = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasW, canvasH);

    if (graphNodes.length === 0) return;

    // Fit-to-canvas transform
    const xs  = graphNodes.map((n) => n.x);
    const ys  = graphNodes.map((n) => n.y);
    const pad = NR + 48;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const scale = Math.min(canvasW / (maxX - minX), canvasH / (maxY - minY), 1.15);
    const ox = (canvasW - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (canvasH - (maxY - minY) * scale) / 2 - minY * scale;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Dot grid
    const gxMin = Math.floor(minX / 40) * 40;
    const gxMax = Math.ceil(maxX  / 40) * 40;
    const gyMin = Math.floor(minY / 40) * 40;
    const gyMax = Math.ceil(maxY  / 40) * 40;
    ctx.fillStyle = "rgba(30,45,74,0.5)";
    for (let gx = gxMin; gx <= gxMax; gx += 40) {
      for (let gy = gyMin; gy <= gyMax; gy += 40) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1 / scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Edges
    for (const edge of graphEdges) {
      const from = graphNodes.find((n) => n.id === edge.fromId);
      const to   = graphNodes.find((n) => n.id === edge.toId);
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = "rgba(78,205,196,0.22)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Nodes
    for (const node of graphNodes) {
      const rc = node.isHuman ? HUMAN_COLOR : ROLE_COLOR[node.role];
      ctx.save();

      const g = ctx.createRadialGradient(node.x, node.y - 12, 4, node.x, node.y, NR);
      g.addColorStop(0, "#1B2845");
      g.addColorStop(1, "#0B1120");

      if (node.isHuman) {
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - NR);
        ctx.lineTo(node.x + NR, node.y);
        ctx.lineTo(node.x, node.y + NR);
        ctx.lineTo(node.x - NR, node.y);
        ctx.closePath();
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, NR, 0, Math.PI * 2);
      }
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = `${rc}88`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = `bold 14px ${FONT}`;
      ctx.fillStyle = rc;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.isHuman ? "YOU" : initials(node.label), node.x, node.y - 8);

      ctx.font = `10px ${FONT}`;
      ctx.fillStyle = "#CBD5E1";
      const maxW = NR * 1.7;
      let nameLabel = node.label;
      while (ctx.measureText(nameLabel).width > maxW && nameLabel.length > 2) {
        nameLabel = nameLabel.slice(0, -1);
      }
      if (nameLabel !== node.label) nameLabel += "…";
      ctx.fillText(nameLabel, node.x, node.y + 9);

      const badgeY = node.y + NR + 11;
      ctx.font = `bold 8px ${FONT}`;
      const bw = ctx.measureText(node.role.toUpperCase()).width + 12;
      const bh = 14;
      rrect(ctx, node.x - bw / 2, badgeY - bh / 2, bw, bh, 7);
      ctx.fillStyle = `${rc}1A`;
      ctx.fill();
      ctx.strokeStyle = `${rc}44`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = rc;
      ctx.textBaseline = "middle";
      ctx.fillText(node.role.toUpperCase(), node.x, badgeY);

      ctx.restore();
    }

    ctx.restore();
  }, [graphNodes, graphEdges, canvasW, canvasH]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Track deliverable ────────────────────────────────────────────────────

  useEffect(() => {
    if (messages.some((m) => m.type === "DELIVERABLE")) setHasDeliverable(true);
  }, [messages]);

  // ── WebSocket / mock fallback ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function startMock() {
      if (cancelled) return;
      setIsMock(true);
      const msgs = makeMockMessages(sessionId);
      msgs.forEach((msg, i) => {
        const t = setTimeout(() => {
          if (cancelled) return;
          setMessages((prev) => [...prev, msg]);
        }, i * 1500 + 400);
        timers.push(t);
      });
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://192.168.0.113:8000/ws/rooms/${sessionId}`);
      wsRef.current = ws;
    } catch {
      startMock();
      return () => { cancelled = true; timers.forEach(clearTimeout); };
    }

    const failTimer = setTimeout(() => {
      if (!cancelled) { ws.close(); startMock(); }
    }, 2500);
    timers.push(failTimer);

    ws.onopen = () => {
      clearTimeout(failTimer);
      if (!cancelled) setIsMock(false);
    };

    ws.onmessage = (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(e.data as string);
        if (data.type === "session_init") {
          const init = data.data;
          if (init?.participants?.length) {
            const nodes = buildGraphFromParticipants(init.participants);
            setGraphNodes(nodes);
            const edges: GraphEdge[] = [];
            for (let i = 0; i < nodes.length - 1; i++) {
              edges.push({ fromId: nodes[i].id, toId: nodes[i + 1].id });
            }
            if (nodes.length > 1) edges.push({ fromId: nodes[nodes.length - 1].id, toId: nodes[0].id });
            setGraphEdges(edges);
          }
          if (init?.participant_count) setParticipantCount(init.participant_count);
        } else if (data.type === "message") {
          setMessages((prev) => [...prev, data.data as Message]);
        } else if (data.type === "status_update") {
          const s = data.data.status as SessionStatus;
          setStatus(s);
          if (s === "CLOSED_SUCCESS" || s === "CLOSED_DISPUTED") {
            setOutcome(s === "CLOSED_SUCCESS" ? "SUCCESS" : "DISPUTED");
            setShowModal(true);
          }
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onerror = () => {
      clearTimeout(failTimer);
      if (!cancelled) startMock();
    };

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      ws.close();
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ─────────────────────────────────────────────────────────────

  function sendMessage() {
    const text = inputText.trim();
    if (!text) return;
    const msg: Message = {
      id: `local-${Date.now()}`,
      agentId: "human",
      agentName: "YOU",
      agentOrg: "Human",
      role: "Requester",
      type: inputType,
      content: text,
      sigValid: true,
      ts: new Date().toISOString(),
      isHuman: true,
    };
    setMessages((prev) => [...prev, msg]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", data: msg }));
    }
    setInputText("");
  }

  function handleConforme() {
    setStatus("CLOSED_SUCCESS");
    setOutcome("SUCCESS");
    setShowModal(true);
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: "verdict", data: { verdict: "CONFORME" } }));
  }

  function handleNoConforme() {
    setStatus("CLOSED_DISPUTED");
    setOutcome("DISPUTED");
    setShowModal(true);
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: "verdict", data: { verdict: "NO_CONFORME" } }));
  }

  function downloadLog() {
    const blob = new Blob(
      [JSON.stringify({ sessionId, status, messages }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isClosed = status === "CLOSED_SUCCESS" || status === "CLOSED_DISPUTED";
  const step     = STATUS_STEP[status];

  return (
    <div className="h-screen flex flex-col bg-al-bg text-al-text overflow-hidden">

      {/* Navbar */}
      <header className="shrink-0 z-30 bg-al-bg/90 backdrop-blur border-b border-al-border">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            href="/directory"
            className="flex items-center gap-1.5 text-sm text-al-muted-2 hover:text-al-text transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth={1.5} d="M10 3L4 8l6 5" />
            </svg>
            Directory
          </Link>
          <span className="font-mono text-xs text-al-muted">{sessionId}</span>
          <div className="flex items-center gap-2">
            {isMock && (
              <span className="text-[10px] text-al-muted border border-al-border rounded px-2 py-0.5 uppercase tracking-wide">
                Demo
              </span>
            )}
            <StatusBadge status={status} />
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: static graph (45%) ── */}
        <div
          ref={containerRef}
          className="shrink-0 relative border-r border-al-border bg-al-surface overflow-hidden"
          style={{ width: "45%" }}
        >
          <canvas ref={canvasRef} style={{ display: "block" }} />
          <div className="absolute top-3 left-3 text-[10px] text-al-muted uppercase tracking-widest select-none pointer-events-none">
            Team Graph · Read-only
          </div>
          {/* Legend */}
          <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 pointer-events-none select-none">
            {(Object.entries(ROLE_COLOR) as [SessionRole, string][]).map(([role, color]) => (
              <div key={role} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] text-al-muted">{role}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 shrink-0 rotate-45 inline-block"
                style={{ background: HUMAN_COLOR }}
              />
              <span className="text-[10px] text-al-muted">Human</span>
            </div>
          </div>
        </div>

        {/* ── Right: chat (55%) ── */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Chat header */}
          <div className="shrink-0 border-b border-al-border bg-al-surface px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-al-text">{sessionId}</span>
              <StatusBadge status={status} />
            </div>
            <span className="text-xs text-al-muted">{participantCount} participants</span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-al-muted select-none">
                <div className="w-10 h-10 rounded-full border border-dashed border-al-border flex items-center justify-center mb-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                    <circle cx="8" cy="8" r="6" strokeWidth={1} />
                    <path strokeLinecap="round" strokeWidth={1.5} d="M8 5v3l2 2" />
                  </svg>
                </div>
                <p className="text-sm">Connecting to session…</p>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {!isClosed && (
            <div className="shrink-0 border-t border-al-border bg-al-surface px-4 py-3">
              <div className="flex gap-2">
                <select
                  value={inputType}
                  onChange={(e) => setInputType(e.target.value as MessageType)}
                  className="bg-al-bg border border-al-border rounded-lg px-2 py-1.5 text-xs text-al-text focus:outline-none focus:border-al-accent transition-colors"
                >
                  {(["TASK", "DELIVERABLE", "VERIFYING", "EXIT KEY"] as MessageType[]).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Send a message…"
                  className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                />
                <button
                  onClick={sendMessage}
                  className="px-4 py-1.5 bg-al-accent text-al-bg rounded-lg text-sm font-semibold hover:bg-al-accent-dim active:scale-[0.98] transition-all"
                >
                  Send
                </button>
              </div>
            </div>
          )}

          {/* Progress + verdict controls */}
          <div className="shrink-0 border-t border-al-border bg-al-surface px-4 py-3 space-y-3">
            <ProgressBar step={step} status={status} />
            {hasDeliverable && !isClosed && (
              <div className="flex gap-2.5">
                <button
                  onClick={handleConforme}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: "rgba(34,197,94,0.12)",
                    border: "1px solid rgba(34,197,94,0.4)",
                    color: "#22C55E",
                  }}
                >
                  CONFORME
                </button>
                <button
                  onClick={handleNoConforme}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
                  style={{
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    color: "#EF4444",
                  }}
                >
                  NO CONFORME
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Close modal */}
      {showModal && outcome && (
        <CloseModal
          outcome={outcome}
          sessionId={sessionId}
          onDownload={downloadLog}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SessionStatus }) {
  const cfg = {
    OPEN:            { label: "OPEN",             color: "#4ECDC4" },
    VERIFYING:       { label: "VERIFYING",         color: "#F59E0B" },
    CLOSED_SUCCESS:  { label: "CLOSED · SUCCESS",  color: "#22C55E" },
    CLOSED_DISPUTED: { label: "CLOSED · DISPUTED", color: "#EF4444" },
  }[status];
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wide"
      style={{
        background: `${cfg.color}1A`,
        color: cfg.color,
        border: `1px solid ${cfg.color}44`,
      }}
    >
      {cfg.label}
    </span>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const rc  = msg.isHuman ? HUMAN_COLOR : (ROLE_COLOR[msg.role] ?? "#64748B");
  const mtc = MSG_COLOR[msg.type];
  const ini = msg.isHuman ? "YOU" : initials(msg.agentName);

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: `${rc}1A`, border: `1.5px solid ${rc}55`, color: rc }}
      >
        {ini}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <span className="text-sm font-semibold text-al-text">{msg.agentName}</span>
          {msg.agentOrg && (
            <span className="text-[10px] text-al-muted bg-al-surface border border-al-border rounded px-1.5 py-0.5 leading-none">
              {msg.agentOrg}
            </span>
          )}
          <span
            className="text-[10px] font-semibold rounded px-1.5 py-0.5 leading-none"
            style={{ background: mtc.bg, color: mtc.text, border: `1px solid ${mtc.border}` }}
          >
            {msg.type}
          </span>
          {/* Signature */}
          <span
            className="text-[10px] flex items-center gap-0.5 leading-none"
            style={{ color: msg.sigValid ? "#22C55E" : "#EF4444" }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
              {msg.sigValid
                ? <path strokeLinecap="round" strokeWidth={1.5} d="M1.5 6l3 3 5.5-5.5" />
                : <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l8 8M10 2l-8 8" />
              }
            </svg>
            {msg.sigValid ? "sig valid" : "sig invalid"}
          </span>
        </div>

        {/* Message bubble */}
        <div
          className="rounded-xl px-3.5 py-2.5 text-sm text-al-text leading-relaxed whitespace-pre-line break-words"
          style={{ background: "rgba(13,20,33,0.7)", border: "1px solid #1E2D4A" }}
        >
          {msg.content}
        </div>

        <div className="text-[10px] text-al-muted mt-1">
          {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ step, status }: { step: number; status: SessionStatus }) {
  const color =
    status === "CLOSED_SUCCESS"  ? "#22C55E" :
    status === "CLOSED_DISPUTED" ? "#EF4444" :
    status === "VERIFYING"       ? "#F59E0B" : "#4ECDC4";

  const steps = ["OPEN", "VERIFYING", "CLOSED"];

  return (
    <div>
      <div className="flex justify-between mb-1.5">
        {steps.map((s, i) => (
          <span
            key={s}
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: i + 1 <= step ? color : "#475569" }}
          >
            {i + 1 === 3 && status === "CLOSED_DISPUTED" ? "DISPUTED" : s}
          </span>
        ))}
      </div>
      <div className="h-1.5 bg-al-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${(step / 3) * 100}%`, background: color }}
        />
      </div>
    </div>
  );
}

function CloseModal({
  outcome,
  sessionId,
  onDownload,
  onClose,
}: {
  outcome: "SUCCESS" | "DISPUTED";
  sessionId: string;
  onDownload: () => void;
  onClose: () => void;
}) {
  const isSuccess = outcome === "SUCCESS";
  const color = isSuccess ? "#22C55E" : "#F59E0B";

  const repUpdates = [
    { name: "Nexus-7",  delta: isSuccess ? "+0.12" : "-0.08" },
    { name: "Aria-ML",  delta: isSuccess ? "+0.15" : "-0.20" },
    { name: "Sigma-QA", delta: isSuccess ? "+0.10" : "-0.05" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6"
        style={{ boxShadow: `0 0 60px ${color}15` }}
      >
        {/* Icon + title */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ background: `${color}15`, border: `2px solid ${color}40` }}
          >
            {isSuccess ? (
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={color}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={color}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            )}
          </div>
          <h2 className="text-xl font-bold text-al-text">
            Session {isSuccess ? "Completed" : "Disputed"}
          </h2>
          <p className="text-sm text-al-muted mt-1 text-center">
            {isSuccess
              ? "All parties satisfied. Escrow released to contributors."
              : "Dispute logged on-chain. Escalated to AgentLink arbitration."}
          </p>
        </div>

        {/* Reputation updates */}
        <div className="bg-al-bg rounded-xl border border-al-border p-4 mb-4">
          <p className="text-[10px] text-al-muted uppercase tracking-wider mb-3">Reputation Updates</p>
          <div className="space-y-2">
            {repUpdates.map((r) => (
              <div key={r.name} className="flex items-center justify-between">
                <span className="text-sm text-al-text">{r.name}</span>
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: r.delta.startsWith("+") ? "#22C55E" : "#EF4444" }}
                >
                  {r.delta}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* GitHub link */}
        <div className="mb-5">
          <a
            href={`https://github.com/agentlink/session-${sessionId.toLowerCase()}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-al-accent hover:text-al-text transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.04c-3.34.72-4.04-1.6-4.04-1.6-.54-1.38-1.32-1.74-1.32-1.74-1.08-.74.08-.72.08-.72 1.2.08 1.83 1.22 1.83 1.22 1.06 1.82 2.78 1.3 3.46.98.1-.76.42-1.28.76-1.58-2.66-.3-5.46-1.33-5.46-5.9 0-1.3.46-2.36 1.22-3.2-.12-.3-.52-1.52.12-3.16 0 0 1-.32 3.28 1.22a11.4 11.4 0 013-.4c1.02 0 2.04.14 3 .4 2.28-1.54 3.28-1.22 3.28-1.22.64 1.64.24 2.86.12 3.16.76.84 1.22 1.9 1.22 3.2 0 4.58-2.8 5.6-5.48 5.9.44.38.82 1.12.82 2.26v3.36c0 .32.22.7.82.58C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            View session on GitHub
          </a>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onDownload}
            className="flex-1 py-2 bg-al-bg border border-al-border rounded-lg text-sm text-al-text hover:border-al-accent/50 transition-colors"
          >
            Download Log
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: `${color}15`,
              border: `1px solid ${color}40`,
              color,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
