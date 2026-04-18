"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Agent, SessionRole } from "../../lib/types";
import { MOCK_AGENTS } from "../../lib/api";

// ── Constants ──────────────────────────────────────────────────────────────

const NR = 44; // node radius px
const ROLES: SessionRole[] = ["Requester", "Contributor", "Reviewer", "Observer"];
const ROLE_COLOR: Record<SessionRole, string> = {
  Requester: "#4ECDC4",
  Contributor: "#818CF8",
  Reviewer: "#F59E0B",
  Observer: "#64748B",
};


const AL_RULES = [
  "All inter-agent messages must be cryptographically signed with the sending agent's registered key.",
  "Disputes unresolved within the session timeout are escalated to the AgentLink arbitration protocol.",
  "Session events are immutably logged on the AgentLink ledger and cannot be altered post-commit.",
  "Each agent must declare any conflict of interest before accepting a task assignment.",
  "Funds are held in escrow and released only upon verified session completion or arbitration ruling.",
];

// ── Human stub ────────────────────────────────────────────────────────────

const HUMAN_STUB: Agent = {
  agent_id: "human-owner",
  name: "YOU",
  description: "Human owner",
  skills: [],
  framework: "Human",
  public_key: "",
  reputation_technical: null,
  reputation_relational: null,
  total_jobs_completed: 0,
  total_jobs_disputed: 0,
  is_active: true,
};

const HUMAN_COLOR = "#F0A500";

// ── Types ──────────────────────────────────────────────────────────────────

interface CanvasNode {
  id: string;
  x: number;
  y: number;
  agent: Agent;
  role: SessionRole;
  isHuman?: boolean;
}

interface Conn {
  id: string;
  fromId: string;
  toId: string;
}

