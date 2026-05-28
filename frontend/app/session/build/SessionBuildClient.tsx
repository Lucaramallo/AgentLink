"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { Agent, SessionRole } from "../../lib/types";
import { fetchAgents, fetchMySessionDetail } from "../../lib/api";
import { agentSessionFee, agentCostPerMessage } from "../../lib/rates";
import { useCredits } from "../../lib/credits";
import { useAuth } from "../../lib/auth";
import { frameworkColor } from "../../lib/frameworkColors";

const API_BASE = "http://127.0.0.1:8000/api/v1";
const OWNER_A = "a1222444-7a2a-471f-89d3-cfb4762eaba3";
const OWNER_B = "7059dca2-afe8-4908-9e69-b2451b0be356";

// ── Team template types & helpers ──────────────────────────────────────────

interface TeamTemplate {
  id: string;
  name: string;
  description: string | null;
  agents: Array<{ slug: string; role: SessionRole; cluster_id?: string | null; node_id?: string; is_human?: boolean; is_builder?: boolean; x?: number; y?: number }>;
  edges: Array<{ from: string; to: string }>;
  clusters: Array<{ id: string; name: string; color: string; x: number; y: number; rx: number; ry: number; subTask?: string }>;
  created_at: string;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("agentlink_token");
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

function parseTimeoutHours(s: string): number {
  if (s === "1 week") return 168;
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]) : 48;
}

// ── Constants ──────────────────────────────────────────────────────────────

const NR = 44;
const ROLES: SessionRole[] = ["Requester", "Contributor", "Reviewer", "Observer", "Coordinator"];
const ROLE_COLOR: Record<SessionRole, string> = {
  Requester: "#4ECDC4",
  Contributor: "#818CF8",
  Reviewer: "#F59E0B",
  Observer: "#64748B",
  Coordinator: "#FF6B35",
};

const CLUSTER_COLORS = ["#00BCD4", "#9575CD", "#FFB300", "#FF7043"];
const CLUSTER_NAMES = ["Team Alpha", "Team Beta", "Team Gamma", "Team Delta", "Team Epsilon"];

const ACCEPTED_TYPES = ".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.gif,.webp,.ts,.tsx,.js,.jsx,.py,.md,.txt,.json,.zip";

const AL_RULES = [
  "All inter-agent messages must be cryptographically signed with the sending agent's registered key.",
  "Disputes unresolved within the session timeout are escalated to the AgentLink arbitration protocol.",
  "Session events are immutably logged on the AgentLink ledger and cannot be altered post-commit.",
  "Each agent must declare any conflict of interest before accepting a task assignment.",
  "Funds are held in escrow and released only upon verified session completion or arbitration ruling.",
];

// ── Human stub ────────────────────────────────────────────────────────────

const HUMAN_STUB: Agent = {
  id: "human-owner",
  name: "YOU",
  description: "Human owner",
  skills: [],
  framework: "Human",
  public_key: "",
  reputationTech: null,
  reputationRel: null,
  jobsCompleted: 0,
  total_jobs_disputed: 0,
  is_active: true, frozen: false,
  session_fee: 0,
  cost_per_message: 0,
  webhook_url: null,
  github_repo_url: null,
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
  clusterId?: string;
  isBuilder?: boolean;
}

interface Conn {
  id: string;
  fromId: string;
  toId: string;
}

