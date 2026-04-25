"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { SessionRole } from "../../lib/types";
import { useCredits } from "../../lib/credits";

// ── Constants ──────────────────────────────────────────────────────────────

const API = "http://192.168.0.104:8000/api/v1";
const NR  = 40;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const ROLE_COLOR: Record<SessionRole, string> = {
  Requester:   "#4ECDC4",
  Contributor: "#818CF8",
  Reviewer:    "#F59E0B",
  Observer:    "#64748B",
};
const HUMAN_COLOR = "#F0A500";

// UI message type labels (superset of backend enum)
type MessageType   = "TASK" | "DELIVERABLE" | "VERIFYING" | "EXIT KEY" | "SYSTEM" | "R1" | "R2" | "R3";
type SessionStatus = "OPEN" | "VERIFYING" | "CLOSED_SUCCESS" | "CLOSED_DISPUTED";

// Map UI type → backend MessageType enum value
const BACKEND_TYPE: Record<MessageType, string> = {
  TASK:        "TASK",
  DELIVERABLE: "DELIVERABLE",
  VERIFYING:   "VERIFICATION",
  "EXIT KEY":  "TASK",
  SYSTEM:      "SYSTEM",
  R1:          "TASK",
  R2:          "TASK",
  R3:          "TASK",
};

// Map backend RoomStatus → UI SessionStatus
const UI_STATUS: Record<string, SessionStatus> = {
  OPEN:     "OPEN",
  REVISION: "OPEN",        // still active — another revision round
  DISPUTED: "CLOSED_DISPUTED",
  CLOSED:   "CLOSED_SUCCESS",
  ARCHIVED: "CLOSED_SUCCESS",
};

const MSG_COLOR: Record<MessageType, { bg: string; text: string; border: string }> = {
  TASK:        { bg: "rgba(129,140,248,0.12)", text: "#818CF8", border: "rgba(129,140,248,0.35)" },
  DELIVERABLE: { bg: "rgba(78,205,196,0.12)",  text: "#4ECDC4", border: "rgba(78,205,196,0.35)"  },
  VERIFYING:   { bg: "rgba(245,158,11,0.12)",  text: "#F59E0B", border: "rgba(245,158,11,0.35)"  },
  "EXIT KEY":  { bg: "rgba(168,85,247,0.12)",  text: "#A855F7", border: "rgba(168,85,247,0.35)"  },
  SYSTEM:      { bg: "rgba(100,116,139,0.12)", text: "#94A3B8", border: "rgba(100,116,139,0.35)" },
  R1:          { bg: "rgba(59,130,246,0.12)",  text: "#60A5FA", border: "rgba(59,130,246,0.35)"  },
  R2:          { bg: "rgba(234,179,8,0.12)",   text: "#EAB308", border: "rgba(234,179,8,0.35)"   },
  R3:          { bg: "rgba(249,115,22,0.12)",  text: "#FB923C", border: "rgba(249,115,22,0.35)"  },
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
  isBuilder?: boolean;
  clusterId?: string;
}

interface GraphEdge {
  fromId: string;
  toId: string;
}

interface GraphCluster {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
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

function buildGraph(
  participants: Array<{ id: string; name: string; role: SessionRole; isHuman?: boolean }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const count = participants.length;
  const r = count <= 1 ? 0 : 160;
  const nodes = participants.map((p, i) => {
    const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
    return {
      id: p.id,
      x: 220 + Math.cos(angle) * r,
      y: 220 + Math.sin(angle) * r,
      label: p.name,
      role: p.role,
      isHuman: p.isHuman,
    };
  });
  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ fromId: nodes[i].id, toId: nodes[i + 1].id });
  }
  if (nodes.length > 1) {
    edges.push({ fromId: nodes[nodes.length - 1].id, toId: nodes[0].id });
  }
  return { nodes, edges };
}

function systemMsg(content: string): Message {
  return {
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentId: "system",
    agentName: "AgentLink",
    agentOrg: "Protocol",
    role: "Observer",
    type: "SYSTEM",
    content,
    sigValid: true,
    ts: new Date().toISOString(),
  };
}

// ── Format detection & HTML rendering ─────────────────────────────────────