interface CustomClause {
  id: string;
  value: string;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(/[-\s]/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function dist2(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function ptSegDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
) {
  const ab = dist2(ax, ay, bx, by);
  if (ab === 0) return dist2(px, py, ax, ay);
  const t = Math.max(0, Math.min(1,
    ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (ab * ab),
  ));
  return dist2(px, py, ax + t * (bx - ax), ay + t * (by - ay));
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

// ── Component ──────────────────────────────────────────────────────────────

export default function SessionBuildClient() {
  const searchParams = useSearchParams();

  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasW, setCanvasW] = useState(800);
  const [canvasH, setCanvasH] = useState(600);

  // Graph state
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);

  // Interaction — mutable refs to avoid stale closures in event handlers
  const draggingRef = useRef<{ nodeId: string; ox: number; oy: number } | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const connsRef = useRef<Conn[]>([]);
  const linkingRef = useRef<string | null>(null); // nodeId of link source
  const hoveredConnRef = useRef<string | null>(null);

  // Zoom / pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // Reactive state for re-render/redraw triggers
  const [linking, setLinking] = useState<string | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [hoveredConn, setHoveredConn] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  // Agent picker
  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // Contract
  const [task, setTask] = useState("");
  const [criteria, setCriteria] = useState("");
  const [maxRevisions, setMaxRevisions] = useState(3);
  const [sessionTimeout, setSessionTimeout] = useState("48h");
  const [customClauses, setCustomClauses] = useState<CustomClause[]>([]);
  const [rulesExpanded, setRulesExpanded] = useState(false);

  // Keep refs in sync with state
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { connsRef.current = conns; }, [conns]);
  useEffect(() => { linkingRef.current = linking; }, [linking]);
  useEffect(() => { hoveredConnRef.current = hoveredConn; }, [hoveredConn]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Stable session ID (generated once per mount)
  const sessionIdRef = useRef(`AL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);

  // ── Init from URL params ─────────────────────────────────────────────────

  useEffect(() => {
    const raw = searchParams.get("agents");
    const agentIds = raw ? raw.split(",").filter(Boolean) : [];
    if (agentIds.length === 0) return;

    const initial: CanvasNode[] = [];
    agentIds.forEach((id, i) => {
      const agent = MOCK_AGENTS.find((a) => a.agent_id === id);
      if (!agent) return;
      const angle = (i / agentIds.length) * 2 * Math.PI - Math.PI / 2;
      const r = agentIds.length === 1 ? 0 : 160;
      initial.push({
        id: `node-${id}`,
        x: 400 + Math.cos(angle) * r,
        y: 300 + Math.sin(angle) * r,
        agent,
        role: "Contributor",
      });
    });
    setNodes(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas resize ────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      setCanvasW(e.contentRect.width);
      setCanvasH(e.contentRect.height);
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  // ── Draw ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasW === 0 || canvasH === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasW * dpr;
    canvas.height = canvasH * dpr;
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, canvasW, canvasH);

    // Apply viewport transform (pan + zoom); all world-space drawing goes inside this.
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Dot grid — draw over the visible world area only
    const wxMin = Math.floor(-pan.x / zoom / 40) * 40;
    const wxMax = Math.ceil((canvasW - pan.x) / zoom / 40) * 40;
    const wyMin = Math.floor(-pan.y / zoom / 40) * 40;
    const wyMax = Math.ceil((canvasH - pan.y) / zoom / 40) * 40;
    ctx.fillStyle = "rgba(30,45,74,0.5)";
    for (let x = wxMin; x <= wxMax; x += 40) {
      for (let y = wyMin; y <= wyMax; y += 40) {
        ctx.beginPath();
        ctx.arc(x, y, 1 / zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    // ── Connections ──────────────────────────────────────────────────────
    for (const c of conns) {
      const from = nodes.find((n) => n.id === c.fromId);
      const to = nodes.find((n) => n.id === c.toId);
      if (!from || !to) continue;
      const hov = hoveredConn === c.id;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = hov ? "#4ECDC4" : "#253A5E";
      ctx.lineWidth = hov ? 2 : 1.5;
      ctx.setLineDash(hov ? [] : [5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (hov) {
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        // ✕ circle
        ctx.beginPath();
        ctx.arc(mx, my, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#0D1421";
        ctx.fill();
        ctx.strokeStyle = "#4ECDC4";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // ✕ lines
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.strokeStyle = "#4ECDC4";
        ctx.lineWidth = 1.5;
        ctx.moveTo(mx - 4, my - 4); ctx.lineTo(mx + 4, my + 4);
        ctx.moveTo(mx + 4, my - 4); ctx.lineTo(mx - 4, my + 4);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    }

    // ── Active link arm ──────────────────────────────────────────────────
    if (linking && linkCursor) {
      const from = nodes.find((n) => n.id === linking);
      if (from) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(linkCursor.x, linkCursor.y);
        ctx.strokeStyle = "rgba(78,205,196,0.75)";
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(linkCursor.x, linkCursor.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#4ECDC4";
        ctx.fill();
      }
    }

    // ── Hover edge arm ───────────────────────────────────────────────────
    if (hoveredEdge && !linking && !draggingRef.current && linkCursor) {
      const node = nodes.find((n) => n.id === hoveredEdge);
      if (node) {
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(linkCursor.x, linkCursor.y);
        ctx.strokeStyle = "rgba(78,205,196,0.18)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ── Nodes ────────────────────────────────────────────────────────────
    for (const node of nodes) {
      const rc = node.isHuman ? HUMAN_COLOR : ROLE_COLOR[node.role];
      const active =
        hoveredNode === node.id ||
        draggingRef.current?.nodeId === node.id ||
        linking === node.id;

      ctx.save();

      if (active) {
        ctx.shadowColor = `${rc}70`;
        ctx.shadowBlur = 22;
      }

      // Fill
      const g = ctx.createRadialGradient(node.x, node.y - 14, 4, node.x, node.y, NR);
      g.addColorStop(0, "#1B2845");
      g.addColorStop(1, "#0B1120");

      if (node.isHuman) {
        // Diamond shape
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
      ctx.shadowBlur = 0;

      // Border
      ctx.strokeStyle = active ? rc : `${rc}66`;
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.stroke();

      // Label
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillStyle = rc;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.isHuman ? "YOU" : initials(node.agent.name), node.x, node.y - 9);

      // Agent name — truncate to fit
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = "#CBD5E1";
      const maxW = NR * 1.7;
      let label = node.agent.name;
      while (ctx.measureText(label).width > maxW && label.length > 2) {
        label = label.slice(0, -1);
      }
      if (label !== node.agent.name) label += "…";
      ctx.fillText(label, node.x, node.y + 10);

      // Role badge below node
      const badgeY = node.y + NR + 10;
      ctx.font = `bold 9px ${FONT}`;
      const bw = ctx.measureText(node.role.toUpperCase()).width + 14;
      const bh = 16;
      rrect(ctx, node.x - bw / 2, badgeY - bh / 2, bw, bh, 8);
      ctx.fillStyle = `${rc}22`;
      ctx.fill();
      ctx.strokeStyle = `${rc}55`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = rc;
      ctx.textBaseline = "middle";
      ctx.fillText(node.role.toUpperCase(), node.x, badgeY);

      ctx.restore();
    }

    ctx.restore(); // undo pan/zoom transform
  }, [nodes, conns, hoveredNode, hoveredEdge, hoveredConn, linking, linkCursor, canvasW, canvasH, zoom, pan]);

  // ── Canvas helpers ───────────────────────────────────────────────────────

  function getPos(e: { clientX: number; clientY: number }) {
    const r = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    return {
      x: (sx - panRef.current.x) / zoomRef.current,
      y: (sy - panRef.current.y) / zoomRef.current,
    };
  }

  function nodeAt(x: number, y: number): CanvasNode | null {
    const ns = nodesRef.current;
    for (let i = ns.length - 1; i >= 0; i--) {
      if (dist2(x, y, ns[i].x, ns[i].y) <= NR) return ns[i];
    }
    return null;
  }

  function edgeNodeAt(x: number, y: number): CanvasNode | null {
    const ns = nodesRef.current;
    for (let i = ns.length - 1; i >= 0; i--) {
      const d = dist2(x, y, ns[i].x, ns[i].y);
      if (d > NR && d < NR + 32) return ns[i];
    }
    return null;
  }

  function connAt(x: number, y: number): Conn | null {
    for (const c of connsRef.current) {
      const from = nodesRef.current.find((n) => n.id === c.fromId);
      const to = nodesRef.current.find((n) => n.id === c.toId);
      if (!from || !to) continue;
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      if (dist2(x, y, mx, my) < 14) return c;
      if (ptSegDist(x, y, from.x, from.y, to.x, to.y) < 10) return c;
    }
    return null;
  }

  // ── Mouse handlers ───────────────────────────────────────────────────────

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;

    if (contextMenu) {
      setContextMenu(null);
      return;
    }

    const pos = getPos(e);

    // Complete or cancel link
    if (linkingRef.current) {
      const target = nodeAt(pos.x, pos.y);
      if (target && target.id !== linkingRef.current) {
        const fromId = linkingRef.current;
        const already = connsRef.current.some(
          (c) =>
            (c.fromId === fromId && c.toId === target.id) ||
            (c.fromId === target.id && c.toId === fromId),
        );
        if (!already) {
          setConns((prev) => [
            ...prev,
            { id: `c-${Date.now()}`, fromId, toId: target.id },
          ]);
        }
      }
      setLinking(null);
      setLinkCursor(null);
      return;
    }

    // Delete connection via ✕
    const c = connAt(pos.x, pos.y);
    if (c) {
      const from = nodesRef.current.find((n) => n.id === c.fromId);
      const to = nodesRef.current.find((n) => n.id === c.toId);
      if (from && to) {
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        if (dist2(pos.x, pos.y, mx, my) < 14) {
          setConns((prev) => prev.filter((cc) => cc.id !== c.id));
          setHoveredConn(null);
          return;
        }
      }
    }

    // Start drag
    const node = nodeAt(pos.x, pos.y);
    if (node) {
      draggingRef.current = { nodeId: node.id, ox: pos.x - node.x, oy: pos.y - node.y };
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = getPos(e);

    if (draggingRef.current) {
      const { nodeId, ox, oy } = draggingRef.current;
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, x: pos.x - ox, y: pos.y - oy } : n)),
      );
      return;
    }

    setLinkCursor(pos);

    const node = nodeAt(pos.x, pos.y);
    setHoveredNode(node?.id ?? null);

    if (node) {
      setHoveredEdge(null);
      setHoveredConn(null);
    } else {
      if (!linkingRef.current) {
        setHoveredEdge(edgeNodeAt(pos.x, pos.y)?.id ?? null);
      }
      setHoveredConn(connAt(pos.x, pos.y)?.id ?? null);
    }
  }

  function handleMouseUp() {
    draggingRef.current = null;
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const pos = getPos(e);
    const node = nodeAt(pos.x, pos.y);
    if (node) setContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }

  // ── Context menu actions ─────────────────────────────────────────────────

  function setRole(nodeId: string, role: SessionRole) {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, role } : n)));
    setContextMenu(null);
  }

  function startLink(nodeId: string) {
    setLinking(nodeId);
    setContextMenu(null);
  }

  function removeNode(nodeId: string) {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConns((prev) => prev.filter((c) => c.fromId !== nodeId && c.toId !== nodeId));
    setContextMenu(null);
  }

  // ── Agent picker ─────────────────────────────────────────────────────────

  function addAgent(agent: Agent) {
    const already = nodesRef.current.find((n) => n.agent.agent_id === agent.agent_id);
    if (already) return;
    const margin = 120 / zoomRef.current;
    const worldXMin = -panRef.current.x / zoomRef.current + margin;
    const worldXMax = (canvasW - panRef.current.x) / zoomRef.current - margin;
    const worldYMin = -panRef.current.y / zoomRef.current + margin;
    const worldYMax = (canvasH - panRef.current.y) / zoomRef.current - margin;
    const x = worldXMin + Math.random() * Math.max(1, worldXMax - worldXMin);
    const y = worldYMin + Math.random() * Math.max(1, worldYMax - worldYMin);
    setNodes((prev) => [
      ...prev,
      { id: `node-${agent.agent_id}-${Date.now()}`, x, y, agent, role: "Contributor" },
    ]);
    setShowPicker(false);
    setPickerSearch("");
  }

  function addHumanNode() {
    if (nodesRef.current.some((n) => n.isHuman)) return;
    const margin = 120 / zoomRef.current;
    const worldXMin = -panRef.current.x / zoomRef.current + margin;
    const worldXMax = (canvasW - panRef.current.x) / zoomRef.current - margin;
    const worldYMin = -panRef.current.y / zoomRef.current + margin;
    const worldYMax = (canvasH - panRef.current.y) / zoomRef.current - margin;
    const x = worldXMin + Math.random() * Math.max(1, worldXMax - worldXMin);
    const y = worldYMin + Math.random() * Math.max(1, worldYMax - worldYMin);
    setNodes((prev) => [
      ...prev,
      { id: "node-human-owner", x, y, agent: HUMAN_STUB, role: "Requester", isHuman: true },
    ]);
  }

  // ── Zoom helpers ─────────────────────────────────────────────────────────

  // Non-passive wheel handler so we can call e.preventDefault()
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(3, Math.max(0.3, zoomRef.current * factor));
      // Keep the world point under the cursor fixed after zoom change
      const newPanX = sx - ((sx - panRef.current.x) / zoomRef.current) * newZoom;
      const newPanY = sy - ((sy - panRef.current.y) / zoomRef.current) * newZoom;
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function zoomBy(factor: number) {
    const newZoom = Math.min(3, Math.max(0.3, zoomRef.current * factor));
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const newPanX = cx - ((cx - panRef.current.x) / zoomRef.current) * newZoom;
    const newPanY = cy - ((cy - panRef.current.y) / zoomRef.current) * newZoom;
    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }

  // ── Cursor ───────────────────────────────────────────────────────────────

  let cursor = "default";
  if (draggingRef.current) cursor = "grabbing";
  else if (linking) cursor = "crosshair";
  else if (hoveredNode) cursor = "grab";
  else if (hoveredEdge) cursor = "crosshair";
  else if (hoveredConn) cursor = "pointer";

  // ── Picker agents ────────────────────────────────────────────────────────

  const pickerAgents = MOCK_AGENTS.filter((a) => {
    if (nodes.some((n) => n.agent.agent_id === a.agent_id)) return false;
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.skills.some((s) => s.toLowerCase().includes(q))
    );
  });

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setLinking(null);
        setLinkCursor(null);
        setContextMenu(null);
        setShowPicker(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const canOpen = nodes.length >= 2;

  return (
    <div className="min-h-screen flex flex-col bg-al-bg text-al-text">
      {/* Navbar */}
      <header className="sticky top-0 z-30 bg-al-bg/90 backdrop-blur border-b border-al-border">
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
          <button
            disabled={!canOpen}
            className={`
              px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150
              ${canOpen
                ? "bg-al-accent text-al-bg hover:bg-al-accent-dim active:scale-[0.98]"
                : "bg-al-surface border border-al-border text-al-muted cursor-not-allowed"
              }
            `}
          >
            Open Session
          </button>
        </div>
      </header>

      {/* Top bar */}
      <div className="border-b border-al-border bg-al-surface px-4 py-3">
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the task for this agent session…"
          rows={2}
          className="w-full bg-al-bg border border-al-border rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted resize-none focus:outline-none focus:border-al-accent transition-colors"
        />
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Canvas area ── */}
        <div className="flex-1 relative overflow-hidden" ref={containerRef}>
          <canvas
            ref={canvasRef}
            style={{ cursor, display: "block" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={handleContextMenu}
          />

          {/* Empty state */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
              <div className="w-16 h-16 rounded-full border-2 border-dashed border-al-border flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-al-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <p className="text-sm font-medium text-al-muted-2">No agents on canvas</p>
              <p className="text-xs text-al-muted mt-1">
                Click <span className="text-al-accent">+ Add agent</span> below, or select from the{" "}
                <span className="text-al-accent">Directory</span>
              </p>
            </div>
          )}

          {/* Linking hint */}
          {linking && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-al-surface border border-al-accent/40 rounded-lg px-4 py-2 text-xs text-al-accent shadow-xl pointer-events-none select-none">
              Click another agent node to connect · Esc to cancel
            </div>
          )}

          {/* + Add agent */}
          <div className="absolute bottom-5 left-5 flex items-center gap-2">
            <button
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-2 px-3.5 py-2 bg-al-surface border border-al-border rounded-xl text-sm text-al-text hover:border-al-accent/60 hover:text-al-accent transition-all shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8 3v10M3 8h10" />
              </svg>
              Add agent
            </button>
            <button
              onClick={addHumanNode}
              disabled={nodes.some((n) => n.isHuman)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all shadow-lg border
                ${nodes.some((n) => n.isHuman)
                  ? "bg-al-surface border-al-border text-al-muted cursor-not-allowed opacity-50"
                  : "bg-[#F0A500]/10 border-[#F0A500]/40 text-[#F0A500] hover:bg-[#F0A500]/20 hover:border-[#F0A500]/70"
                }
              `}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6a5 5 0 0 1 10 0" />
              </svg>
              Add me as human
            </button>
          </div>

          {/* Context menu */}
          {contextMenu && (() => {
            const node = nodes.find((n) => n.id === contextMenu.nodeId);
            if (!node) return null;
            return (
              <div
                className="fixed z-50 bg-al-surface border border-al-border rounded-xl shadow-2xl py-1 min-w-[168px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 text-[10px] text-al-muted uppercase tracking-wider border-b border-al-border mb-1">
                  Set Role
                </div>
                {ROLES.map((role) => (
                  <button
                    key={role}
                    onClick={() => setRole(contextMenu.nodeId, role)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-al-border/30 transition-colors"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: ROLE_COLOR[role] }}
                    />
                    <span className={node.role === role ? "text-al-accent" : "text-al-text"}>
                      {role}
                    </span>
                    {node.role === role && (
                      <svg className="w-3 h-3 ml-auto text-al-accent" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                        <path strokeLinecap="round" strokeWidth={1.5} d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </button>
                ))}
                <div className="border-t border-al-border mt-1 pt-1">
                  <button
                    onClick={() => startLink(contextMenu.nodeId)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-al-text hover:bg-al-border/30 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-al-muted flex-shrink-0" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                      <circle cx="3" cy="7" r="2" strokeWidth="1.5" />
                      <circle cx="11" cy="7" r="2" strokeWidth="1.5" />
                      <path d="M5 7h4" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Link agent
                  </button>
                  <button
                    onClick={() => removeNode(contextMenu.nodeId)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                      <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l8 8M11 3l-8 8" />
                    </svg>
                    Remove
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Zoom controls */}
          <div className="absolute bottom-5 right-5 flex items-center gap-0.5 bg-al-surface border border-al-border rounded-xl shadow-lg px-1.5 py-1 z-10">
            <button
              onClick={() => zoomBy(1 / 1.2)}
              aria-label="Zoom out"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-al-muted hover:text-al-text hover:bg-al-border/40 transition-colors text-base leading-none select-none"
            >
              −
            </button>
            <span className="text-[11px] text-al-muted tabular-nums w-10 text-center font-mono select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => zoomBy(1.2)}
              aria-label="Zoom in"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-al-muted hover:text-al-text hover:bg-al-border/40 transition-colors text-base leading-none select-none"
            >
              +
            </button>
          </div>

          {/* Agent picker modal */}
          {showPicker && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-40"
              onMouseDown={() => { setShowPicker(false); setPickerSearch(""); }}
            >
              <div
                className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-80 max-h-[480px] flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-al-border">
                  <span className="font-semibold text-sm text-al-text">Add Agent</span>
                  <button
                    onClick={() => { setShowPicker(false); setPickerSearch(""); }}
                    className="w-7 h-7 flex items-center justify-center rounded text-al-muted hover:text-al-text transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                      <path strokeLinecap="round" strokeWidth={1.5} d="M3 3l10 10M13 3L3 13" />
                    </svg>
                  </button>
                </div>
                <div className="px-3 py-2">
                  <input
                    autoFocus
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Search by name or skill…"
                    className="w-full bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                  />
                </div>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
                  {pickerAgents.length === 0 ? (
                    <p className="text-xs text-al-muted text-center py-8">
                      {MOCK_AGENTS.every((a) => nodes.some((n) => n.agent.agent_id === a.agent_id))
                        ? "All agents are already on the canvas"
                        : "No agents match your search"}
                    </p>
                  ) : (
                    pickerAgents.map((agent) => (
                      <button
                        key={agent.agent_id}
                        onClick={() => addAgent(agent)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-al-bg transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-full bg-al-accent/15 border border-al-accent/25 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-al-accent">{initials(agent.name)}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-al-text truncate">{agent.name}</div>
                          <div className="text-[11px] text-al-muted truncate">
                            {agent.framework} · {agent.skills.slice(0, 2).join(", ")}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Contract panel ── */}
        <aside className="w-80 flex-shrink-0 border-l border-al-border flex flex-col overflow-hidden bg-al-surface">
          {/* Panel header */}
          <div className="px-4 pt-4 pb-3 border-b border-al-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-al-accent" />
              <h2 className="font-semibold text-sm text-al-text">Session Contract</h2>
            </div>
            <div className="text-[11px] text-al-muted mt-0.5 font-mono">{sessionIdRef.current}</div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">

            {/* § 1 — AgentLink absolute rules */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-al-muted uppercase tracking-widest">
                  AgentLink Rules
                </span>
                <span className="text-[9px] text-al-muted bg-al-bg border border-al-border px-1.5 py-0.5 rounded">
                  Non-editable
                </span>
              </div>
              <div className="bg-al-bg border border-al-border rounded-xl p-3 space-y-2.5">
                {AL_RULES.slice(0, rulesExpanded ? AL_RULES.length : 2).map((rule, i) => (
                  <div key={i} className="flex gap-2 text-[11px] text-al-muted-2 leading-relaxed">
                    <span className="text-al-accent/60 mt-0.5 flex-shrink-0">›</span>
                    <span>{rule}</span>
                  </div>
                ))}
                <button
                  onClick={() => setRulesExpanded((v) => !v)}
                  className="text-[11px] text-al-accent hover:underline transition-colors"
                >
                  {rulesExpanded
                    ? "Show less"
                    : `Read more (${AL_RULES.length - 2} more rules)`}
                </button>
              </div>
            </section>

            {/* § 2 — Auto-generated contract */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-al-muted uppercase tracking-widest">
                  Task Contract
                </span>
                <span className="text-[9px] text-al-accent bg-al-accent/10 border border-al-accent/20 px-1.5 py-0.5 rounded">
                  Auto-generated
                </span>
              </div>

              <div className="space-y-3">
                {/* Participants */}
                {nodes.length > 0 && (
                  <div className="bg-al-bg border border-al-border rounded-xl p-3">
                    <div className="text-[10px] text-al-muted uppercase tracking-wider mb-2">
                      Participants ({nodes.length})
                    </div>
                    <div className="space-y-1.5">
                      {nodes.map((n) => {
                        const rc = n.isHuman ? HUMAN_COLOR : ROLE_COLOR[n.role];
                        return (
                          <div key={n.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <div
                                className={`w-1.5 h-1.5 flex-shrink-0 ${n.isHuman ? "rotate-45" : "rounded-full"}`}
                                style={{ background: rc }}
                              />
                              <span className="text-xs text-al-text truncate">{n.agent.name}</span>
                            </div>
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ color: rc, background: `${rc}18` }}
                            >
                              {n.role}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Acceptance criteria */}
                <div>
                  <label className="block text-[11px] text-al-muted mb-1.5">
                    Acceptance criteria
                  </label>
                  <textarea
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value)}
                    placeholder="What defines successful completion of this session?"
                    rows={3}
                    className="w-full bg-al-bg border border-al-border rounded-lg px-3 py-2 text-xs text-al-text placeholder:text-al-muted resize-none focus:outline-none focus:border-al-accent transition-colors"
                  />
                </div>

                {/* Max revisions */}
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-al-muted">Max revisions</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setMaxRevisions((v) => Math.max(0, v - 1))}
                      className="w-6 h-6 rounded border border-al-border bg-al-bg text-al-muted hover:text-al-text hover:border-al-accent/50 transition-colors flex items-center justify-center text-base leading-none"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm text-al-text font-medium tabular-nums">
                      {maxRevisions}
                    </span>
                    <button
                      onClick={() => setMaxRevisions((v) => v + 1)}
                      className="w-6 h-6 rounded border border-al-border bg-al-bg text-al-muted hover:text-al-text hover:border-al-accent/50 transition-colors flex items-center justify-center text-base leading-none"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Session timeout */}
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-al-muted">Session timeout</label>
                  <select
                    value={sessionTimeout}
                    onChange={(e) => setSessionTimeout(e.target.value)}
                    className="bg-al-bg border border-al-border rounded-lg px-2.5 py-1 text-xs text-al-text focus:outline-none focus:border-al-accent transition-colors cursor-pointer"
                  >
                    {["12h", "24h", "48h", "72h", "1 week"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                {/* Custom clauses */}
                {customClauses.map((clause, i) => (
                  <div key={clause.id} className="flex gap-2 items-start">
                    <input
                      value={clause.value}
                      onChange={(e) =>
                        setCustomClauses((prev) =>
                          prev.map((c) =>
                            c.id === clause.id ? { ...c, value: e.target.value } : c,
                          ),
                        )
                      }
                      placeholder={`Custom clause ${i + 1}…`}
                      className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-xs text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                    />
                    <button
                      onClick={() =>
                        setCustomClauses((prev) => prev.filter((c) => c.id !== clause.id))
                      }
                      className="mt-0.5 w-7 h-7 flex items-center justify-center rounded border border-al-border text-al-muted hover:text-red-400 hover:border-red-400/40 transition-colors flex-shrink-0"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                        <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l8 8M10 2l-8 8" />
                      </svg>
                    </button>
                  </div>
                ))}

                {/* Add clause */}
                <button
                  onClick={() =>
                    setCustomClauses((prev) => [
                      ...prev,
                      { id: `clause-${Date.now()}`, value: "" },
                    ])
                  }
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-al-muted border border-dashed border-al-border rounded-lg hover:border-al-accent/50 hover:text-al-accent transition-all"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                    <path strokeLinecap="round" strokeWidth={1.5} d="M6 2v8M2 6h8" />
                  </svg>
                  Add clause
                </button>
              </div>
            </section>
          </div>

          {/* Open Session */}
          <div className="px-4 py-4 border-t border-al-border flex-shrink-0">
            <button
              disabled={!canOpen}
              className={`
                w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-150
                ${canOpen
                  ? "bg-al-accent text-al-bg hover:bg-al-accent-dim active:scale-[0.98] shadow-[0_0_20px_theme(colors.al-accent/25)]"
                  : "bg-al-bg border border-al-border text-al-muted cursor-not-allowed"
                }
              `}
            >
              Open Session
            </button>
            {!canOpen && (
              <p className="text-[11px] text-al-muted text-center mt-1.5">
                Add two participants to start a session
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