interface Cluster {
  id: string;
  name: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: string;
  subTask: string;
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

function isInsideEllipse(x: number, y: number, c: Cluster): boolean {
  return ((x - c.x) / c.rx) ** 2 + ((y - c.y) / c.ry) ** 2 <= 1;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SessionBuildClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace(`/login?return_url=${encodeURIComponent("/session/build")}`);
    }
  }, [authLoading, isAuthenticated, router]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasW, setCanvasW] = useState(800);
  const [canvasH, setCanvasH] = useState(600);

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);

  // Interaction refs
  const draggingRef = useRef<{ nodeId: string; ox: number; oy: number } | null>(null);
  const draggingClusterRef = useRef<{ clusterId: string; ox: number; oy: number; prevX: number; prevY: number } | null>(null);
  const resizingClusterRef = useRef<{ clusterId: string; handle: "n" | "s" | "e" | "w" } | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const connsRef = useRef<Conn[]>([]);
  const clustersRef = useRef<Cluster[]>([]);
  const linkingRef = useRef<string | null>(null);
  const hoveredConnRef = useRef<string | null>(null);

  // Zoom / pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // Reactive hover / interaction state
  const [linking, setLinking] = useState<string | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [hoveredConn, setHoveredConn] = useState<string | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [editingClusterName, setEditingClusterName] = useState<string | null>(null);

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

  // Open session
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showCostModal, setShowCostModal] = useState(false);
  const [agentAddedToast, setAgentAddedToast] = useState<string | null>(null);
  const agentAddedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { balance, deduct } = useCredits();

  // Attachments & GitHub
  const [githubRepo, setGithubRepo] = useState("");
  const [githubUrlValid, setGithubUrlValid] = useState(false);
  const [githubUrlError, setGithubUrlError] = useState<string | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [restoredFileNames, setRestoredFileNames] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Continue session
  const continueFromLoadedRef = useRef(false);
  const [continueFromId, setContinueFromId] = useState<string | null>(null);

  // Team templates
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [showLoadTemplateModal, setShowLoadTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [savedTemplates, setSavedTemplates] = useState<TeamTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Keep refs in sync with state
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { connsRef.current = conns; }, [conns]);
  useEffect(() => { clustersRef.current = clusters; }, [clusters]);
  useEffect(() => { linkingRef.current = linking; }, [linking]);
  useEffect(() => { hoveredConnRef.current = hoveredConn; }, [hoveredConn]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const sessionIdRef = useRef(`AL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);

  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  useEffect(() => { fetchAgents().then(setAllAgents); }, []);

  // ── Init from URL params ─────────────────────────────────────────────────

  useEffect(() => {
    const raw = searchParams.get("agents");
    const agentIds = raw ? raw.split(",").filter(Boolean) : [];
    if (agentIds.length === 0 || allAgents.length === 0) return;

    const initial: CanvasNode[] = [];
    agentIds.forEach((id, i) => {
      const agent = allAgents.find((a) => a.id === id);
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
  }, [allAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Init from sessionStorage (new-session flow) ──────────────────────────

  const sessionContextLoadedRef = useRef(false);
  useEffect(() => {
    if (allAgents.length === 0 || sessionContextLoadedRef.current) return;
    const raw = sessionStorage.getItem("al_new_session");
    if (!raw) return;
    sessionContextLoadedRef.current = true;
    try {
      const data = JSON.parse(raw) as {
        taskDescription?: string;
        acceptanceCriteria?: string;
        githubRepo?: string;
        fileNames?: string[];
        recommendedAgents?: Array<{
          id: string; name: string; description: string; skills: string[];
          framework: string; public_key: string; reputationTech: number | null;
          reputationRel: number | null; jobsCompleted: number;
          total_jobs_disputed: number; is_active: boolean; frozen: boolean;
          role: SessionRole;
        }>;
        recommendedEdges?: Array<{ a: string; b: string }>;
      };
      if (data.taskDescription) setTask(data.taskDescription);
      if (data.acceptanceCriteria) setCriteria(data.acceptanceCriteria);
      if (data.githubRepo) setGithubRepo(data.githubRepo);
      if (data.fileNames && data.fileNames.length > 0) {
        setRestoredFileNames(data.fileNames);
        if (!attachmentsOpen) setAttachmentsOpen(true);
      }
      if (data.recommendedAgents && data.recommendedAgents.length > 0) {
        const preNodes: CanvasNode[] = data.recommendedAgents.map((ra, i) => {
          const found = allAgents.find((a) => a.id === ra.id);
          const agent: Agent = found ?? {
            id: ra.id, name: ra.name, description: ra.description,
            skills: ra.skills, framework: ra.framework, public_key: ra.public_key,
            reputationTech: ra.reputationTech, reputationRel: ra.reputationRel,
            jobsCompleted: ra.jobsCompleted, total_jobs_disputed: ra.total_jobs_disputed,
            is_active: ra.is_active, frozen: ra.frozen,
            session_fee: 0, cost_per_message: 0,
            webhook_url: null, github_repo_url: null,
          };
          const total = data.recommendedAgents!.length;
          const angle = total === 1 ? -Math.PI / 2 : (i / total) * 2 * Math.PI - Math.PI / 2;
          const r = total === 1 ? 0 : 160;
          return {
            id: `node-${ra.id}`,
            x: 400 + Math.cos(angle) * r,
            y: 300 + Math.sin(angle) * r,
            agent,
            role: ra.role ?? "Contributor",
          };
        });
        setNodes(preNodes);
        if (data.recommendedEdges && data.recommendedEdges.length > 0) {
          setConns(
            data.recommendedEdges.map((e, i) => ({
              id: `conn-${i}`,
              fromId: `node-${e.a}`,
              toId: `node-${e.b}`,
            })),
          );
        }
      }
      sessionStorage.removeItem("al_new_session");
    } catch {
      // ignore malformed data
    }
  }, [allAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas resize ────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      setCanvasW(e.contentRect.width);
      setCanvasH(Math.max(0, e.contentRect.height - 50));
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

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Dot grid
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

    // ── Clusters (drawn behind nodes) ────────────────────────────────────
    for (const c of clusters) {
      const hov = hoveredCluster === c.id;

      ctx.save();

      // Ellipse fill
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = `${c.color}1a`;
      ctx.fill();

      // Ellipse border
      ctx.strokeStyle = hov ? `${c.color}cc` : `${c.color}55`;
      ctx.lineWidth = hov ? 2 : 1.5;
      ctx.setLineDash(hov ? [] : [10, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Cluster name label (skip if being edited — HTML input overlays it)
      if (editingClusterName !== c.id) {
        const labelY = c.y - c.ry + 22;
        ctx.font = `bold 13px ${FONT}`;
        ctx.fillStyle = hov ? c.color : `${c.color}bb`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(c.name, c.x, labelY);
      }

      // Resize handles at N / S / E / W — shown when hovered
      if (hov) {
        const handles = [
          { x: c.x,        y: c.y - c.ry },
          { x: c.x,        y: c.y + c.ry },
          { x: c.x + c.rx, y: c.y        },
          { x: c.x - c.rx, y: c.y        },
        ];
        for (const h of handles) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = c.color;
          ctx.fill();
          ctx.strokeStyle = "#0B1120";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      ctx.restore();
    }

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
        ctx.beginPath();
        ctx.arc(mx, my, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#0D1421";
        ctx.fill();
        ctx.strokeStyle = "#4ECDC4";
        ctx.lineWidth = 1.5;
        ctx.stroke();
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
    // Build per-agent instance counters so duplicates show "(2)", "(3)" etc.
    const agentInstanceCounter = new Map<string, number>();
    const nodeInstanceIndex = new Map<string, number>();
    for (const n of nodes) {
      const count = (agentInstanceCounter.get(n.agent.id) ?? 0) + 1;
      agentInstanceCounter.set(n.agent.id, count);
      nodeInstanceIndex.set(n.id, count);
    }

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

      const g = ctx.createRadialGradient(node.x, node.y - 14, 4, node.x, node.y, NR);
      g.addColorStop(0, "#1B2845");
      g.addColorStop(1, "#0B1120");

      if (node.isHuman) {
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - NR);
        ctx.lineTo(node.x + NR, node.y);
        ctx.lineTo(node.x, node.y + NR);
        ctx.lineTo(node.x - NR, node.y);
        ctx.closePath();
      } else if (node.role === "Coordinator") {
        // Hexagon for Coordinator nodes
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const hx = node.x + NR * Math.cos(angle);
          const hy = node.y + NR * Math.sin(angle);
          if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, NR, 0, Math.PI * 2);
      }
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = active ? rc : `${rc}66`;
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.stroke();

      ctx.font = `bold 15px ${FONT}`;
      ctx.fillStyle = rc;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.isHuman ? "YOU" : initials(node.agent.name), node.x, node.y - 9);

      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = "#CBD5E1";
      const maxW = NR * 1.7;
      const instanceIdx = nodeInstanceIndex.get(node.id) ?? 1;
      const instanceCount = agentInstanceCounter.get(node.agent.id) ?? 1;
      const suffix = instanceCount > 1 && instanceIdx > 1 ? ` (${instanceIdx})` : "";
      const fullLabel = node.agent.name + suffix;
      let label = fullLabel;
      while (ctx.measureText(label).width > maxW && label.length > 2) {
        label = label.slice(0, -1);
      }
      if (label !== fullLabel) label += "…";
      ctx.fillText(label, node.x, node.y + 10);

      // Coordinator crown badge (top-left of node)
      if (node.role === "Coordinator") {
        const cx = node.x - NR * 0.68;
        const cy = node.y - NR * 0.68;
        ctx.beginPath();
        ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.fillStyle = "#FF6B35";
        ctx.fill();
        ctx.strokeStyle = "#0B1120";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = `bold 8px ${FONT}`;
        ctx.fillStyle = "#0B1120";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("C", cx, cy + 0.5);
      }

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

    ctx.restore();
  }, [nodes, conns, clusters, hoveredNode, hoveredEdge, hoveredConn, hoveredCluster, editingClusterName, linking, linkCursor, canvasW, canvasH, zoom, pan]);

  // ── GitHub URL validation ────────────────────────────────────────────────

  function handleConnectGitHub() {
    if (!githubRepo.trim()) {
      setGithubUrlError("Please enter a GitHub repository URL");
      setGithubUrlValid(false);
      return;
    }
    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/.test(githubRepo.trim())) {
      setGithubUrlError("Please enter a valid GitHub repo URL (https://github.com/user/repo)");
      setGithubUrlValid(false);
      return;
    }
    setGithubUrlError(null);
    setGithubUrlValid(true);
  }

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

  function clusterHandleAt(x: number, y: number): { cluster: Cluster; handle: "n" | "s" | "e" | "w" } | null {
    const hitR = Math.max(12, 12 / zoomRef.current);
    for (let i = clustersRef.current.length - 1; i >= 0; i--) {
      const c = clustersRef.current[i];
      const handles = [
        { handle: "n" as const, hx: c.x,        hy: c.y - c.ry },
        { handle: "s" as const, hx: c.x,        hy: c.y + c.ry },
        { handle: "e" as const, hx: c.x + c.rx, hy: c.y        },
        { handle: "w" as const, hx: c.x - c.rx, hy: c.y        },
      ];
      for (const h of handles) {
        if (dist2(x, y, h.hx, h.hy) <= hitR) return { cluster: c, handle: h.handle };
      }
    }
    return null;
  }

  function clusterBodyAt(x: number, y: number): Cluster | null {
    for (let i = clustersRef.current.length - 1; i >= 0; i--) {
      if (isInsideEllipse(x, y, clustersRef.current[i])) return clustersRef.current[i];
    }
    return null;
  }

  function clusterLabelAt(x: number, y: number): Cluster | null {
    for (let i = clustersRef.current.length - 1; i >= 0; i--) {
      const c = clustersRef.current[i];
      const labelY = c.y - c.ry + 22;
      if (Math.abs(x - c.x) <= 65 && Math.abs(y - labelY) <= 14) return c;
    }
    return null;
  }

  // ── Mouse handlers ───────────────────────────────────────────────────────

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return;

    if (contextMenu) {
      setContextMenu(null);
      return;
    }

    if (editingClusterName) {
      setEditingClusterName(null);
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

    // Nodes take priority over clusters
    const node = nodeAt(pos.x, pos.y);
    if (node) {
      draggingRef.current = { nodeId: node.id, ox: pos.x - node.x, oy: pos.y - node.y };
      return;
    }

    // Cluster resize handle
    const handleHit = clusterHandleAt(pos.x, pos.y);
    if (handleHit) {
      resizingClusterRef.current = { clusterId: handleHit.cluster.id, handle: handleHit.handle };
      return;
    }

    // Cluster label → edit name
    const labelCluster = clusterLabelAt(pos.x, pos.y);
    if (labelCluster) {
      setEditingClusterName(labelCluster.id);
      return;
    }

    // Cluster body drag
    const cluster = clusterBodyAt(pos.x, pos.y);
    if (cluster) {
      draggingClusterRef.current = {
        clusterId: cluster.id,
        ox: pos.x - cluster.x,
        oy: pos.y - cluster.y,
        prevX: cluster.x,
        prevY: cluster.y,
      };
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const pos = getPos(e);

    if (draggingRef.current) {
      const { nodeId, ox, oy } = draggingRef.current;
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, x: pos.x - ox, y: pos.y - oy } : n)),
      );
      return;
    }

    if (resizingClusterRef.current) {
      const { clusterId, handle } = resizingClusterRef.current;
      const MIN = 70;
      setClusters((prev) => prev.map((c) => {
        if (c.id !== clusterId) return c;
        switch (handle) {
          case "n": return { ...c, ry: Math.max(MIN, c.y - pos.y) };
          case "s": return { ...c, ry: Math.max(MIN, pos.y - c.y) };
          case "e": return { ...c, rx: Math.max(MIN, pos.x - c.x) };
          case "w": return { ...c, rx: Math.max(MIN, c.x - pos.x) };
        }
      }));
      return;
    }

    if (draggingClusterRef.current) {
      const { clusterId, ox, oy, prevX, prevY } = draggingClusterRef.current;
      const newX = pos.x - ox;
      const newY = pos.y - oy;
      const dx = newX - prevX;
      const dy = newY - prevY;
      setClusters((prev) => prev.map((c) =>
        c.id === clusterId ? { ...c, x: newX, y: newY } : c,
      ));
      setNodes((prev) => prev.map((n) =>
        n.clusterId === clusterId ? { ...n, x: n.x + dx, y: n.y + dy } : n,
      ));
      draggingClusterRef.current.prevX = newX;
      draggingClusterRef.current.prevY = newY;
      return;
    }

    setLinkCursor(pos);

    const node = nodeAt(pos.x, pos.y);
    setHoveredNode(node?.id ?? null);

    if (node) {
      setHoveredEdge(null);
      setHoveredConn(null);
      setHoveredCluster(null);
    } else {
      if (!linkingRef.current) {
        setHoveredEdge(edgeNodeAt(pos.x, pos.y)?.id ?? null);
      }
      setHoveredConn(connAt(pos.x, pos.y)?.id ?? null);
      const hc = clusterHandleAt(pos.x, pos.y)?.cluster ?? clusterBodyAt(pos.x, pos.y);
      setHoveredCluster(hc?.id ?? null);
    }
  }

  function handleMouseUp() {
    // Assign dragged node to cluster on drop
    if (draggingRef.current) {
      const nodeId = draggingRef.current.nodeId;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (node) {
        let foundId: string | undefined;
        for (const c of clustersRef.current) {
          if (isInsideEllipse(node.x, node.y, c)) { foundId = c.id; break; }
        }
        if (node.clusterId !== foundId) {
          setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, clusterId: foundId } : n));
        }
      }
    }
    draggingRef.current = null;
    draggingClusterRef.current = null;
    resizingClusterRef.current = null;
  }

  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const pos = getPos(e);
    const node = nodeAt(pos.x, pos.y);
    if (node) setContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }

  // ── Context menu actions ─────────────────────────────────────────────────

  function setRole(nodeId: string, role: SessionRole) {
    if (role === "Coordinator") {
      // Determine scope: same cluster → agents in that cluster; no cluster → unclastered agents
      const thisNode = nodesRef.current.find((n) => n.id === nodeId);
      const thisCluster = thisNode?.clusterId;
      const targets = nodesRef.current.filter((n) => {
        if (n.id === nodeId) return false;
        if (n.isHuman) return false;
        if (n.role === "Observer" || n.role === "Coordinator") return false;
        if (thisCluster) return n.clusterId === thisCluster;
        return !n.clusterId;
      });
      setConns((prev) => {
        const next = [...prev];
        for (const t of targets) {
          const alreadyLinked = next.some(
            (c) =>
              (c.fromId === nodeId && c.toId === t.id) ||
              (c.fromId === t.id && c.toId === nodeId),
          );
          if (!alreadyLinked) {
            next.push({ id: `${nodeId}-${t.id}`, fromId: nodeId, toId: t.id });
          }
        }
        return next;
      });
    } else {
      // If node was a Coordinator being demoted, remove its auto-edges
      const wasCoordinator = nodesRef.current.find((n) => n.id === nodeId)?.role === "Coordinator";
      if (wasCoordinator) {
        setConns((prev) => prev.filter((c) => c.fromId !== nodeId && c.toId !== nodeId));
      }
    }
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

  function toggleBuilder(nodeId: string) {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, isBuilder: !n.isBuilder } : n));
    setContextMenu(null);
  }

  function removeFromCluster(nodeId: string) {
    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, clusterId: undefined } : n));
    setContextMenu(null);
  }

  // ── Team template save/load ─────────────────────────────────────────────

  async function saveTemplate() {
    if (!templateName.trim()) return;
    setTemplateSaving(true);
    setTemplateSaveError(null);
    try {
      const allTemplateAgents = nodesRef.current.map((n) => ({
        slug: n.isHuman ? "human-owner" : n.agent.id,
        role: n.role,
        cluster_id: n.clusterId ?? null,
        node_id: n.id,
        is_builder: n.isBuilder ?? false,
        x: n.x,
        y: n.y,
        ...(n.isHuman ? { is_human: true } : {}),
      }));
      const body = {
        name: templateName.trim(),
        description: templateDesc.trim() || null,
        agents: allTemplateAgents,
        edges: connsRef.current.map((c) => ({ from: c.fromId, to: c.toId })),
        clusters: clustersRef.current.map((c) => ({
          id: c.id, name: c.name, color: c.color,
          x: c.x, y: c.y, rx: c.rx, ry: c.ry, subTask: c.subTask,
        })),
      };
      const res = await apiFetch("/team-templates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed to save template");
      setShowSaveTemplateModal(false);
      setTemplateName("");
      setTemplateDesc("");
    } catch (e) {
      setTemplateSaveError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function loadTemplatesList() {
    setTemplatesLoading(true);
    try {
      const res = await apiFetch("/team-templates");
      if (res.ok) setSavedTemplates(await res.json());
    } catch { /* ignore */ }
    setTemplatesLoading(false);
  }

  function applyTemplate(template: TeamTemplate) {
    const newNodes: CanvasNode[] = [];
    const margin = 120;
    for (const ta of template.agents) {
      if (ta.is_human) {
        // Restore the human node at its saved position (or a default)
        const x = ta.x ?? margin + Math.random() * 600;
        const y = ta.y ?? margin + Math.random() * 400;
        // Use saved node_id so edges that reference the human still resolve correctly
        const humanId = ta.node_id ?? "node-human-owner";
        newNodes.push({ id: humanId, x, y, agent: HUMAN_STUB, role: "Requester", isHuman: true });
        continue;
      }
      const agent = allAgents.find((a) => a.id === ta.slug);
      if (!agent) {
        console.warn(`[applyTemplate] agent slug "${ta.slug}" not found in allAgents — node skipped`);
        continue;
      }
      // Use stored node_id so saved edges still reference valid IDs.
      // Fall back to a new ID for templates saved before node_id was added.
      const existingCount = newNodes.filter((n) => n.agent.id === agent.id).length;
      const id = ta.node_id ?? (existingCount === 0 ? `node-${agent.id}` : `node-${agent.id}-${existingCount}`);
      const x = ta.x ?? margin + Math.random() * 600;
      const y = ta.y ?? margin + Math.random() * 400;
      newNodes.push({ id, x, y, agent, role: ta.role, clusterId: ta.cluster_id ?? undefined, isBuilder: ta.is_builder ?? false });
    }
    // Only restore edges where both endpoints were successfully loaded.
    const nodeIdSet = new Set(newNodes.map((n) => n.id));
    const newConns: Conn[] = template.edges
      .filter((e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to))
      .map((e, i) => ({ id: `tconn-${i}-${Date.now()}`, fromId: e.from, toId: e.to }));
    const newClusters: Cluster[] = template.clusters.map((c) => ({ ...c, subTask: c.subTask ?? "" }));
    setNodes(newNodes);
    setConns(newConns);
    setClusters(newClusters);
    setShowLoadTemplateModal(false);
  }

  async function deleteTemplate(id: string) {
    await apiFetch(`/team-templates/${id}`, { method: "DELETE" });
    setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  // Load template from ?template= query param (runs after allAgents and applyTemplate are available)
  const templateLoadedRef = useRef(false);
  useEffect(() => {
    if (allAgents.length === 0 || templateLoadedRef.current) return;
    const templateId = searchParams.get("template");
    if (!templateId) return;
    templateLoadedRef.current = true;
    apiFetch(`/team-templates/${templateId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((t: TeamTemplate | null) => { if (t) applyTemplate(t); })
      .catch(() => {});
  }, [allAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load canvas from ?continue_from= query param (runs after allAgents loads)
  useEffect(() => {
    if (allAgents.length === 0 || continueFromLoadedRef.current) return;
    const continueFromParam = searchParams.get("continue_from");
    if (!continueFromParam) return;
    continueFromLoadedRef.current = true;
    setContinueFromId(continueFromParam);
    fetchMySessionDetail(continueFromParam).then((detail) => {
      if (!detail?.session_graph?.agents) return;
      // Pre-fill GitHub repo from the previous session
      if (detail.github_repo_url) setGithubRepo(detail.github_repo_url);
      const sg = detail.session_graph;
      const newNodes: CanvasNode[] = [];
      const oldToNew = new Map<string, string>();
      const margin = 120;
      let col = 0;
      for (const agentNode of sg.agents) {
        if (agentNode.is_human) {
          const newId = "node-human-owner";
          oldToNew.set(agentNode.id, newId);
          newNodes.push({ id: newId, x: margin + col * 180, y: margin + 300, agent: HUMAN_STUB, role: "Requester", isHuman: true });
          col++;
          continue;
        }
        const rawId = agentNode.id.startsWith("node-") ? agentNode.id.slice(5) : agentNode.id;
        const found = allAgents.find((a) => a.id === rawId || a.name === agentNode.name);
        if (!found) continue;
        const existingCount = newNodes.filter((n) => !n.isHuman && n.agent.id === found.id).length;
        const newId = existingCount === 0 ? `node-${found.id}` : `node-${found.id}-${existingCount}`;
        oldToNew.set(agentNode.id, newId);
        const x = margin + (col % 4) * 200;
        const y = margin + Math.floor(col / 4) * 180;
        newNodes.push({ id: newId, x, y, agent: found, role: agentNode.role as SessionRole, isBuilder: agentNode.is_builder ?? false, clusterId: agentNode.clusterId ?? undefined });
        col++;
      }
      // The human node is never stored in the backend session_graph, so always re-add it.
      if (!newNodes.some((n) => n.isHuman)) {
        const humanX = margin + (col % 4) * 200;
        const humanY = margin + 300;
        newNodes.push({ id: "node-human-owner", x: humanX, y: humanY, agent: HUMAN_STUB, role: "Requester", isHuman: true });
      }
      const nodeIdSet = new Set(newNodes.map((n) => n.id));
      const newConns: Conn[] = (sg.edges ?? [])
        .flatMap((e, i) => {
          const f = oldToNew.get(e.from);
          const t = oldToNew.get(e.to);
          if (!f || !t || !nodeIdSet.has(f) || !nodeIdSet.has(t)) return [];
          return [{ id: `cfconn-${i}-${Date.now()}`, fromId: f, toId: t }];
        });
      const newClusters: Cluster[] = (sg.clusters ?? []).map((c) => ({ ...c, subTask: c.subTask ?? "" }));
      setNodes(newNodes);
      setConns(newConns);
      setClusters(newClusters);
    }).catch(() => {});
  }, [allAgents]); // eslint-disable-line react-hooks/exhaustive-deps

  function linkToAll(nodeId: string) {
    setConns((prev) => {
      const next = [...prev];
      for (const n of nodesRef.current) {
        if (n.id === nodeId) continue;
        const alreadyLinked = next.some(
          (c) =>
            (c.fromId === nodeId && c.toId === n.id) ||
            (c.fromId === n.id && c.toId === nodeId),
        );
        if (!alreadyLinked) {
          next.push({ id: `${nodeId}-${n.id}-${Date.now()}`, fromId: nodeId, toId: n.id });
        }
      }
      return next;
    });
    setContextMenu(null);
  }

  // ── Cluster creation ─────────────────────────────────────────────────────

  function createCluster() {
    const idx = clustersRef.current.length;
    const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
    const name = CLUSTER_NAMES[idx] ?? `Team ${idx + 1}`;
    const cx = (-panRef.current.x + canvasW / 2) / zoomRef.current + (Math.random() - 0.5) * 160;
    const cy = (-panRef.current.y + canvasH / 2) / zoomRef.current + (Math.random() - 0.5) * 80;
    setClusters((prev) => [
      ...prev,
      { id: `cluster-${Date.now()}`, name, x: cx, y: cy, rx: 155, ry: 115, color, subTask: "" },
    ]);
  }

  // ── Agent picker ─────────────────────────────────────────────────────────

  function addAgent(agent: Agent) {
    const margin = 120 / zoomRef.current;
    const worldXMin = -panRef.current.x / zoomRef.current + margin;
    const worldXMax = (canvasW - panRef.current.x) / zoomRef.current - margin;
    const worldYMin = -panRef.current.y / zoomRef.current + margin;
    const worldYMax = (canvasH - panRef.current.y) / zoomRef.current - margin;
    const x = worldXMin + Math.random() * Math.max(1, worldXMax - worldXMin);
    const y = worldYMin + Math.random() * Math.max(1, worldYMax - worldYMin);
    setNodes((prev) => [
      ...prev,
      { id: `node-${agent.id}-${Date.now()}`, x, y, agent, role: "Contributor" },
    ]);
    setShowPicker(false);
    setPickerSearch("");

    const fee = agentSessionFee(agent.reputationTech, agent.reputationRel);
    const msgRate = agentCostPerMessage(agent.reputationTech, agent.reputationRel);
    setAgentAddedToast(`Agent added · ${fee} ALC session fee + ${msgRate} ALC/msg`);
    if (agentAddedToastTimer.current) clearTimeout(agentAddedToastTimer.current);
    agentAddedToastTimer.current = setTimeout(() => setAgentAddedToast(null), 2500);
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

  // ── File upload handlers ─────────────────────────────────────────────────

  const handleFiles = useCallback((files: FileList) => {
    const incoming = Array.from(files);
    setUploadedFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !names.has(f.name))];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  // ── Zoom helpers ─────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = containerRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvasRef.current!.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(3, Math.max(0.3, zoomRef.current * factor));
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

  // ── Open Session ─────────────────────────────────────────────────────────

  function computeSessionCost(): number {
    const billable = nodes.filter((n) => !n.isHuman);
    const fixedCosts = billable.reduce((s, n) => s + agentSessionFee(n.agent.reputationTech, n.agent.reputationRel), 0);
    const variableCosts = billable.reduce((s, n) => s + agentCostPerMessage(n.agent.reputationTech, n.agent.reputationRel) * (maxRevisions + 1), 0);
    const maximum = fixedCosts + variableCosts;
    const fee = Math.round(maximum * 0.03 * 10) / 10;
    return Math.round((maximum + fee) * 10) / 10;
  }

  function openSession() {
    if (!canOpen || openLoading) return;
    setShowCostModal(true);
  }

  async function doOpenSession() {
    setOpenLoading(true);
    setOpenError(null);
    try {
      const nonHumanNodes = nodes.filter((n) => n.agent.id !== "human-owner");
      const agentANode = nonHumanNodes[0];
      const agentBNode = nonHumanNodes[1];

      if (!agentANode || !agentBNode) {
        setOpenError("Please add at least 2 AI agents to the session");
        setOpenLoading(false);
        return;
      }

      const agentAId = agentANode.agent.id;
      const agentBId = agentBNode.agent.id;

      const contractRes = await apiFetch("/rooms/contracts", {
        method: "POST",
        body: JSON.stringify({
          task_description: task,
          deliverable_spec: criteria,
          agent_a_id: agentAId,
          agent_b_id: agentBId,
          max_revision_rounds: maxRevisions,
          timeout_hours: parseTimeoutHours(sessionTimeout),
        }),
      });
      if (!contractRes.ok) throw new Error(`Failed to create contract (${contractRes.status})`);
      const { contract_id } = await contractRes.json();

      const signA = await apiFetch(`/rooms/contracts/${contract_id}/sign?side=a`, {
        method: "POST",
        body: JSON.stringify({ owner_id: OWNER_A }),
      });
      if (!signA.ok) throw new Error(`Failed to sign contract side A (${signA.status})`);

      const signB = await apiFetch(`/rooms/contracts/${contract_id}/sign?side=b`, {
        method: "POST",
        body: JSON.stringify({ owner_id: OWNER_B }),
      });
      if (!signB.ok) throw new Error(`Failed to sign contract side B (${signB.status})`);

      const continueFromParam = searchParams.get("continue_from");
      const roomParams = new URLSearchParams({
        contract_id,
        agent_a_id: agentAId,
        agent_b_id: agentBId,
        ...(githubRepo.trim() ? { github_repo_url: githubRepo.trim() } : {}),
        ...(continueFromParam ? { continue_from_room_id: continueFromParam } : {}),
      });
      const roomRes = await apiFetch(`/rooms?${roomParams.toString()}`, { method: "POST" });
      if (!roomRes.ok) {
        const errBody = await roomRes.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to open room (${roomRes.status})`);
      }
      const { room_id } = await roomRes.json();

      const rateMap: Record<string, number> = {};
      const msgRateMap: Record<string, number> = {};
      nodes.forEach((n) => {
        rateMap[n.id] = agentSessionFee(n.agent.reputationTech, n.agent.reputationRel);
        msgRateMap[n.id] = agentCostPerMessage(n.agent.reputationTech, n.agent.reputationRel);
      });

      const allFileNames = [
        ...uploadedFiles.map((f) => f.name),
        ...restoredFileNames.filter((n) => !uploadedFiles.find((f) => f.name === n)),
      ];

      sessionStorage.setItem(
        "agentlink_session_graph",
        JSON.stringify({
          sessionCost: computeSessionCost(),
          agentRates: rateMap,
          agentMsgRates: msgRateMap,
          maxRevisionRounds: maxRevisions,
          githubRepo: githubRepo || undefined,
          attachedFileNames: allFileNames.length > 0 ? allFileNames : undefined,
          nodes: nodes.map((n) => ({
            id: n.id,
            agentId: n.agent.id,
            agentName: n.agent.name,
            role: n.role,
            label: n.agent.name,
            x: n.x,
            y: n.y,
            isHuman: n.isHuman ?? false,
            clusterId: n.clusterId ?? null,
            isBuilder: n.isBuilder ?? false,
          })),
          edges: conns.map((c) => ({ a: c.fromId, b: c.toId })),
          clusters: clusters.map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            subTask: c.subTask,
            x: c.x,
            y: c.y,
            rx: c.rx,
            ry: c.ry,
            agentIds: nodes.filter((n) => n.clusterId === c.id).map((n) => n.id),
            builderIds: nodes.filter((n) => n.clusterId === c.id && n.isBuilder).map((n) => n.id),
          })),
        }),
      );

      // Register session graph with backend before navigating — coordinator/generate depends on it.
      const sgRes = await apiFetch(`/rooms/${room_id}/session-graph`, {
        method: "POST",
        body: JSON.stringify({
          agents: nodes.filter((n) => !n.isHuman).map((n) => ({
            id: n.id,
            name: n.agent.name,
            role: n.role,
            is_human: false,
            cluster_id: n.clusterId ?? null,
            is_builder: n.isBuilder ?? false,
          })),
          edges: conns.map((c) => ({ from: c.fromId, to: c.toId })),
          thinking_timeout_secs: 60,
        }),
      });
      if (!sgRes.ok) throw new Error(`Failed to register session graph (${sgRes.status})`);

      router.push(`/session/${room_id}`);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : "Unexpected error");
      setOpenLoading(false);
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setLinking(null);
        setLinkCursor(null);
        setContextMenu(null);
        setShowPicker(false);
        setEditingClusterName(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Cursor ───────────────────────────────────────────────────────────────

  let cursor = "default";
  if (draggingRef.current) cursor = "grabbing";
  else if (resizingClusterRef.current) cursor = "nwse-resize";
  else if (draggingClusterRef.current) cursor = "grabbing";
  else if (linking) cursor = "crosshair";
  else if (hoveredNode) cursor = "grab";
  else if (hoveredEdge) cursor = "crosshair";
  else if (hoveredConn) cursor = "pointer";
  else if (hoveredCluster) cursor = "grab";

  // ── Picker agents ────────────────────────────────────────────────────────

  const pickerAgents = allAgents.filter((a) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.skills.some((s) => s.toLowerCase().includes(q))
    );
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const canOpen = nodes.length >= 2;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-al-bg text-al-text">
      {/* Navbar */}
      <header className="sticky top-0 z-30 bg-al-bg/90 backdrop-blur border-b border-al-border">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            href="/new-session"
            className="flex items-center gap-1.5 text-sm text-al-muted-2 hover:text-al-text transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth={1.5} d="M10 3L4 8l6 5" />
            </svg>
            New Session
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30">
              <span className="text-base leading-none">💰</span>
              <span className="text-sm font-semibold text-amber-400 tabular-nums">{balance} ALC</span>
            </div>
            <button
              onClick={() => { setShowSaveTemplateModal(true); setTemplateSaveError(null); }}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-al-border text-al-muted hover:text-al-text hover:border-al-accent/50 transition-colors"
              title="Save team as template"
            >
              Save Template
            </button>
            <button
              onClick={() => { setShowLoadTemplateModal(true); loadTemplatesList(); }}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-al-border text-al-muted hover:text-al-text hover:border-al-accent/50 transition-colors"
              title="Load a saved team template"
            >
              Load Template
            </button>
            <button
            disabled={!canOpen || openLoading}
            onClick={openSession}
            className={`
              px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center gap-2
              ${canOpen && !openLoading
                ? "bg-al-accent text-al-bg hover:bg-al-accent-dim active:scale-[0.98]"
                : "bg-al-surface border border-al-border text-al-muted cursor-not-allowed"
              }
            `}
          >
            {openLoading && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 16 16">
                <circle className="opacity-25" cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
                <path className="opacity-75" fill="currentColor" d="M14 8a6 6 0 0 0-6-6V0a8 8 0 0 1 8 8h-2z" />
              </svg>
            )}
            Open Session
          </button>
          </div>
        </div>
      </header>

      {/* Continue session banner */}
      {continueFromId && (
        <div style={{
          background: "rgba(78,205,196,0.08)",
          borderBottom: "1px solid rgba(78,205,196,0.3)",
          padding: "10px 24px",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, color: "#4ECDC4",
        }}>
          <span style={{ fontSize: 16 }}>↻</span>
          <span>
            <strong>Continuing from session #{continueFromId.slice(0, 8)}</strong>
            {" — agents will have full context of previous work"}
          </span>
        </div>
      )}

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

      {/* Attachments & References */}
      <div className="border-b border-al-border bg-al-surface flex-shrink-0">
        <button
          type="button"
          onClick={() => setAttachmentsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-al-muted hover:text-al-text transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <span>📎</span>
            <span>Attachments &amp; References</span>
            {(uploadedFiles.length > 0 || restoredFileNames.length > 0 || githubRepo) && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-al-accent/15 text-al-accent text-[10px] font-semibold">
                {uploadedFiles.length + restoredFileNames.filter((n) => !uploadedFiles.find((f) => f.name === n)).length + (githubRepo ? 1 : 0)}
              </span>
            )}
          </span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${attachmentsOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 14 14" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeWidth={1.5} d="M3 5l4 4 4-4" />
          </svg>
        </button>

        {attachmentsOpen && (
          <div className="px-4 pb-3 space-y-3">
            {/* File upload */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg px-4 py-3 text-center cursor-pointer transition-colors
                ${isDragging
                  ? "border-al-accent bg-al-accent/5"
                  : "border-al-border hover:border-al-muted bg-al-bg"}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
              />
              <p className="text-xs text-al-muted pointer-events-none">
                Drop files here or <span className="text-al-accent">click to upload</span>
                <span className="ml-1 text-[10px]">· PDF, Excel, CSV, images, code, ZIP</span>
              </p>
            </div>

            {/* File chips */}
            {(uploadedFiles.length > 0 || restoredFileNames.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {uploadedFiles.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-center gap-1 px-2 py-0.5 bg-al-bg border border-al-border rounded text-[11px] text-al-muted-2"
                  >
                    <span className="max-w-[160px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setUploadedFiles((prev) => prev.filter((x) => x.name !== f.name)); }}
                      className="text-al-muted hover:text-red-400 transition-colors ml-0.5"
                    >×</button>
                  </div>
                ))}
                {restoredFileNames
                  .filter((n) => !uploadedFiles.find((f) => f.name === n))
                  .map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-1 px-2 py-0.5 bg-amber-400/5 border border-amber-400/25 rounded text-[11px] text-amber-400/70"
                      title="Re-upload to attach actual file"
                    >
                      <span className="max-w-[140px] truncate">{name}</span>
                      <span className="text-[9px] ml-0.5 opacity-60">re-upload</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRestoredFileNames((prev) => prev.filter((n) => n !== name)); }}
                        className="text-amber-400/50 hover:text-red-400 transition-colors ml-0.5"
                      >×</button>
                    </div>
                  ))}
              </div>
            )}

            {/* GitHub repo */}
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <input
                  value={githubRepo}
                  onChange={(e) => {
                    setGithubRepo(e.target.value);
                    setGithubUrlValid(false);
                    setGithubUrlError(null);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleConnectGitHub(); }}
                  placeholder="🔗 Link a GitHub repo (optional) — https://github.com/user/repo"
                  className="flex-1 bg-al-bg rounded-lg px-3 py-2 text-xs text-al-text placeholder:text-al-muted focus:outline-none transition-colors"
                  style={{
                    border: `1px solid ${githubUrlValid ? "rgba(34,197,94,0.6)" : githubUrlError ? "rgba(239,68,68,0.5)" : "var(--color-al-border, #1E2D4A)"}`,
                  }}
                />
                <button
                  type="button"
                  onClick={handleConnectGitHub}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
                  style={{
                    color: githubUrlValid ? "#22C55E" : "var(--color-al-muted-2, #94A3B8)",
                    borderColor: githubUrlValid ? "rgba(34,197,94,0.4)" : "var(--color-al-border, #1E2D4A)",
                    background: githubUrlValid ? "rgba(34,197,94,0.08)" : "transparent",
                  }}
                >
                  {githubUrlValid ? "✓ Connected" : "Connect"}
                </button>
              </div>
              {githubUrlError && (
                <p className="text-xs text-red-400 mt-0.5">{githubUrlError}</p>
              )}
              {githubUrlValid && (
                <p className="text-xs text-green-400 mt-0.5">Repository URL saved — agents will read this repo and commit work to a new branch: <span className="font-mono">agentlink/session-&lt;id&gt;</span>. You can merge to main after the session.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Canvas area ── */}
        <div
          className="flex-1 relative overflow-hidden"
          ref={containerRef}
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleContextMenu}
        >
          <canvas
            ref={canvasRef}
            style={{ display: "block", pointerEvents: "none" }}
          />

          {/* Cluster name editing input overlay */}
          {editingClusterName && (() => {
            const cluster = clusters.find((c) => c.id === editingClusterName);
            if (!cluster) return null;
            const sx = cluster.x * zoom + pan.x;
            const sy = (cluster.y - cluster.ry + 22) * zoom + pan.y;
            return (
              <input
                autoFocus
                value={cluster.name}
                onChange={(e) =>
                  setClusters((prev) =>
                    prev.map((c) => c.id === editingClusterName ? { ...c, name: e.target.value } : c),
                  )
                }
                onBlur={() => setEditingClusterName(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: sx,
                  top: sy,
                  transform: "translate(-50%, -50%)",
                  width: `${Math.max(110, 130 * zoom)}px`,
                  fontSize: `${Math.round(Math.max(11, 13 * zoom))}px`,
                }}
                className="bg-al-surface border border-al-accent rounded-md px-2 py-0.5 text-al-accent font-semibold text-center focus:outline-none z-50 pointer-events-auto"
              />
            );
          })()}

          {/* Empty state */}
          {nodes.length === 0 && clusters.length === 0 && (
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

          {/* Bottom bar: controls + zoom */}
          <div className="absolute bottom-2 left-2 flex items-center gap-2 z-10">
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
            <button
              onClick={createCluster}
              className="flex items-center gap-2 px-3.5 py-2 bg-al-surface border border-al-border rounded-xl text-sm text-al-text hover:border-al-accent/60 hover:text-al-accent transition-all shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <ellipse cx="8" cy="8" rx="6" ry="4" strokeWidth="1.5" />
                <path strokeLinecap="round" strokeWidth={1.5} d="M8 5v6M5 8h6" />
              </svg>
              Create team
            </button>
            <div className="ml-2 flex items-center gap-0.5 bg-al-surface border border-al-border rounded-xl shadow-lg px-1.5 py-1">
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
          </div>

          {/* Context menu */}
          {contextMenu && (() => {
            const node = nodes.find((n) => n.id === contextMenu.nodeId);
            if (!node) return null;
            return (
              <div
                className="fixed z-50 bg-al-surface border border-al-border rounded-xl shadow-2xl py-1 min-w-[172px]"
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
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-al-border/30"
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
                  {/* Builder toggle */}
                  <button
                    onClick={() => toggleBuilder(contextMenu.nodeId)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-al-text hover:bg-al-border/30 transition-colors"
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-[#F59E0B] text-[#0B1120] text-[8px] font-bold flex items-center justify-center flex-shrink-0">
                      B
                    </span>
                    <span className={node.isBuilder ? "text-[#F59E0B]" : "text-al-text"}>
                      {node.isBuilder ? "Remove Builder" : "Set as Builder"}
                    </span>
                    {node.isBuilder && (
                      <svg className="w-3 h-3 ml-auto text-[#F59E0B]" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                        <path strokeLinecap="round" strokeWidth={1.5} d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </button>
                  {/* Remove from team */}
                  {node.clusterId && (
                    <button
                      onClick={() => removeFromCluster(contextMenu.nodeId)}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-al-text hover:bg-al-border/30 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 text-al-muted flex-shrink-0" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                        <circle cx="7" cy="7" r="5" strokeWidth="1.5" />
                        <path d="M4 7h6" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      Remove from team
                    </button>
                  )}
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
                    onClick={() => linkToAll(contextMenu.nodeId)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-al-text hover:bg-al-border/30 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-al-muted flex-shrink-0" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                      <circle cx="7" cy="7" r="2" strokeWidth="1.5" />
                      <path d="M7 1v2M7 11v2M1 7h2M11 7h2" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    Link to all →
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

          {/* Agent picker modal */}
          {showPicker && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-40"
              onMouseDown={() => { setShowPicker(false); setPickerSearch(""); }}
            >
              <div
                className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-[440px] max-h-[540px] flex flex-col"
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
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
                  {pickerAgents.length === 0 ? (
                    <p className="text-xs text-al-muted text-center py-8">
                      No agents match your search
                    </p>
                  ) : (
                    pickerAgents.map((agent) => {
                      const fee = agentSessionFee(agent.reputationTech, agent.reputationRel);
                      const cpm = agentCostPerMessage(agent.reputationTech, agent.reputationRel);
                      const rep = agent.reputationTech;
                      const stars = rep !== null ? Math.round(rep) : null;
                      const fwColor = frameworkColor(agent.framework);
                      return (
                        <div
                          key={agent.id}
                          className="flex gap-3 p-3 rounded-xl border border-al-border/60 hover:border-al-accent/30 hover:bg-al-bg/60 transition-colors"
                        >
                          <div className="w-10 h-10 rounded-full bg-al-accent/15 border border-al-accent/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-xs font-bold text-al-accent">{initials(agent.name)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 mb-0.5">
                              <span className="text-sm font-semibold text-al-text truncate">{agent.name}</span>
                              <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", background: `${fwColor}26`, color: fwColor, border: `1px solid ${fwColor}40`, flexShrink: 0 }}>{agent.framework}</span>
                            </div>
                            {agent.description && (
                              <p className="text-[11px] text-al-muted leading-snug mb-1.5 line-clamp-1">{agent.description}</p>
                            )}
                            {agent.skills.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-1.5">
                                {agent.skills.slice(0, 4).map((s) => (
                                  <span key={s} className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-al-accent/10 text-al-accent border border-al-accent/20">
                                    {s}
                                  </span>
                                ))}
                                {agent.skills.length > 4 && (
                                  <span className="text-[9px] text-al-muted self-center">+{agent.skills.length - 4}</span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-3 text-[10px] text-al-muted-2">
                              <span>
                                {stars !== null ? "★".repeat(stars) + "☆".repeat(5 - stars) : "—"}{" "}
                                <span className="text-al-muted">{rep !== null ? rep.toFixed(1) : "No rating"}</span>
                              </span>
                              <span className="text-al-border">·</span>
                              <span>{fee} ALC + {cpm} ALC/msg</span>
                            </div>
                          </div>
                          <button
                            onClick={() => addAgent(agent)}
                            className="shrink-0 self-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-al-accent/15 text-al-accent border border-al-accent/30 hover:bg-al-accent/25 transition-colors"
                          >
                            Add
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Contract panel ── */}
        <aside className="w-80 flex-shrink-0 border-l border-al-border flex flex-col overflow-hidden bg-al-surface">
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
                  {rulesExpanded ? "Show less" : `Read more (${AL_RULES.length - 2} more rules)`}
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
                {/* Participants — grouped by cluster */}
                {nodes.length > 0 && (
                  <div className="bg-al-bg border border-al-border rounded-xl p-3">
                    <div className="text-[10px] text-al-muted uppercase tracking-wider mb-2">
                      Participants ({nodes.length})
                    </div>

                    {/* Cluster groups */}
                    {clusters.map((cluster) => {
                      const clusterNodes = nodes.filter((n) => n.clusterId === cluster.id);
                      if (clusterNodes.length === 0) return null;
                      return (
                        <div key={cluster.id} className="mb-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cluster.color }} />
                            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cluster.color }}>
                              {cluster.name}
                            </span>
                          </div>
                          <div className="space-y-1.5 pl-3.5 mb-1.5">
                            {clusterNodes.map((n) => {
                              const rc = n.isHuman ? HUMAN_COLOR : ROLE_COLOR[n.role];
                              return (
                                <div key={n.id} className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div
                                      className={`w-1.5 h-1.5 flex-shrink-0 ${n.isHuman ? "rotate-45" : "rounded-full"}`}
                                      style={{ background: rc }}
                                    />
                                    <span className="text-xs text-al-text truncate">{n.agent.name}</span>
                                    {n.isBuilder && (
                                      <span className="text-[7px] font-bold bg-[#F59E0B] text-[#0B1120] rounded-full w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                                        B
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                                    style={{ color: rc, background: `${rc}18` }}
                                  >
                                    {n.isBuilder ? `${n.role}, Builder` : n.role}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {/* Sub-task per cluster */}
                          <div className="pl-3.5">
                            <input
                              value={cluster.subTask}
                              onChange={(e) =>
                                setClusters((prev) =>
                                  prev.map((c) => c.id === cluster.id ? { ...c, subTask: e.target.value } : c),
                                )
                              }
                              placeholder={`${cluster.name} sub-task…`}
                              className="w-full bg-al-surface border border-al-border rounded-lg px-2.5 py-1 text-[11px] text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Unassigned agents */}
                    {(() => {
                      const unassigned = nodes.filter((n) => !n.clusterId);
                      if (unassigned.length === 0) return null;
                      return (
                        <div className={clusters.some((c) => nodes.some((n) => n.clusterId === c.id)) ? "mt-2 pt-2 border-t border-al-border" : ""}>
                          {clusters.length > 0 && (
                            <div className="text-[10px] text-al-muted uppercase tracking-wider mb-1.5">
                              Unassigned
                            </div>
                          )}
                          <div className="space-y-1.5">
                            {unassigned.map((n) => {
                              const rc = n.isHuman ? HUMAN_COLOR : ROLE_COLOR[n.role];
                              return (
                                <div key={n.id} className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div
                                      className={`w-1.5 h-1.5 flex-shrink-0 ${n.isHuman ? "rotate-45" : "rounded-full"}`}
                                      style={{ background: rc }}
                                    />
                                    <span className="text-xs text-al-text truncate">{n.agent.name}</span>
                                    {n.isBuilder && (
                                      <span className="text-[7px] font-bold bg-[#F59E0B] text-[#0B1120] rounded-full w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                                        B
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                                    style={{ color: rc, background: `${rc}18` }}
                                  >
                                    {n.isBuilder ? `${n.role}, Builder` : n.role}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
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
                          prev.map((c) => c.id === clause.id ? { ...c, value: e.target.value } : c),
                        )
                      }
                      placeholder={`Custom clause ${i + 1}…`}
                      className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-xs text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                    />
                    <button
                      onClick={() => setCustomClauses((prev) => prev.filter((c) => c.id !== clause.id))}
                      className="mt-0.5 w-7 h-7 flex items-center justify-center rounded border border-al-border text-al-muted hover:text-red-400 hover:border-red-400/40 transition-colors flex-shrink-0"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                        <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l8 8M10 2l-8 8" />
                      </svg>
                    </button>
                  </div>
                ))}

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

            {/* § 3 — Session Cost Estimate */}
            {(() => {
              const billableNodes = nodes.filter((n) => !n.isHuman);
              if (billableNodes.length === 0) return null;
              const lineItems = billableNodes.map((n) => ({
                name: n.agent.name,
                sessionFee: agentSessionFee(n.agent.reputationTech, n.agent.reputationRel),
                costPerMsg: agentCostPerMessage(n.agent.reputationTech, n.agent.reputationRel),
              }));
              const fixedTotal = lineItems.reduce((s, l) => s + l.sessionFee, 0);
              const variableTotal = lineItems.reduce((s, l) => s + l.costPerMsg * (maxRevisions + 1), 0);
              const maximum = fixedTotal + variableTotal;
              const alcFee = Math.round(maximum * 0.03 * 10) / 10;
              const grandTotal = Math.round((maximum + alcFee) * 10) / 10;
              return (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-al-muted uppercase tracking-widest">
                      Session Cost Estimate
                    </span>
                    <span className="text-[9px] text-amber-400 bg-amber-400/10 border border-amber-400/25 px-1.5 py-0.5 rounded">
                      ALC
                    </span>
                  </div>
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 overflow-hidden">
                    {/* Fixed costs */}
                    <div className="px-3 pt-2 pb-1">
                      <p className="text-[9px] text-al-muted uppercase tracking-wider mb-1.5">Fixed costs (session fees)</p>
                      <div className="space-y-1">
                        {lineItems.map((item) => (
                          <div key={item.name} className="flex items-center justify-between">
                            <span className="text-[11px] text-al-muted-2 truncate max-w-[160px]">{item.name}</span>
                            <span className="text-[11px] text-al-text tabular-nums">{item.sessionFee} ALC</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between pt-0.5 border-t border-amber-400/10">
                          <span className="text-[11px] text-al-muted">Subtotal</span>
                          <span className="text-[11px] text-al-text tabular-nums">{fixedTotal} ALC</span>
                        </div>
                      </div>
                    </div>
                    {/* Variable costs */}
                    <div className="border-t border-amber-400/10 px-3 pt-2 pb-1">
                      <p className="text-[9px] text-al-muted uppercase tracking-wider mb-1.5">Variable costs ({maxRevisions} work rounds + 1 QA round)</p>
                      <div className="space-y-1">
                        {lineItems.map((item) => (
                          <div key={item.name} className="flex items-center justify-between">
                            <span className="text-[11px] text-al-muted-2 truncate max-w-[130px]">{item.name}</span>
                            <span className="text-[11px] text-al-text tabular-nums">
                              {item.costPerMsg}×{maxRevisions + 1} = {item.costPerMsg * (maxRevisions + 1)} ALC
                            </span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between pt-0.5 border-t border-amber-400/10">
                          <span className="text-[11px] text-al-muted">Subtotal</span>
                          <span className="text-[11px] text-al-text tabular-nums">{variableTotal} ALC</span>
                        </div>
                      </div>
                    </div>
                    {/* Totals */}
                    <div className="border-t border-amber-400/15 px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-al-muted">Maximum possible</span>
                        <span className="text-[11px] text-al-text tabular-nums">{maximum} ALC</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-al-muted">AgentLink fee (3%)</span>
                        <span className="text-[11px] text-al-muted tabular-nums">{alcFee} ALC</span>
                      </div>
                    </div>
                    <div className="border-t border-amber-400/20 px-3 py-2 bg-amber-400/8">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-bold text-amber-400">Total blocked</span>
                        <span className="text-[13px] font-bold text-amber-400 tabular-nums">{grandTotal} ALC</span>
                      </div>
                      <p className="text-[9px] text-al-muted leading-relaxed">
                        Actual cost calculated at session close. Unused funds returned to your balance.
                      </p>
                    </div>
                  </div>
                </section>
              );
            })()}
          </div>

          {/* Open Session */}
          <div className="px-4 py-4 border-t border-al-border flex-shrink-0">
            <button
              disabled={!canOpen || openLoading}
              onClick={openSession}
              className={`
                w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2
                ${canOpen && !openLoading
                  ? "bg-al-accent text-al-bg hover:bg-al-accent-dim active:scale-[0.98] shadow-[0_0_20px_theme(colors.al-accent/25)]"
                  : "bg-al-bg border border-al-border text-al-muted cursor-not-allowed"
                }
              `}
            >
              {openLoading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 16 16">
                  <circle className="opacity-25" cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
                  <path className="opacity-75" fill="currentColor" d="M14 8a6 6 0 0 0-6-6V0a8 8 0 0 1 8 8h-2z" />
                </svg>
              )}
              {openLoading ? "Opening…" : "Open Session"}
            </button>
            {!canOpen && !openLoading && (
              <p className="text-[11px] text-al-muted text-center mt-1.5">
                Add two participants to start a session
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Error toast */}
      {openError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-950 border border-red-500/40 text-red-300 text-sm rounded-xl px-4 py-3 shadow-2xl max-w-md">
          <svg className="w-4 h-4 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 16 16" stroke="currentColor">
            <path strokeLinecap="round" strokeWidth={1.5} d="M8 5v4m0 2.5h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z" />
          </svg>
          <span className="flex-1">{openError}</span>
          <button
            onClick={() => setOpenError(null)}
            className="w-5 h-5 flex items-center justify-center rounded text-red-400 hover:text-red-200 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor">
              <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Agent-added toast */}
      {agentAddedToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-al-surface border border-al-accent/40 text-al-accent text-sm rounded-xl px-4 py-3 shadow-2xl pointer-events-none select-none">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor">
            <path strokeLinecap="round" strokeWidth={1.5} d="M8 3v10M3 8h10" />
          </svg>
          {agentAddedToast}
        </div>
      )}

      {/* Cost confirmation modal */}
      {showCostModal && (
        <CostConfirmModal
          cost={computeSessionCost()}
          balance={balance}
          onConfirm={() => {
            deduct(computeSessionCost());
            setShowCostModal(false);
            doOpenSession();
          }}
          onCancel={() => setShowCostModal(false)}
        />
      )}

      {/* Save Template modal */}
      {showSaveTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-al-border bg-al-surface p-6 flex flex-col gap-4">
            <h2 className="text-base font-bold text-al-text">Save as Team Template</h2>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-al-muted">Template name *</label>
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="My dream team"
                className="bg-al-bg border border-al-border rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-al-muted">Description (optional)</label>
              <textarea
                value={templateDesc}
                onChange={(e) => setTemplateDesc(e.target.value)}
                placeholder="Best team for code review tasks…"
                rows={2}
                className="bg-al-bg border border-al-border rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors resize-none"
              />
            </div>
            {templateSaveError && (
              <p className="text-xs text-red-400">{templateSaveError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowSaveTemplateModal(false); setTemplateName(""); setTemplateDesc(""); }}
                className="flex-1 py-2 rounded-lg text-sm border border-al-border text-al-muted hover:text-al-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveTemplate}
                disabled={!templateName.trim() || templateSaving}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-al-accent text-al-bg hover:bg-al-accent-dim disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {templateSaving ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Template modal */}
      {showLoadTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl border border-al-border bg-al-surface p-6 flex flex-col gap-4 max-h-[80vh]">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-al-text">Load Team Template</h2>
              <button onClick={() => setShowLoadTemplateModal(false)} className="text-al-muted hover:text-al-text transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            {templatesLoading ? (
              <div className="flex items-center justify-center py-8 text-al-muted text-sm">Loading templates…</div>
            ) : savedTemplates.length === 0 ? (
              <p className="text-sm text-al-muted text-center py-8">No saved templates yet. Build a team and click "Save Template".</p>
            ) : (
              <div className="overflow-y-auto flex flex-col gap-2 pr-1">
                {savedTemplates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-start gap-3 p-3 rounded-xl border border-al-border bg-al-bg hover:border-al-accent/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-al-text truncate">{t.name}</p>
                      {t.description && <p className="text-xs text-al-muted mt-0.5 truncate">{t.description}</p>}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-al-muted-2">{t.agents.length} agent{t.agents.length !== 1 ? "s" : ""}</span>
                        <span className="text-[10px] text-al-muted-2">{new Date(t.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => applyTemplate(t)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-al-accent/15 text-al-accent border border-al-accent/30 hover:bg-al-accent/25 transition-colors"
                      >
                        Load →
                      </button>
                      <button
                        onClick={() => deleteTemplate(t.id)}
                        className="px-2 py-1.5 rounded-lg text-xs text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cost Confirmation Modal ─────────────────────────────────────────────────

function CostConfirmModal({
  cost,
  balance,
  onConfirm,
  onCancel,
}: {
  cost: number;
  balance: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const afterBalance = Math.round((balance - cost) * 10) / 10;
  const insufficient = balance < cost;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
        style={{ boxShadow: "0 0 60px rgba(78,205,196,0.08)" }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-400/10 border border-amber-400/30">
            <span className="text-lg leading-none">💰</span>
          </div>
          <h2 className="text-base font-bold text-al-text">Confirm Session Cost</h2>
        </div>

        <div className="space-y-3 mb-5">
          <div className="bg-al-bg border border-al-border rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-al-muted">Maximum blocked</span>
              <span className="text-sm font-bold text-amber-400 tabular-nums">{cost} ALC</span>
            </div>
            <div className="flex items-center justify-between border-t border-al-border pt-2.5">
              <span className="text-xs text-al-muted">Current balance</span>
              <span className="text-sm text-al-text tabular-nums">{balance} ALC</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-al-muted">Balance after block</span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: insufficient ? "#EF4444" : "#4ECDC4" }}
              >
                {insufficient ? "—" : `${afterBalance} ALC`}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-al-muted text-center leading-relaxed">
            Unused funds are returned at session close.
          </p>

          {insufficient && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
              <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                <path strokeLinecap="round" strokeWidth={1.5} d="M8 5v4m0 2.5h.01M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z" />
              </svg>
              <span className="text-xs text-red-400 font-medium">Insufficient credits</span>
            </div>
          )}
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm text-al-muted bg-al-bg border border-al-border hover:border-al-accent/40 hover:text-al-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={insufficient}
            className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: insufficient ? "rgba(78,205,196,0.1)" : "#4ECDC4",
              color: insufficient ? "#4ECDC4" : "#070B14",
            }}
          >
            Confirm &amp; Pay {cost} ALC
          </button>
        </div>
      </div>
    </div>
  );
}