function detectFormat(task: string): "html" | "csv" | "md" {
  const t = task.toLowerCase();
  if (/\b(html|web|webpage|landing)\b/.test(t)) return "html";
  if (/\b(excel|spreadsheet|csv)\b/.test(t)) return "csv";
  return "md";
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (/^\|[-| :]+\|$/.test(line)) continue; // table separator
    if (/^\|.+\|$/.test(line)) {
      if (!inTable) { out.push("<table>"); inTable = true; }
      const cells = line.slice(1, -1).split("|").map((c) => `<td>${applyInline(c.trim())}</td>`).join("");
      out.push(`<tr>${cells}</tr>`);
      continue;
    }
    if (inTable) { out.push("</table>"); inTable = false; }
    if (/^### /.test(line)) { out.push(`<h3>${applyInline(line.slice(4))}</h3>`); continue; }
    if (/^## /.test(line))  { out.push(`<h2>${applyInline(line.slice(3))}</h2>`); continue; }
    if (/^# /.test(line))   { out.push(`<h1>${applyInline(line.slice(2))}</h1>`); continue; }
    if (/^- /.test(line))   { out.push(`<li>${applyInline(line.slice(2))}</li>`); continue; }
    if (/^---+$/.test(line)) { out.push("<hr>"); continue; }
    if (line.trim() === "")  { out.push(""); continue; }
    out.push(`<p>${applyInline(line)}</p>`);
  }
  if (inTable) out.push("</table>");
  return out.join("\n");
}

function buildHtmlDeliverable(content: string, sessionId: string, teamItems: string, date: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AgentLink Deliverable — ${sessionId}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#070B14;color:#E8EAF0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;padding:48px 24px}
  .container{max-width:800px;margin:0 auto}
  header{border-bottom:1px solid #1E2D4A;padding-bottom:24px;margin-bottom:32px}
  .logo{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#4ECDC4;font-weight:700;margin-bottom:8px}
  header h1{font-size:24px;font-weight:700}
  .meta{margin-top:12px;display:flex;gap:24px;flex-wrap:wrap}
  .meta span{font-size:12px;color:#64748B}
  .meta strong{color:#94A3B8}
  .team{background:rgba(78,205,196,.06);border:1px solid rgba(78,205,196,.2);border-radius:12px;padding:20px 24px;margin-bottom:32px}
  .team-label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#4ECDC4;margin-bottom:12px;font-weight:700}
  .team ul{list-style:none;display:flex;flex-wrap:wrap;gap:8px}
  .team li{font-size:13px;background:rgba(255,255,255,.05);border:1px solid #1E2D4A;border-radius:8px;padding:6px 12px;color:#CBD5E1}
  .body{background:rgba(13,20,33,.7);border:1px solid #1E2D4A;border-radius:12px;padding:32px}
  h1,h2,h3{color:#E8EAF0;margin:24px 0 12px}
  h1{font-size:22px}h2{font-size:18px}h3{font-size:15px}
  p{color:#CBD5E1;margin:10px 0}
  li{color:#CBD5E1;margin:4px 0 4px 20px;list-style:disc}
  table{border-collapse:collapse;width:100%;margin:16px 0}
  td{border:1px solid #1E2D4A;padding:10px 14px;color:#CBD5E1;font-size:13px}
  tr:first-child td{background:rgba(78,205,196,.08);color:#4ECDC4;font-weight:600}
  hr{border:none;border-top:1px solid #1E2D4A;margin:24px 0}
  strong{color:#E8EAF0}
  code{background:rgba(78,205,196,.1);border:1px solid rgba(78,205,196,.2);border-radius:4px;padding:2px 6px;font-family:'SF Mono',monospace;font-size:12px;color:#4ECDC4}
  footer{margin-top:48px;padding-top:24px;border-top:1px solid #1E2D4A;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
  footer span{font-size:11px;color:#475569}
  .badge{background:rgba(78,205,196,.1);border:1px solid rgba(78,205,196,.25);border-radius:6px;padding:4px 10px;font-size:11px;color:#4ECDC4;font-weight:600}
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">AgentLink</div>
    <h1>Session Deliverable</h1>
    <div class="meta">
      <span><strong>Session ID:</strong> ${sessionId}</span>
      <span><strong>Date:</strong> ${date}</span>
    </div>
  </header>
  <div class="team">
    <div class="team-label">Team Composition</div>
    <ul>${teamItems}</ul>
  </div>
  <div class="body">
    ${markdownToHtml(content)}
  </div>
  <footer>
    <span>Generated by AgentLink — Verified session log</span>
    <span class="badge">Session ${sessionId}</span>
  </footer>
</div>
</body>
</html>`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SessionRoomClient() {
  const { id } = useParams<{ id: string }>();
  const roomId = id ?? "";

  // Canvas
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasW, setCanvasW] = useState(0);
  const [canvasH, setCanvasH] = useState(0);

  // Graph
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphClusters, setGraphClusters] = useState<GraphCluster[]>([]);
  const graphNodesRef = useRef<GraphNode[]>([]);

  // Chat
  const [messages, setMessages]               = useState<Message[]>([]);
  const [status, setStatus]                   = useState<SessionStatus>("OPEN");
  const [participantCount, setParticipantCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Input
  const [inputText, setInputText] = useState("");
  const [inputType, setInputType] = useState<MessageType>("TASK");
  const [sending, setSending]     = useState(false);

  // Controls / modal
  const [hasDeliverable, setHasDeliverable]   = useState(false);
  const [deliverableMsg, setDeliverableMsg]   = useState<Message | null>(null);
  const [showModal, setShowModal]             = useState(false);
  const [outcome, setOutcome]               = useState<"SUCCESS" | "DISPUTED" | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);

  // WS
  const wsRef   = useRef<WebSocket | null>(null);
  const [wsOpen, setWsOpen] = useState(false);

  // Auto-task
  const [taskDescription, setTaskDescription] = useState<string>("");
  const autoTaskSentRef = useRef(false);

  // Demo quota
  const [demoLimitReached, setDemoLimitReached]   = useState(false);
  const [messagesRemaining, setMessagesRemaining] = useState<number | null>(null);

  // Chat tabs
  const [activeTab, setActiveTab]           = useState<string>("all");
  const [unreadClusters, setUnreadClusters] = useState<Set<string>>(new Set());
  const activeTabRef = useRef("all");
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Stable refs so async callbacks always see latest graph state
  const graphEdgesRef = useRef<GraphEdge[]>([]);
  useEffect(() => { graphNodesRef.current = graphNodes; }, [graphNodes]);
  useEffect(() => { graphEdgesRef.current = graphEdges; }, [graphEdges]);

  // Flag set when we restore from sessionStorage — prevents API from overwriting
  const savedGraphLoadedRef = useRef(false);

  // Agent rates from build page (nodeId → ALC/session)
  const [agentRates, setAgentRates] = useState<Record<string, number>>({});
  const [sessionCost, setSessionCost] = useState<number | null>(null);

  const { balance } = useCredits();

  // ── Restore canvas layout from build page ───────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem("agentlink_session_graph");
    if (!raw) return;
    sessionStorage.removeItem("agentlink_session_graph");
    try {
      const saved = JSON.parse(raw) as {
        sessionCost?: number;
        agentRates?: Record<string, number>;
        nodes: Array<{ id: string; agentId: string; agentName: string; role: SessionRole; label: string; x: number; y: number; isHuman: boolean; clusterId?: string | null; isBuilder?: boolean }>;
        edges: Array<{ a: string; b: string }>;
        clusters?: Array<{ id: string; name: string; color: string; x: number; y: number; rx: number; ry: number }>;
      };
      if (saved.sessionCost != null) setSessionCost(saved.sessionCost);
      if (saved.agentRates) setAgentRates(saved.agentRates);
      const restoredNodes: GraphNode[] = saved.nodes.map((n) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        label: n.agentName,
        role: n.role,
        isHuman: n.isHuman,
        isBuilder: n.isBuilder ?? false,
        clusterId: n.clusterId ?? undefined,
      }));
      const restoredEdges: GraphEdge[] = saved.edges.map((e) => ({
        fromId: e.a,
        toId: e.b,
      }));
      const restoredClusters: GraphCluster[] = (saved.clusters ?? [])
        .filter((c) => c.x !== undefined && c.rx !== undefined)
        .map((c) => ({ id: c.id, name: c.name, color: c.color, x: c.x, y: c.y, rx: c.rx, ry: c.ry }));
      setGraphNodes(restoredNodes);
      setGraphEdges(restoredEdges);
      setGraphClusters(restoredClusters);
      setParticipantCount(restoredNodes.length);
      savedGraphLoadedRef.current = true;
    } catch { /* malformed — fall back to API */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Canvas draw ──────────────────────────────────────────────────────────

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

    // Clusters (behind nodes)
    for (const c of graphClusters) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = `${c.color}1a`;
      ctx.fill();
      ctx.strokeStyle = `${c.color}55`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `bold 13px ${FONT}`;
      ctx.fillStyle = `${c.color}bb`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.name, c.x, c.y - c.ry + 22);
      ctx.restore();
    }

    // Intra-cluster edges — full mesh within each cluster
    for (const c of graphClusters) {
      const cn = graphNodes.filter((n) => n.clusterId === c.id);
      for (let i = 0; i < cn.length; i++) {
        for (let j = i + 1; j < cn.length; j++) {
          ctx.beginPath();
          ctx.moveTo(cn[i].x, cn[i].y);
          ctx.lineTo(cn[j].x, cn[j].y);
          ctx.strokeStyle = `${c.color}44`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // Inter-agent edges (user-defined)
    for (const edge of graphEdges) {
      const from = graphNodes.find((n) => n.id === edge.fromId);
      const to   = graphNodes.find((n) => n.id === edge.toId);
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x,   to.y);
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

      // Builder badge (top-right of node)
      if (node.isBuilder) {
        const bx = node.x + NR * 0.68;
        const by = node.y - NR * 0.68;
        ctx.beginPath();
        ctx.arc(bx, by, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#F59E0B";
        ctx.fill();
        ctx.strokeStyle = "#0B1120";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = `bold 8px ${FONT}`;
        ctx.fillStyle = "#0B1120";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("B", bx, by + 0.5);
      }

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
  }, [graphNodes, graphEdges, graphClusters, canvasW, canvasH]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Track deliverable ────────────────────────────────────────────────────

  useEffect(() => {
    const dm = messages.find((m) => m.type === "DELIVERABLE");
    if (dm) {
      setHasDeliverable(true);
      setDeliverableMsg(dm);
    }
  }, [messages]);

  // ── Track unread messages per cluster ────────────────────────────────────

  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.isHuman || lastMsg.agentId === "system") return;
    const node = graphNodesRef.current.find((n) => n.id === lastMsg.agentId);
    if (!node?.clusterId) return;
    const tab = activeTabRef.current;
    if (tab === "all" || tab === node.clusterId) return;
    setUnreadClusters((prev) => new Set([...prev, node.clusterId!]));
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-send task_description on WS connect ─────────────────────────────

  useEffect(() => {
    if (!wsOpen || !taskDescription || autoTaskSentRef.current) return;
    autoTaskSentRef.current = true;
    const taskMsg: Message = {
      id: `auto-task-${Date.now()}`,
      agentId: "human",
      agentName: "YOU",
      agentOrg: "Human",
      role: "Requester",
      type: "TASK",
      content: taskDescription,
      sigValid: true,
      ts: new Date().toISOString(),
      isHuman: true,
    };
    setMessages([taskMsg]);
    callDemoAgents(taskDescription, [taskMsg]);
  }, [wsOpen, taskDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch room data → build agent graph ──────────────────────────────────

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    async function loadRoom() {
      try {
        const [roomRes, agentsRes] = await Promise.all([
          fetch(`${API}/rooms/${roomId}`),
          fetch(`${API}/agents`),
        ]);

        if (!roomRes.ok || !agentsRes.ok || cancelled) return;

        const room = await roomRes.json();
        const allAgents: Array<{ agent_id: string; name: string; framework: string }> =
          await agentsRes.json();

        const agentA = allAgents.find((a) => a.agent_id === room.agent_a_id);
        const agentB = allAgents.find((a) => a.agent_id === room.agent_b_id);

        const participants: Array<{
          id: string; name: string; role: SessionRole; isHuman?: boolean;
        }> = [
          { id: "human", name: "YOU", role: "Requester", isHuman: true },
        ];
        if (agentA) {
          participants.push({ id: agentA.agent_id, name: agentA.name, role: "Contributor" });
        } else if (room.agent_a_id) {
          participants.push({ id: room.agent_a_id, name: room.agent_a_id.slice(0, 8), role: "Contributor" });
        }
        if (agentB) {
          participants.push({ id: agentB.agent_id, name: agentB.name, role: "Contributor" });
        } else if (room.agent_b_id) {
          participants.push({ id: room.agent_b_id, name: room.agent_b_id.slice(0, 8), role: "Contributor" });
        }

        if (cancelled) return;

        if (participants.length > 1 && !savedGraphLoadedRef.current) {
          const { nodes, edges } = buildGraph(participants);
          setGraphNodes(nodes);
          setGraphEdges(edges);
          setParticipantCount(participants.length);
        }

        const contract = room.contract ?? room.room_contract ?? {};
        const deliverableSpec: string = contract.deliverable_spec ?? room.deliverable_spec ?? "";
        let fullTask: string = room.task_description ?? "";
        if (fullTask && deliverableSpec) fullTask += `\n\nAcceptance criteria: ${deliverableSpec}`;
        if (fullTask) setTaskDescription(fullTask);

        if (room.status && UI_STATUS[room.status]) {
          setStatus(UI_STATUS[room.status]);
        }
      } catch {
        // Room endpoint unavailable — graph stays empty, WS may populate it
      }
    }

    loadRoom();
    return () => { cancelled = true; };
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let ws: WebSocket;

    try {
      ws = new WebSocket(`ws://192.168.0.104:8000/ws/rooms/${roomId}`);
      wsRef.current = ws;
    } catch {
      return;
    }

    ws.onopen = () => {
      if (!cancelled) setWsOpen(true);
    };

    ws.onmessage = (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(e.data as string);

        if (data.type === "session_init") {
          const init = data.data;
          // Populate graph from WS init if room fetch hasn't done it yet
          if (init?.participants?.length && graphNodesRef.current.length === 0) {
            const participants = init.participants as Array<{
              agent_id: string; name: string; role: SessionRole; is_human?: boolean;
            }>;
            const { nodes, edges } = buildGraph(
              participants.map((p) => ({
                id: p.agent_id,
                name: p.name,
                role: p.role,
                isHuman: p.is_human,
              })),
            );
            setGraphNodes(nodes);
            setGraphEdges(edges);
          }
          if (init?.participant_count) setParticipantCount(init.participant_count);
          if (init?.status && UI_STATUS[init.status]) setStatus(UI_STATUS[init.status]);
        } else if (data.type === "message") {
          const incoming = data.data as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        } else if (data.type === "status_update") {
          const s: string = data.data?.status ?? "";
          if (UI_STATUS[s]) setStatus(UI_STATUS[s]);
        }
      } catch { /* ignore malformed frames */ }
    };

    return () => {
      cancelled = true;
      ws.close();
    };
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Demo agent responses ──────────────────────────────────────────────────

  function toDemoSlug(name: string): string {
    return name.toLowerCase();
  }

  async function callDemoAgents(humanText: string, sessionMessages: Message[]) {
    const agents = graphNodesRef.current.filter((n) => !n.isHuman && n.role !== "Observer");
    if (agents.length === 0) return;

    function addSystemMsg(content: string) {
      const msg = systemMsg(content);
      setMessages((prev) => [...prev, msg]);
    }

    function getVisibleContext(agent: GraphNode, context: Message[], round?: string): Message[] {
      const edges = graphEdgesRef.current;
      // No edges defined → every agent sees all messages (full mesh)
      if (edges.length === 0) {
        if (round) console.log(`[${round}] ${agent.label}: no edges → full context (${context.length} msgs)`);
        return context;
      }
      const neighborIds = new Set(
        edges
          .filter((e) => e.fromId === agent.id || e.toId === agent.id)
          .map((e) => (e.fromId === agent.id ? e.toId : e.fromId)),
      );
      // Agent has no edges → fall back to full visibility so R2 context is never empty
      if (neighborIds.size === 0) {
        if (round) console.log(`[${round}] ${agent.label}: isolated node → full context (${context.length} msgs)`);
        return context;
      }
      const visible = context.filter(
        (m) =>
          m.isHuman ||
          m.agentId === "system" ||
          m.agentId === agent.id ||
          neighborIds.has(m.agentId),
      );
      if (round) {
        const peerMsgs = visible.filter((m) => !m.isHuman && m.agentId !== "system" && m.agentId !== agent.id);
        console.log(`[${round}] ${agent.label}: neighbors=[${[...neighborIds].join(",")}] peer_msgs=${peerMsgs.length} total=${visible.length}`);
      }
      return visible;
    }

    async function callAgent(
      agent: GraphNode,
      prompt: string,
      context: Message[],
      type: MessageType,
    ): Promise<Message | null> {
      try {
        const res = await fetch(`${API}/demo/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            message: prompt,
            agent_id: toDemoSlug(agent.label),
            session_messages: context,
          }),
        });

        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          if (body.error === "demo_limit_reached") setDemoLimitReached(true);
          return null;
        }
        if (!res.ok) return null;

        const data = await res.json();
        if (data.messages_remaining != null) setMessagesRemaining(data.messages_remaining);

        const content: string = data.response ?? data.message ?? data.content ?? "";
        if (!content) return null;

        const agentMsg: Message = {
          id: `demo-${type}-${agent.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          agentId: agent.id,
          agentName: data.agent_name ?? agent.label,
          agentOrg: "",
          role: agent.role,
          type,
          content,
          sigValid: true,
          ts: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, agentMsg]);
        return agentMsg;
      } catch {
        return null;
      }
    }

    // ── ROUND 1: Independent analysis (parallel) ──────────────────────────────
    addSystemMsg("Round 1 — Independent analysis");
    const r1Prompt =
      `${humanText}\n\nRound 1: Provide your independent expert analysis. Do not hold back your perspective.`;
    const r1Results = await Promise.all(
      agents.map((agent) => callAgent(agent, r1Prompt, getVisibleContext(agent, sessionMessages, "R1"), "R1")),
    );
    const r1Messages = r1Results.filter((m): m is Message => m !== null);
    if (r1Messages.length === 0) return;

    // ── ROUND 2: Cross-review (sequential) ───────────────────────────────────
    addSystemMsg("Round 2 — Cross-review");
    const r2Prompt =
      "Round 2: You have read your colleagues' initial analyses. Identify where you agree, where you disagree, and refine your position. Be specific about what you accept or challenge from others.";
    const r2Base = [...sessionMessages, ...r1Messages];
    const r2Messages: Message[] = [];
    for (const agent of agents) {
      const msg = await callAgent(agent, r2Prompt, getVisibleContext(agent, [...r2Base, ...r2Messages], "R2"), "R2");
      if (!msg) continue;
      r2Messages.push(msg);
    }
    if (r2Messages.length === 0) return;

    // ── ROUND 3: Consensus and deliverable (sequential) ──────────────────────
    addSystemMsg("Round 3 — Consensus and deliverable");
    const r3Prompt =
      "Round 3 (final): Based on all previous discussion, contribute your section to the unified team deliverable. The last agent should synthesize everything into one cohesive document.";
    const r3Base = [...r2Base, ...r2Messages];
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const isLast = i === agents.length - 1;
      const prompt = isLast
        ? `${r3Prompt} You are the last agent — synthesize all contributions into one cohesive final document.`
        : r3Prompt;
      const msg = await callAgent(agent, prompt, getVisibleContext(agent, r3Base, "R3"), isLast ? "DELIVERABLE" : "R3");
      if (msg) r3Base.push(msg);
    }
  }

  // ── Send human message ────────────────────────────────────────────────────

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);

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

    const updatedMessages = [...messages, msg];
    setMessages(updatedMessages);
    setInputText("");

    // Best-effort backend POST — will fail without real agent credentials in demo mode
    fetch(`${API}/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender_agent_id: "00000000-0000-0000-0000-000000000000",
        private_key_b64: "",
        content_natural: text,
        message_type: BACKEND_TYPE[inputType],
      }),
    }).catch(() => {/* expected without real credentials */});

    // Forward over WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", data: msg }));
    }

    // Trigger demo agent responses for each non-human Contributor
    await callDemoAgents(text, updatedMessages);
    setSending(false);
  }

  // ── Verdict handlers ──────────────────────────────────────────────────────

  async function postVerdict(verdict: "CONFORME" | "NO_CONFORME", reason = "") {
    if (verdictLoading) return;
    setVerdictLoading(true);
    try {
      const res = await fetch(`${API}/rooms/${roomId}/verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, reason }),
      });

      if (res.ok) {
        const data = await res.json();
        const backendStatus: string = data.status ?? "";
        const backendOutcome: string = data.outcome ?? "";

        if (backendStatus === "CLOSED" || backendOutcome === "SUCCESS") {
          setStatus("CLOSED_SUCCESS");
          setOutcome("SUCCESS");
          setShowModal(true);
          return;
        }
        if (backendStatus === "DISPUTED" || backendOutcome === "DISPUTE") {
          setStatus("CLOSED_DISPUTED");
          setOutcome("DISPUTED");
          setShowModal(true);
          return;
        }
        if (backendStatus === "REVISION") {
          // Revision round — stay open, let agents respond
          setMessages((prev) => [
            ...prev,
            systemMsg("Revision requested. Agents will address the feedback."),
          ]);
          await callDemoAgents(
            reason || "Please revise the deliverable.",
            [...messages, systemMsg("Revision requested.")],
          );
          return;
        }
      }

      // Fallback: if backend call fails, apply verdict locally
      if (verdict === "CONFORME") {
        setStatus("CLOSED_SUCCESS");
        setOutcome("SUCCESS");
        setShowModal(true);
      } else {
        setStatus("CLOSED_DISPUTED");
        setOutcome("DISPUTED");
        setShowModal(true);
      }
    } catch {
      // Network error — apply locally
      if (verdict === "CONFORME") {
        setStatus("CLOSED_SUCCESS");
        setOutcome("SUCCESS");
        setShowModal(true);
      } else {
        setStatus("CLOSED_DISPUTED");
        setOutcome("DISPUTED");
        setShowModal(true);
      }
    } finally {
      setVerdictLoading(false);
    }
  }

  function downloadLog() {
    const log = {
      sessionId: roomId,
      status,
      exportedAt: new Date().toISOString(),
      team: graphNodes.map((n) => ({ id: n.id, name: n.label, role: n.role, isHuman: !!n.isHuman })),
      messages: messages.map((m) => ({
        id: m.id,
        agentId: m.agentId,
        agentName: m.agentName,
        role: m.role,
        type: m.type,
        content: m.content,
        sigValid: m.sigValid,
        timestamp: m.ts,
      })),
    };
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `AgentLink_SessionLog_${roomId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadDeliverable(msg: Message) {
    const date = new Date().toISOString().split("T")[0];
    const fmt  = detectFormat(taskDescription);

    if (fmt === "html") {
      const teamItems = graphNodes
        .map((n) => `<li>${n.label} · ${n.role}${n.isHuman ? " · Human" : ""}</li>`)
        .join("");
      const html = buildHtmlDeliverable(msg.content, roomId, teamItems, date);
      const blob = new Blob([html], { type: "text/html" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `AgentLink_Deliverable_${roomId}.html`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const teamLines = graphNodes
      .map((n) => `- ${n.label} (${n.role}${n.isHuman ? " · Human" : ""})`)
      .join("\n");
    const md = [
      `# AgentLink Deliverable`,
      ``,
      `**Session ID:** ${roomId}`,
      `**Date:** ${date}`,
      ``,
      `## Team Composition`,
      teamLines,
      ``,
      `## Deliverable`,
      ``,
      msg.content,
      ``,
      `---`,
      `*Generated by AgentLink — Verified session log*`,
    ].join("\n");

    const ext  = fmt === "csv" ? "csv" : "md";
    const mime = fmt === "csv" ? "text/csv" : "text/markdown";
    const blob = new Blob([md], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `AgentLink_Deliverable_${roomId}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isClosed      = status === "CLOSED_SUCCESS" || status === "CLOSED_DISPUTED";
  const step          = STATUS_STEP[status];
  const agentNodes    = graphNodes.filter((n) => !n.isHuman);
  const deliverableExt = detectFormat(taskDescription);

  // Build nodeId → cluster lookup for team badges and tab filtering
  const clusterByNodeId = new Map<string, GraphCluster>(
    graphNodes
      .filter((n) => n.clusterId)
      .flatMap((n) => {
        const c = graphClusters.find((c) => c.id === n.clusterId);
        return c ? [[n.id, c] as [string, GraphCluster]] : [];
      }),
  );

  const visibleMessages = activeTab === "all"
    ? messages
    : messages.filter(
        (m) => m.isHuman || m.agentId === "system" || clusterByNodeId.get(m.agentId)?.id === activeTab,
      );

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
          <span className="font-mono text-xs text-al-muted">{roomId}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30">
              <span className="text-base leading-none">💰</span>
              <span className="text-sm font-semibold text-amber-400 tabular-nums">{balance} ALC</span>
            </div>
            <StatusBadge status={status} />
          </div>
        </div>
      </header>

      {/* Demo limit banner */}
      {demoLimitReached && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/30">
          <span className="text-sm text-amber-400">
            You&apos;ve reached the demo limit. Register your own agent to continue using AgentLink.
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/directory"
              className="text-sm font-semibold text-amber-400 hover:text-amber-300 underline transition-colors whitespace-nowrap"
            >
              Register Agent
            </Link>
            <button
              onClick={() => setDemoLimitReached(false)}
              className="text-al-muted hover:text-al-text transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: team graph (45%) ── */}
        <div
          ref={containerRef}
          className="shrink-0 relative border-r border-al-border bg-al-surface overflow-hidden"
          style={{ width: "45%" }}
        >
          <canvas ref={canvasRef} style={{ display: "block" }} />

          {graphNodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
              <span className="text-xs text-al-muted">Connecting…</span>
            </div>
          )}

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
              <span className="w-2 h-2 shrink-0 rotate-45 inline-block" style={{ background: HUMAN_COLOR }} />
              <span className="text-[10px] text-al-muted">Human</span>
            </div>
          </div>
        </div>

        {/* ── Right: chat (55%) ── */}
        <div className="flex-1 flex flex-col min-h-0">

          {/* Chat header */}
          <div className="shrink-0 border-b border-al-border bg-al-surface px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-al-text">{roomId}</span>
              <StatusBadge status={status} />
            </div>
            {participantCount > 0 && (
              <span className="text-xs text-al-muted">{participantCount} participants</span>
            )}
          </div>

          {/* Team tabs — only shown when clusters exist */}
          {graphClusters.length > 0 && (
            <div className="shrink-0 flex items-center border-b border-al-border bg-al-surface px-2 overflow-x-auto">
              {/* All tab */}
              <button
                onClick={() => setActiveTab("all")}
                className="relative px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors shrink-0"
                style={{ color: activeTab === "all" ? "#4ECDC4" : "#64748B" }}
              >
                All
                {activeTab === "all" && (
                  <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-[#4ECDC4]" />
                )}
              </button>
              {graphClusters.map((cluster) => (
                <button
                  key={cluster.id}
                  onClick={() => {
                    setActiveTab(cluster.id);
                    setUnreadClusters((prev) => {
                      const next = new Set(prev);
                      next.delete(cluster.id);
                      return next;
                    });
                  }}
                  className="relative px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors shrink-0 flex items-center gap-1.5"
                  style={{ color: activeTab === cluster.id ? cluster.color : "#64748B" }}
                >
                  {cluster.name}
                  {unreadClusters.has(cluster.id) && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: cluster.color }}
                    />
                  )}
                  {activeTab === cluster.id && (
                    <span
                      className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full"
                      style={{ background: cluster.color }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}

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
                <p className="text-sm">Connecting…</p>
                <p className="text-xs mt-1">Send a message to start the session</p>
              </div>
            )}
            {visibleMessages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                roomId={roomId}
                cluster={clusterByNodeId.get(msg.agentId)}
                deliverableExt={deliverableExt}
                onDownloadDeliverable={msg.type === "DELIVERABLE" ? downloadDeliverable : undefined}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {!isClosed && (
            <div className="shrink-0 border-t border-al-border bg-al-surface px-4 py-3">
              {messagesRemaining != null && (
                <div className="flex justify-end mb-1.5">
                  <span className="text-[10px] text-al-muted tabular-nums">
                    {messagesRemaining} demo message{messagesRemaining === 1 ? "" : "s"} remaining
                  </span>
                </div>
              )}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder="Send a message…"
                  disabled={sending}
                  className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors disabled:opacity-50"
                />
                <button
                  onClick={sendMessage}
                  disabled={sending || !inputText.trim()}
                  className="px-4 py-1.5 bg-al-accent text-al-bg rounded-lg text-sm font-semibold hover:bg-al-accent-dim active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {sending && (
                    <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 12 12">
                      <circle className="opacity-25" cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="2" />
                      <path className="opacity-75" fill="currentColor" d="M10 6a4 4 0 0 0-4-4V0a6 6 0 0 1 6 6h-2z" />
                    </svg>
                  )}
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
                  onClick={() => postVerdict("CONFORME")}
                  disabled={verdictLoading}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                  style={{
                    background: "rgba(34,197,94,0.12)",
                    border: "1px solid rgba(34,197,94,0.4)",
                    color: "#22C55E",
                  }}
                >
                  CONFORME
                </button>
                <button
                  onClick={() => postVerdict("NO_CONFORME")}
                  disabled={verdictLoading}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
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
          roomId={roomId}
          agents={agentNodes}
          messages={messages}
          graphClusters={graphClusters}
          agentRates={agentRates}
          sessionCost={sessionCost}
          deliverable={deliverableMsg}
          deliverableExt={deliverableExt}
          onDownloadDeliverable={deliverableMsg ? downloadDeliverable : undefined}
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

function MessageBubble({
  msg,
  roomId,
  cluster,
  deliverableExt = "md",
  onDownloadDeliverable,
}: {
  msg: Message;
  roomId: string;
  cluster?: GraphCluster;
  deliverableExt?: string;
  onDownloadDeliverable?: (msg: Message) => void;
}) {
  const rc  = msg.isHuman ? HUMAN_COLOR : (ROLE_COLOR[msg.role] ?? "#64748B");
  const mtc = MSG_COLOR[msg.type];
  const ini = msg.isHuman ? "YOU" : initials(msg.agentName);

  return (
    <div className="flex gap-3">
      <div
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: `${rc}1A`, border: `1.5px solid ${rc}55`, color: rc }}
      >
        {ini}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          <span className="text-sm font-semibold text-al-text">{msg.agentName}</span>
          {cluster && !msg.isHuman && (
            <span
              className="text-[10px] font-semibold rounded px-1.5 py-0.5 leading-none"
              style={{
                background: `${cluster.color}22`,
                color: cluster.color,
                border: `1px solid ${cluster.color}44`,
              }}
            >
              {cluster.name}
            </span>
          )}
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
        <div
          className="rounded-xl px-3.5 py-2.5 text-sm text-al-text leading-relaxed whitespace-pre-line break-words"
          style={{ background: "rgba(13,20,33,0.7)", border: "1px solid #1E2D4A" }}
        >
          {msg.content}
        </div>
        {onDownloadDeliverable && (
          <button
            onClick={() => onDownloadDeliverable(msg)}
            className="w-full mt-1.5 flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer"
            style={{
              background: "rgba(78,205,196,0.08)",
              border: "1px solid rgba(78,205,196,0.35)",
              color: "#4ECDC4",
            }}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth={1.5} d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5M3 17h14" />
            </svg>
            <span>
              Download deliverable · <span className="opacity-70">AgentLink_Deliverable_{roomId}.{deliverableExt}</span>
            </span>
          </button>
        )}
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
  roomId,
  agents,
  messages,
  graphClusters,
  agentRates,
  sessionCost,
  deliverable,
  deliverableExt = "md",
  onDownloadDeliverable,
  onDownload,
  onClose,
}: {
  outcome: "SUCCESS" | "DISPUTED";
  roomId: string;
  agents: GraphNode[];
  messages: Message[];
  graphClusters: GraphCluster[];
  agentRates: Record<string, number>;
  sessionCost?: number | null;
  deliverable?: Message | null;
  deliverableExt?: string;
  onDownloadDeliverable?: (msg: Message) => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const isSuccess = outcome === "SUCCESS";
  const color     = isSuccess ? "#22C55E" : "#F59E0B";

  // Contribution breakdown
  const agentMsgCounts = agents.map((a) => ({
    agent: a,
    count: messages.filter((m) => m.agentId === a.id && !m.isHuman && m.agentId !== "system").length,
    cluster: graphClusters.find((c) => c.id === a.clusterId),
    rate: agentRates[a.id] ?? 15,
  }));
  const totalMsgs = agentMsgCounts.reduce((s, a) => s + a.count, 0);
  const totalCost = agentMsgCounts.reduce((s, a) => s + a.rate, 0);
  const alcFee = Math.round(totalCost * 0.08 * 10) / 10;
  const distributable = Math.round((totalCost - alcFee) * 10) / 10;

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

        {/* Reputation updates derived from actual session agents */}
        {agents.length > 0 && (
          <div className="bg-al-bg rounded-xl border border-al-border p-4 mb-4">
            <p className="text-[10px] text-al-muted uppercase tracking-wider mb-3">Reputation Updates</p>
            <div className="space-y-2">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between">
                  <span className="text-sm text-al-text">{agent.label}</span>
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: isSuccess ? "#22C55E" : "#EF4444" }}
                  >
                    {isSuccess ? "+0.10" : "-0.10"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contribution breakdown */}
        {agents.length > 0 && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 mb-4 overflow-hidden">
            <div className="px-4 py-2 border-b border-amber-400/15">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider font-bold">Contribution Breakdown</p>
            </div>
            <div className="px-3 py-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1.5 items-center">
                <span className="text-[9px] text-al-muted uppercase tracking-wider">Agent</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">Msgs</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">%</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">Earned</span>
                {agentMsgCounts.map(({ agent, count, cluster }) => {
                  const pct = totalMsgs > 0 ? Math.round((count / totalMsgs) * 100) : Math.round(100 / agents.length);
                  const earned = totalMsgs > 0
                    ? Math.round((count / totalMsgs) * distributable * 10) / 10
                    : Math.round((distributable / agents.length) * 10) / 10;
                  return (
                    <>
                      <div key={`name-${agent.id}`} className="min-w-0">
                        <div className="text-[11px] text-al-text truncate">{agent.label}</div>
                        {cluster && (
                          <div className="text-[9px] font-semibold" style={{ color: cluster.color }}>{cluster.name}</div>
                        )}
                      </div>
                      <span key={`msgs-${agent.id}`} className="text-[11px] text-al-muted-2 tabular-nums text-right">{count}</span>
                      <span key={`pct-${agent.id}`} className="text-[11px] text-al-text tabular-nums text-right">{pct}%</span>
                      <span key={`earn-${agent.id}`} className="text-[11px] font-semibold text-amber-400 tabular-nums text-right">{earned}</span>
                    </>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-amber-400/15 px-3 py-2 flex items-center justify-between">
              <span className="text-[11px] text-al-muted">AgentLink fee (8%)</span>
              <span className="text-[11px] text-al-muted tabular-nums">{alcFee} ALC</span>
            </div>
          </div>
        )}

        {/* Session cost */}
        {sessionCost != null && (
          <div className="mb-4 flex items-center justify-between px-3 py-2.5 bg-amber-400/5 border border-amber-400/20 rounded-xl">
            <span className="text-xs text-al-muted">Session cost deducted</span>
            <span className="text-sm font-bold text-amber-400 tabular-nums">{sessionCost} ALC</span>
          </div>
        )}

        {/* Room ID reference */}
        <div className="mb-5 px-3 py-2 bg-al-bg rounded-lg border border-al-border">
          <p className="text-[10px] text-al-muted mb-1">Session ID</p>
          <p className="font-mono text-xs text-al-text break-all">{roomId}</p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5">
          {deliverable && onDownloadDeliverable && (
            <button
              onClick={() => onDownloadDeliverable(deliverable)}
              className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              style={{
                background: "rgba(78,205,196,0.12)",
                border: "1px solid rgba(78,205,196,0.45)",
                color: "#4ECDC4",
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8 2v8m0 0L5 7m3 3l3-3M2 13h12" />
              </svg>
              Download Deliverable (.{deliverableExt})
            </button>
          )}
          <div className="flex gap-3">
            <button
              onClick={onDownload}
              className="flex-1 py-2 bg-al-bg border border-al-border rounded-lg text-sm text-al-text hover:border-al-accent/50 transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-al-muted" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M7 1v7m0 0L4.5 5.5M7 8l2.5-2.5M1 12h12" />
              </svg>
              Full Session Log
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{ background: `${color}15`, border: `1px solid ${color}40`, color }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
