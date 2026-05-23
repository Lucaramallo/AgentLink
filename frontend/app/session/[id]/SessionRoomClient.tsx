"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { SessionRole } from "../../lib/types";
import { useCredits } from "../../lib/credits";
import { agentDropped, fetchGithubOAuthUrl } from "../../lib/api";
import { useAuth, type AuthUser } from "../../lib/auth";
import PollCard, { type PollType } from "./PollCard";

// ── Constants ──────────────────────────────────────────────────────────────

const API = "http://127.0.0.1:8000/api/v1";
const NR  = 40;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const ROLE_COLOR: Record<SessionRole, string> = {
  Requester:   "#4ECDC4",
  Contributor: "#818CF8",
  Reviewer:    "#F59E0B",
  Observer:    "#64748B",
  Coordinator: "#FF6B35",
};
const HUMAN_COLOR = "#F0A500";

// UI message type labels (superset of backend enum)
type MessageType   = "TASK" | "DELIVERABLE" | "VERIFYING" | "EXIT KEY" | "SYSTEM" | "R1" | "R2" | "R3" | "POLL_EVENT";
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
  POLL_EVENT:  "POLL_EVENT",
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
  POLL_EVENT:  { bg: "rgba(168,85,247,0.12)", text: "#A855F7", border: "rgba(168,85,247,0.35)"  },
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
  /** Set on human messages sent mid-session (while agent loop is running).
   *  Triggers edge-filtered delivery — only agents with a direct edge to
   *  the Human node will see this message in their context. */
  humanDirect?: boolean;
  contentStructured?: Record<string, unknown>;
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

interface PeerReviewData {
  reviews: Array<{
    voter: string;
    voter_id: string;
    voter_role: string;
    scores: Record<string, number | null>;
  }>;
  weighted_averages: Record<string, number | null>;
}

interface ReputationUpdate {
  agent_name: string;
  final_score: number;
  delta: number | null;
  breakdown: {
    peer_review: number;
    human_rating: number;
    messages_contributed: number;
    role_weight: number;
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SessionRoomClient() {
  const { id } = useParams<{ id: string }>();
  const roomId = id ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, loading: authLoading, user, token, login } = useAuth();

  // Detect return from GitHub OAuth redirect (from close-modal step 1 push flow)
  const [pendingGithubResume, setPendingGithubResume] = useState(
    () => searchParams.get("resumeGithubPush") === "1"
  );

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace(`/login?return_url=${encodeURIComponent(`/session/${roomId}`)}`);
    }
  }, [authLoading, isAuthenticated, roomId, router]);

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
  const [outcome, setOutcome]               = useState<"SUCCESS" | "DISPUTED" | "INCOMPLETE" | "CANCELLED" | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);

  // GitHub delivery
  const [githubPushing, setGithubPushing]         = useState(false);
  const [githubPushTimedOut, setGithubPushTimedOut] = useState(false);
  const [githubDeliveryUrl, setGithubDeliveryUrl] = useState<string | null>(null);
  const [githubPushError, setGithubPushError]     = useState<string | null>(null);

  // Agent failure handling
  const [showFailureModal, setShowFailureModal] = useState(false);
  const [failedAgent, setFailedAgent]           = useState<{ id: string; name: string } | null>(null);
  const [droppedAgentIds, setDroppedAgentIds]   = useState<Set<string>>(new Set());
  const pendingRetryRef                         = useRef<(() => Promise<void>) | null>(null);

  // Rating flow (shown before CloseModal after CONFORME)
  const [showRatingScreen, setShowRatingScreen]   = useState(false);
  const [peerReviewLoading, setPeerReviewLoading] = useState(false);
  const [peerReviewData, setPeerReviewData]       = useState<PeerReviewData | null>(null);
  const [teamRating, setTeamRating]               = useState(0);
  const [individualRatings, setIndividualRatings] = useState<Record<string, number>>({});
  const [ratingSubmitting, setRatingSubmitting]   = useState(false);
  const [reputationUpdates, setReputationUpdates] = useState<Record<string, ReputationUpdate> | null>(null);

  // WS
  const wsRef   = useRef<WebSocket | null>(null);
  const [wsOpen, setWsOpen] = useState(false);

  // Attachments from build page
  const [attachedFileNames, setAttachedFileNames] = useState<string[]>([]);
  const [sessionGithubRepo, setSessionGithubRepo] = useState("");
  const fileContextRef = useRef("");

  // Turn order visual state
  type AgentDisplayState = "idle" | "thinking" | "responded" | "skipped";
  const [agentDisplayStates, setAgentDisplayStates] = useState<Record<string, AgentDisplayState>>({});
  const [currentSpeaker, setCurrentSpeaker] = useState<{ name: string; round: string } | null>(null);
  const agentDisplayStatesRef = useRef<Record<string, AgentDisplayState>>({});
  useEffect(() => { agentDisplayStatesRef.current = agentDisplayStates; }, [agentDisplayStates]);

  // Diagram panel visibility
  const [diagramVisible, setDiagramVisible] = useState(true);

  // Animation tick — drives pulsing ring redraws while any agent is THINKING
  const [animTick, setAnimTick] = useState(0);
  const animFrameRef = useRef<number | null>(null);
  useEffect(() => {
    const anyThinking = Object.values(agentDisplayStates).some((s) => s === "thinking");
    if (anyThinking) {
      let running = true;
      const tick = () => {
        if (!running) return;
        setAnimTick((t) => t + 1);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
      return () => {
        running = false;
        if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      };
    }
  }, [agentDisplayStates]);

  // Polls
  const [polls, setPolls] = useState<PollType[]>([]);
  const [humanVotedPollIds, setHumanVotedPollIds] = useState<Set<string>>(new Set());

  // Failure feedback modal (mandatory for non-CONFORME outcomes)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [fbText, setFbText] = useState("");
  const [fbReason, setFbReason] = useState("");
  const [fbAgents, setFbAgents] = useState<string[]>([]);
  const [fbRetry, setFbRetry] = useState<boolean | null>(null);
  const [fbSubmitting, setFbSubmitting] = useState(false);
  const [githubConnectionFailed, setGithubConnectionFailed] = useState(false);

  // Typewriter effect
  const [revealedIds, setRevealedIds]           = useState<Set<string>>(new Set());
  const [typingMessageId, setTypingMessageId]   = useState<string | null>(null);
  const [typedChars, setTypedChars]             = useState(0);
  const typewriterQueue                          = useRef<string[]>([]);
  const processedForTypewriter                   = useRef(new Set<string>());

  // Propose Poll modal
  const [showProposePoll, setShowProposePoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollScope, setPollScope] = useState<"ALL" | "CONTRIBUTORS_ONLY" | "REVIEWERS_ONLY">("ALL");
  const [pollActionType, setPollActionType] = useState<string>("CONSENSUS");
  const [pollDeadline, setPollDeadline] = useState(120);
  const [pollSubmitting, setPollSubmitting] = useState(false);

  // GitHub repo active input
  const [showRepoBranchModal, setShowRepoBranchModal] = useState(false);
  const [repoInitializing, setRepoInitializing] = useState(false);
  const [repoInitialized, setRepoInitialized] = useState(false);
  const [repoBranch, setRepoBranch] = useState("");
  const [repoBranchUrl, setRepoBranchUrl] = useState("");
  const [repoBranchStrategy, setRepoBranchStrategy] = useState<"branch" | "main">("branch");
  const [repoTree, setRepoTree] = useState<Array<{path: string; type: string; size?: number}>>([]);
  const [newlyCommittedFiles, setNewlyCommittedFiles] = useState<Set<string>>(new Set());
  const [repoPanelOpen, setRepoPanelOpen] = useState(false);
  const [repoFileContent, setRepoFileContent] = useState<{path: string; content: string} | null>(null);
  const [repoFileLoading, setRepoFileLoading] = useState(false);
  const [repoMerging, setRepoMerging] = useState(false);
  const [repoMerged, setRepoMerged] = useState(false);
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);

  // Coordinator plan pre-session step
  const [showCoordinatorPlan, setShowCoordinatorPlan] = useState(false);
  const [coordinatorPlan, setCoordinatorPlan] = useState<{
    assignments: Array<{ agent_id: string; agent_name: string; subtask: string }>;
    summary: string;
    coordinator_plans?: Record<string, { assignments: Array<{ agent_id: string; agent_name: string; subtask: string }>; summary: string }>;
  } | null>(null);
  const [coordinatorPlanLoading, setCoordinatorPlanLoading] = useState(false);
  const [editedAssignments, setEditedAssignments] = useState<Array<{ agent_id: string; agent_name: string; subtask: string }>>([]);
  const [confirmingPlan, setConfirmingPlan] = useState(false);
  const [activeCoordinatorTab, setActiveCoordinatorTab] = useState<string | null>(null);
  const coordinatorPlanResolveRef = useRef<(() => void) | null>(null);
  const coordinatorPlanRef = useRef<{ assignments: Array<{ agent_id: string; agent_name: string; subtask: string }>; summary: string } | null>(null);
  const coordinatorPlanDoneRef = useRef(false);
  const coordinatorsForRetryRef = useRef<GraphNode[]>([]);

  // Human always-on messaging (Feature 2/7)
  // True while callDemoAgents is running — used to suppress re-triggering the loop
  const agentLoopRunningRef = useRef(false);
  // True once all rounds have completed — prevents new loops after session finishes
  const sessionCompletedRef = useRef(false);

  // Round voting system (Feature 1)
  const [showVoteBanner, setShowVoteBanner] = useState(false);
  const [voteRoundNumber, setVoteRoundNumber] = useState(0);
  const [voteResults, setVoteResults] = useState<Array<{ voter: string; vote: "yes" | "no" }>>([]);
  const humanVoteResolverRef = useRef<((yes: boolean) => void) | null>(null);

  // Auto-task
  const [taskDescription, setTaskDescription] = useState<string>("");
  const taskDescriptionRef = useRef<string>("");
  const autoTaskSentRef = useRef(false);

  // Demo quota
  const [demoLimitReached, setDemoLimitReached]   = useState(false);
  const [messagesRemaining, setMessagesRemaining] = useState<number | null>(null);

  // Chat tabs
  const [activeTab, setActiveTab]           = useState<string>("all");
  const [unreadClusters, setUnreadClusters] = useState<Set<string>>(new Set());
  const activeTabRef = useRef("all");
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Pause / cancel
  const [isPaused, setIsPaused]           = useState(false);
  const isPausedRef                        = useRef(false);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Stable refs so async callbacks always see latest graph state
  const graphEdgesRef = useRef<GraphEdge[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const repoTreeRef = useRef<Array<{path: string; type: string; size?: number}>>([]);
  const repoInitializedRef = useRef(false);
  const repoBranchRef = useRef("");
  const tokenRef = useRef<string | null | undefined>(null);
  useEffect(() => { graphNodesRef.current = graphNodes; }, [graphNodes]);
  useEffect(() => { graphEdgesRef.current = graphEdges; }, [graphEdges]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { repoTreeRef.current = repoTree; }, [repoTree]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { repoInitializedRef.current = repoInitialized; }, [repoInitialized]);
  useEffect(() => { repoBranchRef.current = repoBranch; }, [repoBranch]);

  // ── Typewriter: enqueue new agent messages & drain queue ──────────────────
  useEffect(() => {
    for (const msg of messages) {
      if (
        !msg.isHuman &&
        msg.agentId !== "system" &&
        msg.type !== "SYSTEM" &&
        !processedForTypewriter.current.has(msg.id)
      ) {
        processedForTypewriter.current.add(msg.id);
        typewriterQueue.current.push(msg.id);
      }
    }
    if (typingMessageId === null && typewriterQueue.current.length > 0) {
      setTypingMessageId(typewriterQueue.current.shift()!);
    }
  }, [messages, typingMessageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Typewriter: animate current message ───────────────────────────────────
  useEffect(() => {
    if (typingMessageId === null) return;
    const msg = messagesRef.current.find((m) => m.id === typingMessageId);
    if (!msg || msg.content.length === 0) {
      setRevealedIds((prev) => new Set([...prev, typingMessageId]));
      setTypingMessageId(null);
      return;
    }
    setTypedChars(0);
    const totalChars = msg.content.length;
    const timer = setInterval(() => {
      setTypedChars((prev) => {
        const next = prev + 26;
        if (next >= totalChars) {
          clearInterval(timer);
          setRevealedIds((rids) => new Set([...rids, typingMessageId]));
          setTypingMessageId(null);
        }
        return next;
      });
    }, 33); // ~600 chars/sec
    return () => clearInterval(timer);
  }, [typingMessageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flag set when we restore from sessionStorage — prevents API from overwriting
  const savedGraphLoadedRef = useRef(false);

  // Agent rates from build page (nodeId → session fee ALC, nodeId → cost per message ALC)
  const [agentRates, setAgentRates] = useState<Record<string, number>>({});
  const [agentMsgRates, setAgentMsgRates] = useState<Record<string, number>>({});
  const [sessionCost, setSessionCost] = useState<number | null>(null);
  const [actualCost, setActualCost] = useState<number | null>(null);
  const [refundAmount, setRefundAmount] = useState<number | null>(null);

  // Configurable rounds (read from sessionStorage, capped at 10)
  const maxRoundsRef = useRef(3);
  // Track how many rounds actually completed
  const roundsCompletedRef = useRef(0);

  const { balance, add } = useCredits();

  // ── Restore session-completed flag across refresh (FIX 4) ───────────────
  useEffect(() => {
    if (roomId && sessionStorage.getItem(`agentlink_session_completed_${roomId}`)) {
      sessionCompletedRef.current = true;
    }
  }, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear session-completed flag when room closes
  useEffect(() => {
    if ((status === "CLOSED_SUCCESS" || status === "CLOSED_DISPUTED") && roomId) {
      sessionStorage.removeItem(`agentlink_session_completed_${roomId}`);
    }
  }, [status, roomId]);

  // ── Restore canvas layout from build page ───────────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem("agentlink_session_graph");
    if (!raw) return;
    sessionStorage.removeItem("agentlink_session_graph");
    try {
      const saved = JSON.parse(raw) as {
        sessionCost?: number;
        agentRates?: Record<string, number>;
        agentMsgRates?: Record<string, number>;
        maxRevisionRounds?: number;
        githubRepo?: string;
        attachedFileNames?: string[];
        fileContext?: string;
        nodes: Array<{ id: string; agentId: string; agentName: string; role: SessionRole; label: string; x: number; y: number; isHuman: boolean; clusterId?: string | null; isBuilder?: boolean }>;
        edges: Array<{ a: string; b: string }>;
        clusters?: Array<{ id: string; name: string; color: string; x: number; y: number; rx: number; ry: number }>;
      };
      if (saved.sessionCost != null) setSessionCost(saved.sessionCost);
      if (saved.agentRates) setAgentRates(saved.agentRates);
      if (saved.agentMsgRates) setAgentMsgRates(saved.agentMsgRates);
      if (saved.githubRepo) setSessionGithubRepo(saved.githubRepo);
      if (saved.attachedFileNames && saved.attachedFileNames.length > 0) setAttachedFileNames(saved.attachedFileNames);
      if (saved.fileContext) fileContextRef.current = saved.fileContext;
      if (saved.maxRevisionRounds != null) {
        maxRoundsRef.current = Math.min(5, Math.max(1, saved.maxRevisionRounds));
      }
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

      // Turn-order state badge (top-left of node)
      if (!node.isHuman) {
        const ds = agentDisplayStatesRef.current[node.id];
        if (ds === "thinking") {
          const now = Date.now();
          // Pulsing outer ring — alpha oscillates between 0.45 and 1
          const pulse = 0.7 + 0.3 * Math.sin(now / 300);
          ctx.beginPath();
          ctx.arc(node.x, node.y, NR + 7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(78,205,196,${pulse.toFixed(2)})`;
          ctx.lineWidth = 2.5;
          const dashOffset = -(now / 30) % 20;
          ctx.setLineDash([6, 4]);
          ctx.lineDashOffset = dashOffset;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
          // "···" badge above the node
          const dotY = node.y - NR - 16;
          ctx.beginPath();
          ctx.roundRect(node.x - 16, dotY - 8, 32, 16, 8);
          ctx.fillStyle = "rgba(78,205,196,0.15)";
          ctx.fill();
          ctx.strokeStyle = "rgba(78,205,196,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = `bold 11px ${FONT}`;
          ctx.fillStyle = "#4ECDC4";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("···", node.x, dotY);
        } else if (ds === "responded" || ds === "skipped") {
          const sbx = node.x - NR * 0.68;
          const sby = node.y - NR * 0.68;
          ctx.beginPath();
          ctx.arc(sbx, sby, 8, 0, Math.PI * 2);
          ctx.fillStyle = ds === "responded" ? "#22C55E" : "#F59E0B";
          ctx.fill();
          ctx.strokeStyle = "#0B1120";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.font = `bold 9px ${FONT}`;
          ctx.fillStyle = "#0B1120";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ds === "responded" ? "✓" : "✕", sbx, sby + 0.5);
        }
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
  }, [graphNodes, graphEdges, graphClusters, canvasW, canvasH, agentDisplayStates, animTick]);

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

  // ── Auto-initialize repo when sessionGithubRepo is set and not yet done ──
  useEffect(() => {
    if (!sessionGithubRepo || repoInitialized || !isAuthenticated || authLoading || !token) return;
    void initRepo(repoBranchStrategy || "branch");
  }, [sessionGithubRepo, repoInitialized, isAuthenticated, authLoading, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resume pending GitHub push after OAuth redirect ─────────────────────

  useEffect(() => {
    if (!pendingGithubResume) return;
    if (!deliverableMsg) return;
    if (outcome !== null) return;
    if (status !== "CLOSED_SUCCESS") return;
    setOutcome("SUCCESS");
    setShowModal(true);
    setPendingGithubResume(false);
  }, [pendingGithubResume, deliverableMsg, outcome, status]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const fullTaskContent = fileContextRef.current
      ? `${taskDescription}\n\n--- Attached Files ---\n\n${fileContextRef.current}`
      : taskDescription;
    const taskMsg: Message = {
      id: `auto-task-${Date.now()}`,
      agentId: "human",
      agentName: "YOU",
      agentOrg: "Human",
      role: "Requester",
      type: "TASK",
      content: fullTaskContent,
      sigValid: true,
      ts: new Date().toISOString(),
      isHuman: true,
    };
    setMessages([taskMsg]);
    callDemoAgents(fullTaskContent, [taskMsg]);
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

        // Always apply the backend session_graph when available — it is the authoritative
        // source for role, isBuilder, and clusterId. If sessionStorage already loaded x,y
        // positions, merge: preserve positions but overwrite metadata from the backend.
        const sg: { agents?: Array<{ id: string; name: string; role: SessionRole; is_human?: boolean; cluster_id?: string | null; is_builder?: boolean }>; edges?: Array<{ from: string; to: string }> } | null = room.session_graph ?? null;
        if (sg?.agents && sg.agents.length > 0) {
          const sgEdges: GraphEdge[] = (sg.edges ?? []).map((e) => ({ fromId: e.from, toId: e.to }));
          if (savedGraphLoadedRef.current) {
            // Merge: update metadata on nodes already loaded from sessionStorage (preserves x,y)
            setGraphNodes((prev) => {
              const merged = prev.map((n) => {
                const a = sg.agents!.find((a) => a.id === n.id);
                if (!a) return n;
                return { ...n, role: a.role, isBuilder: a.is_builder ?? false, clusterId: a.cluster_id ?? n.clusterId };
              });
              return merged;
            });
            setGraphEdges(sgEdges);
          } else {
            // No sessionStorage data — build nodes from backend graph with auto-positioned x,y
            const sgNodes: GraphNode[] = sg.agents.map((a, i) => ({
              id: a.id,
              x: 200 + (i % 4) * 160,
              y: 200 + Math.floor(i / 4) * 140,
              label: a.name,
              role: a.role,
              isHuman: a.is_human ?? false,
              isBuilder: a.is_builder ?? false,
              clusterId: a.cluster_id ?? undefined,
            }));
            const human: GraphNode = { id: "human", x: 100, y: 100, label: "YOU", role: "Requester", isHuman: true, isBuilder: false };
            const allNodes = sgNodes.some((n) => n.isHuman) ? sgNodes : [human, ...sgNodes];
            setGraphNodes(allNodes);
            setGraphEdges(sgEdges);
            setParticipantCount(allNodes.length);
          }
        } else if (!savedGraphLoadedRef.current && participants.length > 1) {
          // Final fallback: basic contract participants (no roles/builder info)
          const { nodes, edges } = buildGraph(participants);
          setGraphNodes(nodes);
          setGraphEdges(edges);
          setParticipantCount(participants.length);
        }

        if (room.github_repo_url) {
          setSessionGithubRepo(room.github_repo_url);
          // Restore already-initialized repo state if branch is stored in room
          if (room.repo_branch) {
            setRepoBranch(room.repo_branch);
            repoBranchRef.current = room.repo_branch;
            setRepoBranchStrategy((room.repo_branch_strategy as "branch" | "main") ?? "branch");
            setRepoInitialized(true);
            repoInitializedRef.current = true;
            // Fetch cached file tree (not stored in client state across refreshes)
            fetch(`${API}/rooms/${roomId}/repo/tree`)
              .then((r) => r.ok ? r.json() : null)
              .then((data) => {
                if (data?.items?.length) {
                  setRepoTree(data.items);
                  repoTreeRef.current = data.items;
                }
              })
              .catch(() => {});
          }
        }

        const contract = room.contract ?? room.room_contract ?? {};
        const deliverableSpec: string = contract.deliverable_spec ?? room.deliverable_spec ?? "";
        let fullTask: string = room.task_description ?? "";
        if (fullTask && deliverableSpec) fullTask += `\n\nAcceptance criteria: ${deliverableSpec}`;
        if (fullTask) { setTaskDescription(fullTask); taskDescriptionRef.current = fullTask; }

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
      ws = new WebSocket(`ws://127.0.0.1:8000/ws/rooms/${roomId}`);
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
          // Populate graph from WS init only if sessionStorage restore hasn't already done it
          if (init?.participants?.length && !savedGraphLoadedRef.current) {
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
        } else if (data.type === "agent_state_change") {
          const { agent_id, state, round } = (data.data ?? {}) as { agent_id?: string; state?: string; round?: number };
          if (agent_id && state) {
            const stateMap: Record<string, AgentDisplayState> = {
              PENDING: "idle", THINKING: "thinking", RESPONDED: "responded", SKIPPED: "skipped",
            };
            const ds = stateMap[state] ?? "idle";
            setAgentDisplayStates((prev) => ({ ...prev, [agent_id]: ds }));
            if (ds === "thinking") {
              const agentName = graphNodesRef.current.find((n) => n.id === agent_id)?.label ?? agent_id;
              setCurrentSpeaker({ name: agentName, round: `Round ${round ?? "?"}` });
            } else if (ds === "responded" || ds === "skipped") {
              setCurrentSpeaker((prev) =>
                prev?.name === graphNodesRef.current.find((n) => n.id === agent_id)?.label ? null : prev
              );
            }
          }
        } else if (data.type === "poll_created") {
          const poll = data.data as PollType;
          setPolls((prev) => [poll, ...prev]);
          // Inject a synthetic POLL_EVENT message into the chat timeline
          const pollMsg: Message = {
            id: `poll-${poll.poll_id}`,
            agentId: "system",
            agentName: "AgentLink",
            agentOrg: "Protocol",
            role: "Observer",
            type: "POLL_EVENT",
            content: `[Poll] ${poll.question}`,
            sigValid: true,
            ts: poll.created_at,
            contentStructured: { poll_id: poll.poll_id },
          };
          setMessages((prev) => prev.some((m) => m.id === pollMsg.id) ? prev : [...prev, pollMsg]);
          triggerAgentAutoVote(poll);
        } else if (
          data.type === "poll_updated" ||
          data.type === "poll_closed" ||
          data.type === "poll_vetoed"
        ) {
          const updated = data.data as PollType;
          setPolls((prev) => prev.map((p) => p.poll_id === updated.poll_id ? updated : p));
        } else if (data.type === "repo_commit") {
          // repo_commit WS events are also sent as chat messages via the "message" event,
          // so no need to inject a message here — just update branch state if needed.
          const cd = data.data ?? {};
          if (cd.branch && !repoBranch) setRepoBranch(cd.branch);
          // Re-fetch the repo tree and animate newly committed files.
          fetch(`${API}/rooms/${roomId}/repo/tree`, {
            ...(tokenRef.current ? { headers: { Authorization: `Bearer ${tokenRef.current}` } } : {}),
          })
            .then((r) => r.ok ? r.json() : null)
            .then((treeData) => {
              if (!treeData?.items?.length) return;
              const newItems = treeData.items as Array<{path: string; type: string; size?: number}>;
              const currentPaths = new Set(repoTreeRef.current.map((i) => i.path));
              const addedPaths = newItems.map((i) => i.path).filter((p) => !currentPaths.has(p));
              setRepoTree(newItems);
              repoTreeRef.current = newItems;
              if (addedPaths.length > 0) {
                setNewlyCommittedFiles((prev) => new Set([...prev, ...addedPaths]));
                setTimeout(() => {
                  setNewlyCommittedFiles((prev) => {
                    const next = new Set(prev);
                    addedPaths.forEach((p) => next.delete(p));
                    return next;
                  });
                }, 3000);
              }
            })
            .catch(() => {});
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
    const SLUG_MAP: Record<string, string> = {
      "nexus-7":    "nexus-7",  nexus7:      "nexus-7",
      "aria-ml":    "aria-ml",  ariaml:      "aria-ml",
      "forge-alpha":"forge-alpha", forgealpha: "forge-alpha",
      "scribe-pro": "scribe-pro", scribepro:  "scribe-pro",
      "quant-z":    "quant-z",  quantz:      "quant-z",
      "vortex-ui":  "vortex-ui", vortexui:   "vortex-ui",
      "sigma-qa":   "sigma-qa", sigmaqa:     "sigma-qa",
      "vector-x":   "vector-x", vectorx:     "vector-x",
      financeagent: "quant-z",  finance:     "quant-z",
      legalagent:   "scribe-pro", legal:     "scribe-pro",
    };
    const key = name.toLowerCase().replace(/[\s]/g, "");
    return SLUG_MAP[key] ?? name.toLowerCase();
  }

  function isUUID(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }

  function extractAgentId(agentId: string, label: string): string {
    const stripped = agentId.startsWith("node-") ? agentId.slice(5) : agentId;
    const bareUuid = stripped.length > 36 ? stripped.slice(0, 36) : stripped;
    if (isUUID(bareUuid)) return bareUuid;
    return toDemoSlug(label);
  }

  function sortAgentsByPriority(agentList: GraphNode[]): GraphNode[] {
    const priority = (role: string): number => {
      if (role === "Reviewer") return 1;
      if (role === "Contributor" || role === "Builder") return 2;
      if (role === "Observer") return 3;
      return 4;
    };
    return [...agentList].sort((a, b) => priority(a.role) - priority(b.role));
  }

  async function saveGithubRepoAndRetry(url: string) {
    setSessionGithubRepo(url);
    setGithubConnectionFailed(false);
    try {
      await fetch(`${API}/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ github_repo_url: url }),
      });
    } catch { /* non-fatal — push still proceeds with URL in state */ }
    await pushToGitHub(url);
  }

  async function pushToGitHub(repoOverride?: string) {
    if (!deliverableMsg || !token) {
      setGithubPushError("You must be logged in to push to GitHub.");
      return;
    }
    setGithubPushError(null);
    setGithubPushTimedOut(false);
    setGithubPushing(true);
    const pushTimeoutId = setTimeout(() => {
      setGithubPushing(false);
      setGithubPushTimedOut(true);
    }, 30000);
    try {
      const allDeliverableContent = messagesRef.current
        .filter((m) => m.type === "DELIVERABLE")
        .map((m) => m.content)
        .join("\n\n---\n\n");
      const sessionLog = messagesRef.current
        .map((m) => `**${m.agentName ?? "System"}** (${m.role})\n\n${m.content}`)
        .join("\n\n---\n\n");
      const agentsContributions = graphNodesRef.current
        .filter((n) => !n.isHuman)
        .map((n) => ({
          name: n.label,
          role: n.role,
          message_count: messagesRef.current.filter((m) => m.agentId === n.id).length,
        }));
      const res = await fetch(`${API}/rooms/${roomId}/deliver-github`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          deliverable_content: allDeliverableContent,
          session_log: sessionLog,
          agents_contributions: agentsContributions,
          ...((repoOverride ?? sessionGithubRepo) ? { github_repo_url: repoOverride ?? sessionGithubRepo } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "GitHub delivery failed");
      setGithubDeliveryUrl(data.branch_url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "GitHub push failed. Please try again.";
      setGithubPushError(msg);
      if (msg.toLowerCase().includes("not connected")) {
        setGithubConnectionFailed(true);
      }
    } finally {
      clearTimeout(pushTimeoutId);
      setGithubPushing(false);
    }
  }

  function handleOAuthSuccess() {
    setGithubConnectionFailed(false);
  }

  // ── Repo active input ─────────────────────────────────────────────────────

  async function initRepo(strategy: "branch" | "main") {
    if (!token || !sessionGithubRepo) return;
    setRepoInitializing(true);
    setRepoBranchStrategy(strategy);
    try {
      const res = await fetch(`${API}/rooms/${roomId}/repo/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ strategy }),
      });
      if (res.ok) {
        const data = await res.json();
        setRepoBranch(data.branch ?? "");
        repoBranchRef.current = data.branch ?? "";
        setRepoBranchUrl(data.branch_url ?? "");
        setRepoTree(data.tree_items ?? []);
        setRepoInitialized(true);
        repoInitializedRef.current = true;
        setRepoPanelOpen(true);
      }
    } catch { /* non-blocking */ }
    setRepoInitializing(false);
    setShowRepoBranchModal(false);
  }

  async function openRepoFile(path: string) {
    if (!token) return;
    setRepoFileLoading(true);
    try {
      const res = await fetch(
        `${API}/rooms/${roomId}/repo/file?path=${encodeURIComponent(path)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        setRepoFileContent({ path: data.path, content: data.content });
      }
    } catch { /* non-blocking */ }
    setRepoFileLoading(false);
  }

  async function autoCommitToRepo(msg: Message, roundNum: number) {
    if (!repoInitializedRef.current || !token || !sessionGithubRepo) return;
    const agentSlug = msg.agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const filePath = `sessions/${roomId}/contributions/${agentSlug}.md`;
    const commitMessage = `[${msg.agentName}] (${msg.role}): Round ${roundNum} output`;
    try {
      await fetch(`${API}/rooms/${roomId}/repo/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          file_path: filePath,
          content: msg.content,
          commit_message: commitMessage,
          agent_id: msg.agentId,
        }),
      });
    } catch { /* non-blocking */ }
  }

  async function mergeToMain() {
    if (!token) return;
    setRepoMerging(true);
    try {
      const res = await fetch(`${API}/rooms/${roomId}/repo/merge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) setRepoMerged(true);
    } catch { /* non-blocking */ }
    setRepoMerging(false);
    setShowMergeConfirm(false);
  }

  // ── Coordinator plan generation (extracted so Retry button can re-invoke) ──

  async function generateCoordinatorPlans(coordList: GraphNode[]) {
    setCoordinatorPlanLoading(true);
    setCoordinatorPlan(null);
    setEditedAssignments([]);
    const allNonCoord = graphNodesRef.current.filter(
      (n) => !n.isHuman && n.role !== "Observer" && n.role !== "Coordinator",
    );
    try {
      for (const coord of coordList) {
        const scopedAgents = allNonCoord.filter((n) =>
          coord.clusterId ? n.clusterId === coord.clusterId : !n.clusterId,
        );
        if (scopedAgents.length === 0) continue;
        const body = { agent_ids: scopedAgents.map((n) => n.id), coordinator_id: coord.id };
        try {
          const res = await fetch(`${API}/rooms/${roomId}/coordinator/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            const plan = await res.json();
            setCoordinatorPlan(plan);
            setEditedAssignments(plan.assignments ?? []);
            coordinatorPlanRef.current = plan;
            setActiveCoordinatorTab((prev) => prev ?? coord.id);
          } else {
            const detail = await res.text().catch(() => res.statusText);
            console.error(`[coordinator/generate] ${res.status} for coord=${coord.id}:`, detail);
          }
        } catch (err) {
          console.error(`[coordinator/generate] fetch error for coord=${coord.id}:`, err);
        }
      }
    } catch { /* non-blocking */ }
    setCoordinatorPlanLoading(false);
  }

  async function callDemoAgents(humanText: string, sessionMessages: Message[]) {
    if (agentLoopRunningRef.current) return; // prevent re-entry from mid-session human messages
    agentLoopRunningRef.current = true;
    try {
    // All non-human, non-Observer agents (Coordinators now included)
    console.log("[callDemoAgents] entry graphNodes:", graphNodesRef.current.map((n) => `${n.label}(role=${n.role},isBuilder=${n.isBuilder},isHuman=${n.isHuman})`));
    const allSessionAgents = sortAgentsByPriority(
      graphNodesRef.current.filter((n) => !n.isHuman && n.role !== "Observer")
    );
    const coordinators = allSessionAgents.filter((n) => n.role === "Coordinator");
    const agents = allSessionAgents.filter((n) => n.role !== "Coordinator");
    if (agents.length === 0 && coordinators.length === 0) { agentLoopRunningRef.current = false; return; }

    // ── Coordinator pre-round plan ─────────────────────────────────────────
    // Only show the plan modal on the first invocation; skip on subsequent human messages
    if (coordinators.length > 0 && !coordinatorPlanDoneRef.current) {
      coordinatorsForRetryRef.current = coordinators;
      setShowCoordinatorPlan(true);
      await generateCoordinatorPlans(coordinators);
      // Wait for user to confirm, skip, or retry
      await new Promise<void>((resolve) => {
        coordinatorPlanResolveRef.current = resolve;
      });
      setShowCoordinatorPlan(false);
    }

    const maxRounds = maxRoundsRef.current;
    roundsCompletedRef.current = 0;

    function addSystemMsg(content: string) {
      const msg = systemMsg(content);
      setMessages((prev) => [...prev, msg]);
    }

    // Merge any humanDirect messages from messagesRef that aren't in the provided context.
    // These are mid-session human messages sent while the agent loop was running.
    function mergeHumanDirectMsgs(context: Message[]): Message[] {
      const contextIds = new Set(context.map((m) => m.id));
      const fresh = messagesRef.current.filter((m) => m.humanDirect && !contextIds.has(m.id));
      return fresh.length > 0 ? [...context, ...fresh] : context;
    }

    function getVisibleContext(agent: GraphNode, context: Message[], round?: string): Message[] {
      // Always merge fresh humanDirect messages before filtering
      const merged = mergeHumanDirectMsgs(context);
      const edges = graphEdgesRef.current;

      // Determine which node IDs / labels the human is directly connected to
      const humanNode = graphNodesRef.current.find((n) => n.isHuman);
      const humanNeighborIds = humanNode
        ? new Set(
            edges
              .filter((e) => e.fromId === humanNode.id || e.toId === humanNode.id)
              .map((e) => (e.fromId === humanNode.id ? e.toId : e.fromId)),
          )
        : new Set<string>();
      const agentIsHumanNeighbor = humanNode
        ? humanNeighborIds.has(agent.id) ||
          edges.some(
            (e) =>
              (e.fromId === humanNode.id && e.toId === agent.id) ||
              (e.toId === humanNode.id && e.fromId === agent.id),
          )
        : true; // no human node → all agents see everything

      if (edges.length === 0) {
        if (round) console.log(`[${round}] ${agent.label}: no edges → full context (${merged.length} msgs)`);
        return merged;
      }
      const neighborIds = new Set(
        edges
          .filter((e) => e.fromId === agent.id || e.toId === agent.id)
          .map((e) => (e.fromId === agent.id ? e.toId : e.fromId)),
      );
      if (neighborIds.size === 0) {
        if (round) console.log(`[${round}] ${agent.label}: isolated node → full context (${merged.length} msgs)`);
        return merged;
      }

      // Name-based fallback matching: edge IDs might not match message agentIds
      const allNodes = graphNodesRef.current;
      const neighborLabels = new Set(
        [...neighborIds]
          .map((id) => allNodes.find((n) => n.id === id)?.label?.toLowerCase())
          .filter((l): l is string => Boolean(l)),
      );

      if (round) {
        const peerCtx = merged.filter((m) => !m.isHuman && m.agentId !== "system" && m.agentId !== agent.id);
        console.log(
          `[${round}] ${agent.label} (id=${agent.id}) | ` +
          `edges=[${edges.map((e) => `${e.fromId}→${e.toId}`).join(" ")}] | ` +
          `neighborIds=[${[...neighborIds].join(",")}] neighborLabels=[${[...neighborLabels].join(",")}] | ` +
          `peer_msgs in ctx: ${peerCtx.map((m) => `${m.agentId}(${m.agentName}) id_match=${neighborIds.has(m.agentId)} name_match=${neighborLabels.has((m.agentName ?? "").toLowerCase())}`).join(" | ")}`,
        );
      }

      const visible = merged.filter(
        (m) => {
          // humanDirect messages: only show to agents directly connected to the human node
          if (m.humanDirect) return agentIsHumanNeighbor;
          // Regular human messages (e.g. initial task): always visible
          if (m.isHuman) return true;
          return (
            m.agentId === "system" ||
            m.agentId === agent.id ||
            neighborIds.has(m.agentId) ||
            neighborLabels.has((m.agentName ?? "").toLowerCase())
          );
        },
      );

      const peerMsgs = visible.filter((m) => !m.isHuman && m.agentId !== "system" && m.agentId !== agent.id);

      if (round) {
        console.log(`[${round}] ${agent.label}: peer_msgs=${peerMsgs.length} visible=${visible.length} total_ctx=${merged.length}`);
        if (peerMsgs.length === 0) {
          console.warn(`[${round}] ${agent.label}: ZERO peer messages after filter → falling back to full context`);
        }
      }

      // Fallback: if no peer messages got through (only human/system/self), return full context.
      // Over-sharing is better than an agent with zero peer context.
      if (peerMsgs.length === 0) {
        return merged;
      }

      return visible;
    }

    // Team metadata sent to API for role-aware system prompts
    const teamAgentsForApi = allSessionAgents.map((n) => ({ name: n.label, role: n.role }));

    async function callAgent(
      agent: GraphNode,
      prompt: string,
      context: Message[],
      type: MessageType,
      subtask?: string,
      roundNum?: number,
      maxRnds?: number,
      rnCtx?: string,
    ): Promise<Message | null> {
      if (isPausedRef.current) return null;
      // Skip agents already dropped from this session
      if (droppedAgentIds.has(agent.id)) return null;

      try {
        // Send UUID if the node id is a real agent UUID, otherwise use the demo slug
        const agentIdToSend = extractAgentId(agent.id, agent.label);

        // Fetch tree if we have a repo but tree is empty (e.g. after page refresh)
        if (sessionGithubRepo && repoTreeRef.current.length === 0 && token) {
          try {
            const treeRes = await fetch(`${API}/rooms/${roomId}/repo/tree`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (treeRes.ok) {
              const treeData = await treeRes.json();
              const items = (treeData.items ?? []) as Array<{path: string; type: string; size?: number}>;
              if (items.length > 0) {
                setRepoTree(items);
                repoTreeRef.current = items;
              }
              if (treeData.branch && !repoBranchRef.current) {
                setRepoBranch(treeData.branch);
                repoBranchRef.current = treeData.branch;
              }
            }
          } catch { /* non-blocking */ }
        }

        const currentTree = repoTreeRef.current;
        const repoCtxStr = currentTree.length > 0
          ? `--- GITHUB REPOSITORY CONTEXT ---\nRepository: ${sessionGithubRepo}\nWorking branch: ${repoBranchRef.current}\n\nYou have read access to this repository. Below is the file tree.\nReference files by path if relevant.\nFile tree:\n${
              currentTree.slice(0, 200).map((i) => i.path).join("\n")
            }${currentTree.length > 200 ? `\n...and ${currentTree.length - 200} more files` : ""}`
          : undefined;

        const res = await fetch(`${API}/agents/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            message: prompt,
            agent_id: agentIdToSend,
            acting_as: { name: agent.label, role: agent.role },
            session_messages: context,
            team_agents: teamAgentsForApi,
            ...(subtask ? { subtask } : {}),
            ...(roundNum != null ? { round_number: roundNum } : {}),
            ...(maxRnds != null ? { max_rounds: maxRnds } : {}),
            ...(rnCtx ? { rn_context: rnCtx } : {}),
            ...(agent.isBuilder ? { is_builder: true } : {}),
            ...(repoCtxStr ? { repo_context: repoCtxStr } : {}),
          }),
        });

        if (res.status === 429) {
          const body = await res.json().catch(() => ({}));
          if (body.error === "demo_limit_reached") {
            setDemoLimitReached(true);
            addSystemMsg(`${agent.label} was skipped — demo message limit reached for this session.`);
          } else {
            addSystemMsg(`${agent.label} was rate-limited and skipped for this round.`);
          }
          return null;
        }

        const data = await res.json().catch(() => ({}));

        // Agent webhook failure — show recovery modal
        if (data.error === "agent_unavailable") {
          setFailedAgent({ id: agent.id, name: data.agent_name ?? agent.label });
          pendingRetryRef.current = async () => {
            const retryMsg = await callAgent(agent, prompt, context, type, subtask, roundNum, maxRnds, rnCtx);
            if (!retryMsg) setShowFailureModal(true);
          };
          setShowFailureModal(true);
          return null;
        }

        if (!res.ok) {
          // 400 errors are configuration problems (e.g. no webhook) — not retryable, post system message.
          // 5xx and other errors are potentially transient — show the recovery modal.
          const reason = data?.message ?? data?.detail ?? `HTTP ${res.status}`;
          if (res.status >= 400 && res.status < 500) {
            addSystemMsg(`${agent.label} could not respond and was skipped: ${reason}`);
          } else {
            addSystemMsg(`${agent.label} encountered a server error and was skipped for this round.`);
            setFailedAgent({ id: agent.id, name: data?.agent_name ?? agent.label });
            pendingRetryRef.current = async () => {
              const retryMsg = await callAgent(agent, prompt, context, type, subtask, roundNum, maxRnds, rnCtx);
              if (!retryMsg) setShowFailureModal(true);
            };
            setShowFailureModal(true);
          }
          return null;
        }

        if (data.messages_remaining != null) setMessagesRemaining(data.messages_remaining);

        const content: string = data.response ?? data.message ?? data.content ?? "";
        if (!content) {
          addSystemMsg(`${agent.label} responded with no content and was skipped for this round.`);
          return null;
        }

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
        addSystemMsg(`${agent.label} encountered a connection error and was skipped for this round.`);
        return null;
      }
    }

    // ── Round state helpers ───────────────────────────────────────────────────

    const postRoundState = (agentId: string, state: "PENDING" | "THINKING" | "RESPONDED" | "SKIPPED", round: number) => {
      fetch(`${API}/rooms/${roomId}/round-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round, agent_id: agentId, state }),
      }).catch(() => {});
    };

    const setDisplayState = (agentId: string, ds: AgentDisplayState) => {
      setAgentDisplayStates((prev) => ({ ...prev, [agentId]: ds }));
    };

    const markThinking = (agent: GraphNode, round: number) => {
      setDisplayState(agent.id, "thinking");
      setCurrentSpeaker({ name: agent.label, round: `Round ${round}` });
      postRoundState(agent.id, "THINKING", round);
    };

    const markDone = (agent: GraphNode, result: Message | null, round: number) => {
      const ds: AgentDisplayState = result ? "responded" : "skipped";
      setDisplayState(agent.id, ds);
      setCurrentSpeaker(null);
      postRoundState(agent.id, result ? "RESPONDED" : "SKIPPED", round);
    };

    const resetRound = (agentList: GraphNode[], round: number) => {
      setAgentDisplayStates((prev) => {
        const next = { ...prev };
        for (const a of agentList) next[a.id] = "idle";
        return next;
      });
      for (const a of agentList) postRoundState(a.id, "PENDING", round);
    };

    // ── Coordinator round evaluation (Feature 8) ─────────────────────────────
    // Called after each non-final round when a Coordinator is present.
    // Returns "continue" (skip vote, open next round) or "done" (trigger vote).
    async function coordinatorEvaluateRound(round: number, ctx: Message[]): Promise<"continue" | "done"> {
      if (coordinators.length === 0) return "done"; // no coordinator → always vote
      const coord = coordinators[0];
      const agentIdToSend = extractAgentId(coord.id, coord.label);

      // Build summary: last message per agent
      const agentSummaries = [...agents, ...coordinators]
        .filter((a) => a.id !== coord.id)
        .map((a) => {
          const lastMsg = [...ctx].reverse().find((m) => m.agentId === a.id || m.agentName === a.label);
          return lastMsg
            ? `${a.label} (${a.role}): "${lastMsg.content.slice(0, 300)}"`
            : `${a.label} (${a.role}): (no contribution yet)`;
        })
        .join("\n\n");

      const evalPrompt =
        `You are ${coord.label}, the session Coordinator.\n\n` +
        `Original task:\n${humanText}\n\n` +
        `Acceptance criteria (from session contract):\n${taskDescriptionRef.current || "(none specified)"}\n\n` +
        `Summary of each agent's contribution so far:\n${agentSummaries || "(no contributions yet)"}\n\n` +
        `This was Round ${round} of a maximum of ${maxRounds} rounds total. The next would be Round ${round + 1}.\n\n` +
        `Evaluate whether the team's current output is sufficient to meet the acceptance criteria, or whether another round of work is needed.\n\n` +
        `Reply with exactly one word: CONTINUE or DONE. ` +
        `CONTINUE means the team needs another round to meet the acceptance criteria. ` +
        `DONE means the work is sufficient and we should move to a vote on whether to proceed to the final round.`;

      try {
        const res = await fetch(`${API}/agents/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room_id: roomId,
            message: evalPrompt,
            agent_id: agentIdToSend,
            acting_as: { name: coord.label, role: coord.role },
            session_messages: [],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const raw: string = (data.response ?? data.message ?? data.content ?? "").trim().toUpperCase();
          if (raw.startsWith("DONE")) {
            addSystemMsg(`Coordinator assessment (Round ${round}): work is sufficient — initiating team vote.`);
            return "done";
          }
          addSystemMsg(`Coordinator assessment (Round ${round}): more work needed — opening Round ${round + 1}.`);
          return "continue";
        }
      } catch { /* fall through to vote */ }

      // On error, fall back to vote
      return "done";
    }

    // ── Round voting (Feature 1) ──────────────────────────────────────────────
    // Called after each non-final round. Returns true = open another round.
    async function runRoundVote(round: number, ctx: Message[]): Promise<boolean> {
      setVoteRoundNumber(round);
      setVoteResults([]);

      const voteOrder = [
        ...agents.filter((n) => n.role === "Contributor"),
        ...agents.filter((n) => n.role === "Reviewer"),
        ...coordinators,
      ];
      const accumulated: Array<{ voter: string; vote: "yes" | "no" }> = [];

      // Summary of what was produced so far (last message per agent)
      const agentSummary = voteOrder
        .map((a) => {
          const lastMsg = [...ctx].reverse().find((m) => m.agentId === a.id || m.agentName === a.label);
          return lastMsg ? `${a.label} (${a.role}): "${lastMsg.content.slice(0, 200)}…"` : null;
        })
        .filter(Boolean)
        .join("\n");

      for (const voter of voteOrder) {
        const votesSoFar = accumulated.map((v) => `${v.voter}: ${v.vote}`).join("\n");
        const votePrompt =
          `You are ${voter.label} (${voter.role}). A round just completed in this session.\n\n` +
          `Original task: ${humanText}\n\n` +
          `Contributions so far:\n${agentSummary || "(none yet)"}\n\n` +
          `Votes cast so far:\n${votesSoFar || "(you are first)"}\n\n` +
          `Should the team open another round to continue improving the work, or is the current output sufficient to proceed to the final deliverable?\n\n` +
          `Reply with exactly one word: YES (open another round) or NO (proceed to final).`;

        const agentIdToSend = extractAgentId(voter.id, voter.label);
        let vote: "yes" | "no" = "yes";
        try {
          const res = await fetch(`${API}/agents/respond`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              room_id: roomId,
              message: votePrompt,
              agent_id: agentIdToSend,
              acting_as: { name: voter.label, role: voter.role },
              session_messages: [],
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const raw: string = (data.response ?? data.message ?? data.content ?? "").trim().toUpperCase();
            vote = raw.startsWith("NO") ? "no" : "yes";
          }
        } catch { /* default yes on error */ }
        accumulated.push({ voter: voter.label, vote });
        setVoteResults([...accumulated]);
      }

      // Determine final result
      const humanNode = graphNodesRef.current.find((n) => n.isHuman);
      let continueRound: boolean;
      let finalVoter = "majority";

      if (humanNode) {
        // Human has final veto power — show banner and block
        setShowVoteBanner(true);
        const humanChoice = await new Promise<boolean>((resolve) => {
          humanVoteResolverRef.current = resolve;
        });
        setShowVoteBanner(false);
        continueRound = humanChoice;
        finalVoter = "Human";
      } else if (coordinators.length > 0) {
        // Coordinator has final vote
        const coordVote = accumulated.find((v) => coordinators.some((c) => c.label === v.voter));
        continueRound = coordVote?.vote === "yes";
        finalVoter = coordVote?.voter ?? "Coordinator";
      } else {
        // Simple majority
        const yesCount = accumulated.filter((v) => v.vote === "yes").length;
        continueRound = yesCount > accumulated.length / 2;
        finalVoter = "majority";
      }

      const tally = accumulated.map((v) => `${v.voter}: ${v.vote.toUpperCase()}`).join(", ");
      const verdict = continueRound ? "open another round" : "proceed to final";
      addSystemMsg(`Round ${round} vote — [${tally}] — Decision by ${finalVoter}: ${verdict.toUpperCase()}`);

      return continueRound;
    }

    // ── ROUND 1: Independent analysis ────────────────────────────────────────
    // Coordinators go first (sequential), then workers parallel, then reviewers
    addSystemMsg("Round 1 — Independent analysis");
    const plan = coordinatorPlanRef.current;
    const allR1Agents = [...coordinators, ...agents];
    resetRound(allR1Agents, 1);

    const r1Prompt = `${humanText}\n\nRound 1: Provide your independent expert analysis. Do not hold back your perspective.`;

    // Coordinators sequential first
    const r1CoordMsgs: Message[] = [];
    for (const coord of coordinators) {
      markThinking(coord, 1);
      const msg = await callAgent(coord, r1Prompt, getVisibleContext(coord, sessionMessages, "R1"), "R1", undefined, 1, maxRounds);
      markDone(coord, msg, 1);
      if (msg) { r1CoordMsgs.push(msg); void autoCommitToRepo(msg, 1); }
    }

    // Workers (contributors + builders) in parallel, reviewers after
    const workers = agents.filter((n) => n.role === "Contributor" || n.isBuilder);
    const reviewers = agents.filter((n) => n.role === "Reviewer");
    const r1WorkerContext = [...sessionMessages, ...r1CoordMsgs];
    const r1WorkerResults = await Promise.all(
      workers.map(async (agent) => {
        markThinking(agent, 1);
        const subtask = plan?.assignments.find((a) => a.agent_id === agent.id || a.agent_name === agent.label)?.subtask;
        const msg = await callAgent(agent, r1Prompt, getVisibleContext(agent, r1WorkerContext, "R1"), "R1", subtask, 1, maxRounds);
        markDone(agent, msg, 1);
        if (msg) void autoCommitToRepo(msg, 1);
        return msg;
      }),
    );
    const r1WorkerMsgs = r1WorkerResults.filter((m): m is Message => m !== null);

    const r1ReviewerBase = [...r1WorkerContext, ...r1WorkerMsgs];
    const r1ReviewerMsgs: Message[] = [];
    for (const rev of reviewers) {
      markThinking(rev, 1);
      const msg = await callAgent(rev, r1Prompt, getVisibleContext(rev, [...r1ReviewerBase, ...r1ReviewerMsgs], "R1"), "R1", undefined, 1, maxRounds);
      markDone(rev, msg, 1);
      if (msg) { r1ReviewerMsgs.push(msg); void autoCommitToRepo(msg, 1); }
    }

    const r1Messages = [...r1CoordMsgs, ...r1WorkerMsgs, ...r1ReviewerMsgs];
    roundsCompletedRef.current = 1;
    if (r1Messages.length === 0) return;

    let allMessages: Message[] = [...sessionMessages, ...r1Messages];

    // ── ROUNDS 2 through maxRounds-1: Cross-review (sequential) ──────────────
    let jumpToFinal = false;
    for (let round = 2; round < maxRounds; round++) {
      addSystemMsg(`Round ${round} — Cross-review`);
      const allRoundAgents = [...coordinators, ...agents];
      resetRound(allRoundAgents, round);
      const roundPrompt = `Round ${round}: You have read your colleagues' analyses. Identify where you agree, where you disagree, and refine your position. Be specific about what you accept or challenge from others.`;
      const roundMsgs: Message[] = [];

      // Coordinators first
      for (const coord of coordinators) {
        markThinking(coord, round);
        const msg = await callAgent(coord, roundPrompt, getVisibleContext(coord, [...allMessages, ...roundMsgs], `R${round}`), "R2", undefined, round, maxRounds);
        markDone(coord, msg, round);
        if (msg) { roundMsgs.push(msg); void autoCommitToRepo(msg, round); }
      }
      for (const agent of agents) {
        markThinking(agent, round);
        const msg = await callAgent(agent, roundPrompt, getVisibleContext(agent, [...allMessages, ...roundMsgs], `R${round}`), "R2", undefined, round, maxRounds);
        markDone(agent, msg, round);
        if (msg) { roundMsgs.push(msg); void autoCommitToRepo(msg, round); }
      }
      roundsCompletedRef.current = round;
      allMessages = [...allMessages, ...roundMsgs];
      if (roundMsgs.length === 0) return;

      // After each non-final round, evaluate continuation (Features 1 + 8)
      // Skip if this round immediately precedes the final (loop will end naturally)
      if (round < maxRounds - 1) {
        if (coordinators.length > 0) {
          // Coordinator evaluates first (Feature 8)
          const coordDecision = await coordinatorEvaluateRound(round, allMessages);
          if (coordDecision === "done") {
            // Coordinator says done → run full vote (Feature 1)
            const continueRound = await runRoundVote(round, allMessages);
            if (!continueRound) { jumpToFinal = true; break; }
          }
          // coordDecision === "continue" → loop continues automatically (no vote)
        } else {
          // No coordinator → vote after every round (Feature 1 fallback)
          const continueRound = await runRoundVote(round, allMessages);
          if (!continueRound) { jumpToFinal = true; break; }
        }
      }
    }
    if (jumpToFinal) {
      addSystemMsg("Vote result: proceeding directly to final round.");
    }

    // ── Final round: summaries → Builder assembles deliverable ────────────────
    addSystemMsg(`Round ${maxRounds} — Final round`);
    // Re-read from ref at final round — eliminates any stale-capture edge case
    const finalRoundAllAgents = sortAgentsByPriority(
      graphNodesRef.current.filter((n) => !n.isHuman && n.role !== "Observer" && n.role !== "Coordinator")
    );
    const builderAgents = [
      ...finalRoundAllAgents.filter((n) => n.isBuilder === true),
      ...coordinators.filter((n) => n.isBuilder === true),
    ];
    const builderAgent = builderAgents.length > 0 ? builderAgents[builderAgents.length - 1] : null;
    console.log("[DELIVERABLE] finalRoundAllAgents:", finalRoundAllAgents.map((n) => `${n.label}(isBuilder=${n.isBuilder},role=${n.role})`));
    console.log("[DELIVERABLE] Builder detected:", builderAgent?.label ?? "none — last Contributor gets DELIVERABLE");
    // Non-builder agents in final round: non-builder coordinators + all non-builders
    const nonBuilderFinalAgents = [
      ...coordinators.filter((n) => !n.isBuilder),
      ...finalRoundAllAgents.filter((n) => !n.isBuilder),
    ];
    // Fallback: no Builder → last Contributor (not just last sorted agent) gets DELIVERABLE
    const lastContributor = [...finalRoundAllAgents].reverse().find((n) => n.role === "Contributor") ?? finalRoundAllAgents[finalRoundAllAgents.length - 1];
    const allFinalAgents = builderAgent
      ? [...nonBuilderFinalAgents, builderAgent]
      : finalRoundAllAgents; // no Builder: all agents run, lastContributor gets DELIVERABLE

    resetRound(allFinalAgents, maxRounds);

    const finalBasePrompt = `Round ${maxRounds} (final): This is the last round. Deliver your role-specific final output.`;
    const finalRoundMsgs: Message[] = [];

    if (builderAgent) {
      // Run non-builders first to collect summaries for rn_context
      for (const agent of nonBuilderFinalAgents) {
        markThinking(agent, maxRounds);
        const msg = await callAgent(
          agent,
          finalBasePrompt,
          getVisibleContext(agent, [...allMessages, ...finalRoundMsgs], `R${maxRounds}`),
          "R3",
          undefined,
          maxRounds,
          maxRounds,
        );
        markDone(agent, msg, maxRounds);
        if (msg) { finalRoundMsgs.push(msg); void autoCommitToRepo(msg, maxRounds); }
      }
      // Build rn_context for Builder
      const rnContext = finalRoundMsgs
        .map((m) => `[${m.agentName ?? "Agent"}] (${m.role}) summary:\n${m.content}\n\n---`)
        .join("\n\n");

      // Builder runs last with full rn_context
      markThinking(builderAgent, maxRounds);
      const builderMsg = await callAgent(
        builderAgent,
        finalBasePrompt,
        getVisibleContext(builderAgent, [...allMessages, ...finalRoundMsgs], `R${maxRounds}`),
        "DELIVERABLE",
        undefined,
        maxRounds,
        maxRounds,
        rnContext,
      );
      markDone(builderAgent, builderMsg, maxRounds);
      if (builderMsg) {
        finalRoundMsgs.push(builderMsg);
        void autoCommitToRepo(builderMsg, maxRounds);
      }
    } else {
      // No Builder: all agents run, last contributor gets DELIVERABLE
      for (let i = 0; i < allFinalAgents.length; i++) {
        const agent = allFinalAgents[i];
        const isDeliverable = agent.id === lastContributor?.id;
        markThinking(agent, maxRounds);
        const msg = await callAgent(
          agent,
          isDeliverable
            ? `${finalBasePrompt} You are the designated final agent — synthesize all contributions into one cohesive final deliverable.`
            : finalBasePrompt,
          getVisibleContext(agent, [...allMessages, ...finalRoundMsgs], `R${maxRounds}`),
          isDeliverable ? "DELIVERABLE" : "R3",
          undefined,
          maxRounds,
          maxRounds,
        );
        markDone(agent, msg, maxRounds);
        if (msg) {
          finalRoundMsgs.push(msg);
          if (isDeliverable) void autoCommitToRepo(msg, maxRounds);
        }
      }
    }

    roundsCompletedRef.current = maxRounds;
    sessionCompletedRef.current = true;
    sessionStorage.setItem(`agentlink_session_completed_${roomId}`, "true");
    } finally {
      agentLoopRunningRef.current = false;
    }
  }

  // ── Poll helpers ─────────────────────────────────────────────────────────

  async function handleHumanVote(pollId: string, optionIndex: number) {
    setHumanVotedPollIds((prev) => new Set([...prev, pollId]));
    await fetch(`${API}/rooms/${roomId}/polls/${pollId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voter_id: "human", voter_type: "human", option_index: optionIndex }),
    }).catch(() => {});
  }

  async function handleVetoPoll(pollId: string) {
    await fetch(`${API}/rooms/${roomId}/polls/${pollId}/veto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requester_id: "human" }),
    }).catch(() => {});
  }

  function triggerAgentAutoVote(poll: PollType) {
    const eligibleAgents = graphNodesRef.current.filter((n) => {
      if (n.isHuman || n.role === "Observer") return false;
      if (poll.scope === "CONTRIBUTORS_ONLY" && n.role !== "Contributor" && !n.isBuilder) return false;
      if (poll.scope === "REVIEWERS_ONLY" && n.role !== "Reviewer") return false;
      return true;
    });

    const optionsList = poll.options.map((o, i) => `${i}: ${o}`).join(", ");
    const votePrompt =
      `A poll has been proposed in this session:\n\nQuestion: ${poll.question}\nOptions: ${optionsList}\n\n` +
      `Reply with ONLY the number of the option you choose (0, 1, 2, or 3). No other text.`;

    eligibleAgents.forEach((agent) => {
      const agentIdToSend = extractAgentId(agent.id, agent.label);
      fetch(`${API}/agents/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          message: votePrompt,
          agent_id: agentIdToSend,
          acting_as: { name: agent.label, role: agent.role },
          session_messages: [],
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          const raw: string = (data.response ?? data.message ?? data.content ?? "").trim();
          const idx = parseInt(raw.match(/\d/)?.[0] ?? "-1", 10);
          if (idx >= 0 && idx < poll.options.length) {
            fetch(`${API}/rooms/${roomId}/polls/${poll.poll_id}/vote`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ voter_id: agent.id, voter_type: "agent", option_index: idx }),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    });
  }

  async function submitProposePoll() {
    const validOptions = pollOptions.filter((o) => o.trim());
    if (!pollQuestion.trim() || validOptions.length < 2) return;
    setPollSubmitting(true);
    try {
      await fetch(`${API}/rooms/${roomId}/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposed_by: "human",
          proposed_by_type: "human",
          question: pollQuestion.trim(),
          options: validOptions,
          deadline_secs: pollDeadline,
          scope: pollScope,
          action_type: pollActionType || null,
          action_params: null,
        }),
      });
      setShowProposePoll(false);
      setPollQuestion("");
      setPollOptions(["", ""]);
      setPollScope("ALL");
      setPollActionType("CONSENSUS");
      setPollDeadline(120);
    } finally {
      setPollSubmitting(false);
    }
  }

  // ── Send human message ────────────────────────────────────────────────────

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || showFailureModal || isPaused) return;

    const loopRunning = agentLoopRunningRef.current;

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
      // Mark as direct mid-session injection if agents are currently running
      ...(loopRunning ? { humanDirect: true } : {}),
    };

    const updatedMessages = [...messagesRef.current, msg];
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

    // If agents are already running, the message is injected as context for
    // the next agent's turn via mergeHumanDirectMsgs. Don't re-trigger the loop.
    // If the session has already completed all rounds, don't start a new loop.
    if (!loopRunning && !sessionCompletedRef.current) {
      setSending(true);
      await callDemoAgents(text, updatedMessages);
      setSending(false);
    }
  }

  // ── Agent failure handlers ────────────────────────────────────────────────

  async function handleContinueWithout() {
    if (!failedAgent) return;
    await agentDropped(roomId, failedAgent.id, "continue_without");
    setDroppedAgentIds((prev) => new Set([...prev, failedAgent.id]));
    setGraphNodes((prev) => prev.filter((n) => n.id !== failedAgent.id));
    setMessages((prev) => [
      ...prev,
      systemMsg(`Agent ${failedAgent.name} has been removed from this session.`),
    ]);
    setShowFailureModal(false);
    setFailedAgent(null);
  }

  async function handleCloseSessionDueToFailure() {
    if (!failedAgent) return;
    await agentDropped(roomId, failedAgent.id, "close_session");
    add(sessionCost ?? 0); // full escrow refund
    setShowFailureModal(false);
    setFailedAgent(null);
    setStatus("CLOSED_DISPUTED");
    setOutcome("INCOMPLETE");
    setShowProposePoll(false);
    setShowFeedbackModal(true);
  }

  async function handleRetry() {
    const retryCb = pendingRetryRef.current;
    pendingRetryRef.current = null;
    setShowFailureModal(false);
    setFailedAgent(null);
    if (retryCb) await retryCb();
  }

  function handleCancelSession() {
    if (sessionCost == null) {
      setMessages((prev) => [...prev, systemMsg("Session cancelled by Requester")]);
      setStatus("CLOSED_DISPUTED");
      setOutcome("CANCELLED");
      setShowProposePoll(false);
      setShowFeedbackModal(true);
      setShowCancelConfirm(false);
      return;
    }
    const nonHumanNodes = graphNodesRef.current.filter((n) => !n.isHuman);
    const currentMessages = messagesRef.current;
    let actualBase = 0;
    nonHumanNodes.forEach((n) => {
      const sessionFee = agentRates[n.id] ?? 3;
      const costPerMsg = agentMsgRates[n.id] ?? 1;
      const msgCount = currentMessages.filter(
        (m) => m.agentId === n.id && !m.isHuman && m.agentId !== "system",
      ).length;
      actualBase += sessionFee + msgCount * costPerMsg;
    });
    actualBase = Math.round(actualBase * 10) / 10;
    const actualFee = Math.round(actualBase * 0.03 * 10) / 10;
    const computed = Math.round((actualBase + actualFee) * 10) / 10;
    const refund = Math.max(0, Math.round((sessionCost - computed) * 10) / 10);
    setActualCost(computed);
    setRefundAmount(refund);
    if (refund > 0) add(refund);
    setMessages((prev) => [...prev, systemMsg("Session cancelled by Requester")]);
    setStatus("CLOSED_DISPUTED");
    setOutcome("CANCELLED");
    setShowProposePoll(false);
    setShowFeedbackModal(true);
    setShowCancelConfirm(false);
  }

  // ── Escrow settlement ────────────────────────────────────────────────────

  function applyConformeEscrow() {
    if (sessionCost == null) return;
    const nonHumanNodes = graphNodesRef.current.filter((n) => !n.isHuman);
    const currentMessages = messagesRef.current;
    let actualBase = 0;
    nonHumanNodes.forEach((n) => {
      const sessionFee = agentRates[n.id] ?? 3;
      const costPerMsg = agentMsgRates[n.id] ?? 1;
      const msgCount = currentMessages.filter(
        (m) => m.agentId === n.id && !m.isHuman && m.agentId !== "system",
      ).length;
      actualBase += sessionFee + msgCount * costPerMsg;
    });
    actualBase = Math.round(actualBase * 10) / 10;
    const actualFee = Math.round(actualBase * 0.03 * 10) / 10;
    const computed = Math.round((actualBase + actualFee) * 10) / 10;
    const refund = Math.max(0, Math.round((sessionCost - computed) * 10) / 10);
    setActualCost(computed);
    setRefundAmount(refund);
    if (refund > 0) add(refund);
  }

  // ── Peer review + rating flow ─────────────────────────────────────────────

  function triggerPeerReview() {
    setPeerReviewLoading(true);
    setShowRatingScreen(true);
    const currentNodes = graphNodesRef.current;
    const currentMessages = messagesRef.current;
    const nonHumanAgents = currentNodes
      .filter((n) => !n.isHuman)
      .map((n) => ({ id: n.id, name: n.label, role: n.role }));
    fetch(`${API}/agents/sessions/${roomId}/peer-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agents: nonHumanAgents,
        messages: currentMessages.map((m) => ({
          agentId: m.agentId,
          agentName: m.agentName,
          role: m.role,
          content: m.content,
          isHuman: m.isHuman ?? false,
        })),
      }),
    })
      .then(async (r) => {
        if (r.ok) return r.json();
        const body = await r.json().catch(() => ({}));
        console.error("[peer-review] API error", r.status, body);
        return null;
      })
      .then((data) => { if (data) setPeerReviewData(data); })
      .catch((err) => { console.error("[peer-review] fetch failed", err); })
      .finally(() => setPeerReviewLoading(false));
  }

  async function submitRatings() {
    setRatingSubmitting(true);
    const currentNodes = graphNodesRef.current;
    const currentMessages = messagesRef.current;
    const nonHumanAgents = currentNodes.filter((n) => !n.isHuman);
    const session_stats: Record<string, number> = {};
    for (const n of nonHumanAgents) {
      session_stats[n.id] = currentMessages.filter(
        (m) => m.agentId === n.id && !m.isHuman && m.agentId !== "system",
      ).length;
    }
    try {
      const res = await fetch(`${API}/reputation/session-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          agents: nonHumanAgents.map((n) => ({ id: n.id, name: n.label, role: n.role })),
          peer_scores: peerReviewData?.weighted_averages ?? {},
          human_scores: { team: teamRating, individual: individualRatings },
          session_stats,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.reputation_updates) setReputationUpdates(data.reputation_updates);
      }
    } catch { /* proceed regardless */ }
    setRatingSubmitting(false);
    setShowRatingScreen(false);
    setShowModal(true);
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
          applyConformeEscrow();
          setStatus("CLOSED_SUCCESS");
          setOutcome("SUCCESS");
          triggerPeerReview();
          return;
        }
        if (backendStatus === "DISPUTED" || backendOutcome === "DISPUTE") {
          setStatus("CLOSED_DISPUTED");
          setOutcome("DISPUTED");
          setShowProposePoll(false);
          setShowFeedbackModal(true);
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
        applyConformeEscrow();
        setStatus("CLOSED_SUCCESS");
        setOutcome("SUCCESS");
        triggerPeerReview();
      } else {
        setStatus("CLOSED_DISPUTED");
        setOutcome("DISPUTED");
        setShowProposePoll(false);
        setShowFeedbackModal(true);
      }
    } catch {
      // Network error — apply locally
      if (verdict === "CONFORME") {
        applyConformeEscrow();
        setStatus("CLOSED_SUCCESS");
        setOutcome("SUCCESS");
        triggerPeerReview();
      } else {
        setStatus("CLOSED_DISPUTED");
        setOutcome("DISPUTED");
        setShowProposePoll(false);
        setShowFeedbackModal(true);
      }
    } finally {
      setVerdictLoading(false);
    }
  }

  async function submitFailureFeedback() {
    if (!fbReason || fbText.trim().length < 20 || fbRetry === null) return;
    setFbSubmitting(true);
    try {
      await fetch(`${API}/dataset/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: roomId,
          failure_reason: fbReason,
          failure_free_text: fbText.trim(),
          problematic_agent_ids: fbAgents,
          would_retry: fbRetry,
        }),
      }).catch(() => {});
    } finally {
      setFbSubmitting(false);
    }
    setShowFeedbackModal(false);
    setShowModal(true);
  }

  function downloadLog() {
    const repoCommits = messages
      .filter((m) => (m.contentStructured as Record<string, unknown> | undefined)?.type === "repo_commit")
      .map((m) => {
        const cs = m.contentStructured as Record<string, unknown>;
        return {
          agent_name: cs.agent_name,
          agent_role: cs.agent_role,
          file_path: cs.file_path,
          commit_message: cs.commit_message,
          commit_sha: cs.commit_sha,
          commit_url: cs.commit_url,
          branch: cs.branch,
          timestamp: m.ts,
        };
      });

    const log = {
      sessionId: roomId,
      status,
      exportedAt: new Date().toISOString(),
      team: graphNodes.map((n) => ({ id: n.id, name: n.label, role: n.role, isHuman: !!n.isHuman })),
      ...(sessionGithubRepo ? {
        github_repo: {
          url: sessionGithubRepo,
          branch: repoBranch,
          strategy: repoBranchStrategy,
          commits: repoCommits,
        },
      } : {}),
      messages: messages.map((m) => ({
        id: m.id,
        agentId: m.agentId,
        agentName: m.agentName,
        role: m.role,
        type: m.type,
        content: m.content,
        sigValid: m.sigValid,
        timestamp: m.ts,
        ...(m.contentStructured ? { contentStructured: m.contentStructured } : {}),
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

  function downloadDeliverable(_msg: Message) {
    const date = new Date().toISOString().split("T")[0];
    const fmt  = detectFormat(taskDescription);
    const allContent = messages
      .filter((m) => m.type === "DELIVERABLE")
      .map((m) => m.content)
      .join("\n\n---\n\n");

    if (fmt === "html") {
      const teamItems = graphNodes
        .map((n) => `<li>${n.label} · ${n.role}${n.isHuman ? " · Human" : ""}</li>`)
        .join("");
      const html = buildHtmlDeliverable(allContent, roomId, teamItems, date);
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
      allContent,
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

  const isClosed         = status === "CLOSED_SUCCESS" || status === "CLOSED_DISPUTED";
  const step             = STATUS_STEP[status];
  const agentNodes       = graphNodes.filter((n) => !n.isHuman);
  const deliverableExt   = detectFormat(taskDescription);
  const isHumanInSession = graphNodes.some((n) => n.isHuman);

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
            {repoInitialized && (
              <button
                onClick={() => setRepoPanelOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors"
                style={{
                  borderColor: repoPanelOpen ? "rgba(78,205,196,0.5)" : undefined,
                  color: repoPanelOpen ? "#4ECDC4" : undefined,
                }}
                title={repoPanelOpen ? "Hide repo panel" : "Show repo panel"}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zM5 2v12M9 5h3M9 8h3M9 11h3" />
                </svg>
                Repo
              </button>
            )}
            <button
              onClick={() => setDiagramVisible((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-al-border text-al-muted hover:text-al-text hover:border-al-accent/40 transition-colors text-xs"
              title={diagramVisible ? "Hide diagram" : "Show diagram"}
            >
              {diagramVisible ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M10 3L4 8l6 5" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M6 3l6 5-6 5" />
                </svg>
              )}
              {diagramVisible ? "Hide diagram" : "Show diagram"}
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 border border-amber-400/30">
              <span className="text-base leading-none">💰</span>
              <span className="text-sm font-semibold text-amber-400 tabular-nums">{balance} ALC</span>
            </div>
            <StatusBadge status={status} />
          </div>
        </div>
      </header>

      {/* Round vote banner (Feature 1) */}
      {showVoteBanner && (
        <div className="shrink-0 z-20 flex items-center justify-between gap-4 px-5 py-3 border-b border-[#4ECDC4]/30" style={{ background: "rgba(78,205,196,0.06)" }}>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-al-accent">Round {voteRoundNumber} complete</p>
            <p className="text-xs text-al-muted mt-0.5">Open another round to continue refining?</p>
            {voteResults.length > 0 && (
              <p className="text-[11px] text-al-muted mt-1">
                Agent votes: {voteResults.map((v) => `${v.voter} → ${v.vote.toUpperCase()}`).join(" · ")}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => { humanVoteResolverRef.current?.(false); }}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{ background: "rgba(100,116,139,0.12)", border: "1px solid rgba(100,116,139,0.35)", color: "#94A3B8" }}
            >
              No — go to final
            </button>
            <button
              onClick={() => { humanVoteResolverRef.current?.(true); }}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{ background: "rgba(78,205,196,0.14)", border: "1px solid rgba(78,205,196,0.45)", color: "#4ECDC4" }}
            >
              Yes — open Round {voteRoundNumber + 1}
            </button>
          </div>
        </div>
      )}

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

        {/* ── Repo panel (collapsible right sidebar) ── */}
        {repoPanelOpen && repoInitialized && (
          <div className="flex flex-col shrink-0 w-72 border-r border-al-border bg-al-surface overflow-hidden" style={{ order: 3 }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-al-border">
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-bold text-al-accent uppercase tracking-wider">Repo</span>
                {repoBranch && (
                  <a
                    href={repoBranchUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[9px] text-al-muted truncate hover:text-al-accent transition-colors"
                    title={repoBranch}
                  >
                    {repoBranch}
                  </a>
                )}
              </div>
              <button
                onClick={() => { setRepoPanelOpen(false); setRepoFileContent(null); }}
                className="text-al-muted hover:text-al-text transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                  <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l10 10M12 2L2 12" />
                </svg>
              </button>
            </div>

            {repoFileContent ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-al-border bg-al-bg">
                  <button
                    onClick={() => setRepoFileContent(null)}
                    className="text-al-muted hover:text-al-accent transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
                      <path strokeLinecap="round" strokeWidth={1.5} d="M8 2L3 6l5 4" />
                    </svg>
                  </button>
                  <span className="font-mono text-[9px] text-al-muted truncate flex-1">{repoFileContent.path}</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <pre className="text-[10px] text-al-muted font-mono whitespace-pre-wrap break-words leading-relaxed">{repoFileContent.content}</pre>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {repoFileLoading && (
                  <div className="flex items-center justify-center py-8">
                    <svg className="w-4 h-4 animate-spin text-al-accent" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  </div>
                )}
                {repoTree.length === 0 && !repoFileLoading && (
                  <div className="px-3 py-4 text-[10px] text-al-muted text-center">No files indexed.</div>
                )}
                {repoTree.map((item) => {
                  const isNew = newlyCommittedFiles.has(item.path);
                  return (
                    <button
                      key={item.path}
                      onClick={() => item.type === "blob" ? openRepoFile(item.path) : undefined}
                      disabled={item.type !== "blob"}
                      className="w-full flex items-center gap-1.5 px-3 py-1 text-left disabled:cursor-default"
                      style={{
                        transition: "background-color 1s ease",
                        backgroundColor: isNew ? "rgba(78,205,196,0.10)" : undefined,
                        animation: isNew ? "al-new-file-fadein 0.4s ease forwards" : undefined,
                      }}
                    >
                      <span className="shrink-0 text-[10px]" style={{ color: item.type === "tree" ? "#F59E0B" : isNew ? "#4ECDC4" : "#64748B" }}>
                        {item.type === "tree" ? "📁" : "📄"}
                      </span>
                      <span
                        className="font-mono text-[9px] truncate"
                        style={{
                          paddingLeft: `${(item.path.split("/").length - 1) * 8}px`,
                          color: isNew ? "#4ECDC4" : item.type === "blob" ? "#94A3B8" : "#CBD5E1",
                          fontWeight: isNew ? 600 : undefined,
                        }}
                      >
                        {item.path.split("/").pop()}
                      </span>
                      {item.size != null && item.size > 0 && (
                        <span className="shrink-0 text-[8px] text-al-muted ml-auto">
                          {item.size > 1024 ? `${(item.size / 1024).toFixed(0)}k` : `${item.size}b`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Left: team graph (45%) ── */}
        <div
          ref={containerRef}
          className="shrink-0 relative border-r border-al-border bg-al-surface overflow-hidden transition-all duration-300"
          style={{ width: diagramVisible ? "45%" : "0", minWidth: 0 }}
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
        <div className="flex-1 flex flex-col min-h-0 min-w-0">

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

          {/* Attachments info bar */}
          {(attachedFileNames.length > 0 || sessionGithubRepo) && (
            <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-al-bg border-b border-al-border text-xs text-al-muted flex-wrap">
              {attachedFileNames.length > 0 && (
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0">📎</span>
                  <span className="truncate">{attachedFileNames.join(", ")}</span>
                </span>
              )}
              {attachedFileNames.length > 0 && sessionGithubRepo && (
                <span className="text-al-border">·</span>
              )}
              {sessionGithubRepo && (
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0">🔗</span>
                  <a
                    href={sessionGithubRepo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-al-accent hover:underline"
                  >
                    {sessionGithubRepo}
                  </a>
                </span>
              )}
            </div>
          )}

          {/* Currently speaking indicator */}
          {currentSpeaker && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-al-accent/5 border-b border-al-border">
              <span className="w-1.5 h-1.5 rounded-full bg-al-accent animate-pulse shrink-0" />
              <span className="text-xs text-al-muted">{currentSpeaker.round} ·</span>
              <span className="text-xs font-semibold text-al-accent">{currentSpeaker.name}</span>
              <span className="text-xs text-al-muted">is thinking…</span>
            </div>
          )}

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
            {visibleMessages.map((msg) => {
              if (msg.type === "POLL_EVENT") {
                const pollId = (msg.contentStructured?.poll_id ?? "") as string;
                const livePoll = polls.find((p) => p.poll_id === pollId);
                if (!livePoll) return null;
                const proposerNode = graphNodes.find((n) => n.id === livePoll.proposed_by);
                return (
                  <PollCard
                    key={msg.id}
                    poll={livePoll}
                    isHuman={isHumanInSession}
                    isRequester={isHumanInSession}
                    hasVoted={humanVotedPollIds.has(livePoll.poll_id)}
                    onVote={handleHumanVote}
                    onVeto={handleVetoPoll}
                    proposerName={proposerNode?.label ?? (livePoll.proposed_by_type === "human" ? "Human" : livePoll.proposed_by)}
                  />
                );
              }
              const isAgentMsg = !msg.isHuman && msg.agentId !== "system" && msg.type !== "SYSTEM";
              const isRevealed = !isAgentMsg || revealedIds.has(msg.id);
              const isCurrentlyTyping = msg.id === typingMessageId;
              const displayContent = isAgentMsg
                ? (revealedIds.has(msg.id)
                    ? msg.content
                    : isCurrentlyTyping
                      ? msg.content.slice(0, typedChars)
                      : "")
                : undefined;
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  roomId={roomId}
                  cluster={clusterByNodeId.get(msg.agentId)}
                  deliverableExt={deliverableExt}
                  displayContent={displayContent}
                  isTyping={isCurrentlyTyping}
                  useMarkdown={isRevealed}
                  onDownloadDeliverable={msg.type === "DELIVERABLE" && isRevealed ? downloadDeliverable : undefined}
                />
              );
            })}
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
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder={agentLoopRunningRef.current ? "Message queued for next agent turn…" : "Send a message…"}
                  className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                />
                <button
                  onClick={sendMessage}
                  disabled={!inputText.trim()}
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

            {/* Session controls: pause + cancel + propose poll */}
            {!isClosed && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPaused((p) => !p)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: isPaused ? "rgba(78,205,196,0.12)" : "rgba(100,116,139,0.10)",
                    border: isPaused ? "1px solid rgba(78,205,196,0.4)" : "1px solid rgba(100,116,139,0.3)",
                    color: isPaused ? "#4ECDC4" : "#94A3B8",
                  }}
                >
                  {isPaused ? "▶ Resume" : "⏸ Pause"}
                </button>
                <button
                  onClick={() => setShowProposePoll(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: "rgba(168,85,247,0.08)",
                    border: "1px solid rgba(168,85,247,0.25)",
                    color: "#A855F7",
                  }}
                  title="Propose a poll"
                >
                  📊 Poll
                </button>
                {showCancelConfirm ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/5 border border-red-500/30">
                    <span className="text-xs text-al-muted flex-1">
                      Cancel? You&apos;ll be charged for work completed so far.
                    </span>
                    <button
                      onClick={handleCancelSession}
                      className="px-2.5 py-1 rounded text-xs font-bold bg-red-500/15 border border-red-500/40 text-red-400 hover:bg-red-500/25 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowCancelConfirm(false)}
                      className="px-2.5 py-1 rounded text-xs text-al-muted hover:text-al-text transition-colors"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.25)",
                      color: "#EF4444",
                    }}
                  >
                    ⏹ Cancel Session
                  </button>
                )}
              </div>
            )}

            {isPaused && !isClosed && (
              <p className="text-[10px] text-amber-400 text-center">
                Session paused by Requester — no agent calls until resumed
              </p>
            )}

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

      {/* Agent failure modal */}
      {/* Mandatory failure feedback modal — cannot be dismissed */}
      {showFeedbackModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl border border-al-border bg-al-surface shadow-2xl p-6 space-y-5 my-auto max-h-[85vh] overflow-y-auto">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-al-text">
                Before you go — help us improve
              </h2>
              <p className="text-xs text-al-muted">
                This session ended without a successful deliverable. Your feedback improves future team recommendations.
              </p>
            </div>

            {/* What went wrong */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">
                What went wrong? <span className="text-red-400">*</span>
              </label>
              <textarea
                value={fbText}
                onChange={(e) => setFbText(e.target.value)}
                placeholder="Describe what happened in this session…"
                rows={3}
                className="w-full bg-al-bg border border-al-border rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors resize-none"
              />
              <p className={`text-[10px] text-right ${fbText.trim().length >= 20 ? "text-green-400" : "text-al-muted"}`}>
                {fbText.trim().length} / 20 min chars
              </p>
            </div>

            {/* Main reason */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">
                Main reason for failure <span className="text-red-400">*</span>
              </label>
              <select
                value={fbReason}
                onChange={(e) => setFbReason(e.target.value)}
                className="w-full bg-al-bg border border-al-border rounded-lg px-3 py-2 text-sm text-al-text focus:outline-none focus:border-al-accent transition-colors"
              >
                <option value="">Select a reason…</option>
                <option value="AGENT_DID_NOT_UNDERSTAND">Agent did not understand the task</option>
                <option value="AGENT_QUALITY_TOO_LOW">Agent quality was too low</option>
                <option value="SESSION_TOO_LONG">Session took too long</option>
                <option value="TECHNICAL_FAILURE">Technical failure (agent down / timeout)</option>
                <option value="TASK_TOO_COMPLEX">Task was too complex for the team</option>
                <option value="REQUESTER_CHANGED_MIND">I changed my mind / task no longer needed</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/* Problematic agents */}
            {agentNodes.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">
                  Which agent(s) were the problem? <span className="text-al-muted font-normal">(optional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {agentNodes.map((n) => (
                    <label key={n.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fbAgents.includes(n.id)}
                        onChange={(e) =>
                          setFbAgents((prev) =>
                            e.target.checked ? [...prev, n.id] : prev.filter((id) => id !== n.id)
                          )
                        }
                        className="accent-al-accent"
                      />
                      <span className="text-xs text-al-text">{n.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Would retry */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">
                Would you try again with a different team? <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-3">
                {([true, false] as const).map((val) => (
                  <button
                    key={String(val)}
                    onClick={() => setFbRetry(val)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      fbRetry === val
                        ? "bg-al-accent/15 border-al-accent text-al-accent"
                        : "bg-transparent border-al-border text-al-muted hover:border-al-accent/50"
                    }`}
                  >
                    {val ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={submitFailureFeedback}
              disabled={
                fbSubmitting ||
                fbText.trim().length < 20 ||
                !fbReason ||
                fbRetry === null
              }
              className="w-full py-2.5 rounded-xl bg-al-accent text-al-bg text-sm font-semibold hover:bg-al-accent-dim active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {fbSubmitting ? "Submitting…" : "Submit feedback & close session"}
            </button>
          </div>
        </div>
      )}

      {/* Propose Poll modal */}
      {showProposePoll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-al-border bg-al-surface shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-al-text">Propose a Poll</h2>
              <button onClick={() => setShowProposePoll(false)} className="text-al-muted hover:text-al-text transition-colors text-lg leading-none">×</button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">Question</label>
              <input
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="What should the team decide?"
                className="w-full bg-al-bg border border-al-border rounded-lg px-3 py-2 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">Options</label>
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => { const o = [...pollOptions]; o[i] = e.target.value; setPollOptions(o); }}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-sm text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                  />
                  {pollOptions.length > 2 && (
                    <button onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))} className="text-al-muted hover:text-red-400 transition-colors text-sm">✕</button>
                  )}
                </div>
              ))}
              {pollOptions.length < 4 && (
                <button
                  onClick={() => setPollOptions([...pollOptions, ""])}
                  className="text-xs text-al-accent hover:text-al-accent/70 transition-colors"
                >
                  + Add option
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">Scope</label>
                <select
                  value={pollScope}
                  onChange={(e) => setPollScope(e.target.value as typeof pollScope)}
                  className="w-full bg-al-bg border border-al-border rounded-lg px-2 py-1.5 text-xs text-al-text focus:outline-none focus:border-al-accent transition-colors"
                >
                  <option value="ALL">All agents</option>
                  <option value="CONTRIBUTORS_ONLY">Contributors only</option>
                  <option value="REVIEWERS_ONLY">Reviewers only</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">Action</label>
                <select
                  value={pollActionType}
                  onChange={(e) => setPollActionType(e.target.value)}
                  className="w-full bg-al-bg border border-al-border rounded-lg px-2 py-1.5 text-xs text-al-text focus:outline-none focus:border-al-accent transition-colors"
                >
                  <option value="CONSENSUS">Consensus only</option>
                  <option value="OPEN_ROUND">Open extra round</option>
                  <option value="SKIP_AGENT">Skip an agent</option>
                  <option value="REASSIGN_BUILDER">Reassign builder</option>
                  <option value="CUSTOM_MESSAGE">Custom message</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-al-muted uppercase tracking-wide font-semibold">
                Deadline — {pollDeadline}s
              </label>
              <input
                type="range"
                min={30}
                max={300}
                step={15}
                value={pollDeadline}
                onChange={(e) => setPollDeadline(Number(e.target.value))}
                className="w-full accent-al-accent"
              />
              <div className="flex justify-between text-[10px] text-al-muted">
                <span>30s</span><span>5m</span>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowProposePoll(false)}
                className="flex-1 px-4 py-2 rounded-xl border border-al-border text-al-muted text-sm hover:text-al-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitProposePoll}
                disabled={pollSubmitting || !pollQuestion.trim() || pollOptions.filter((o) => o.trim()).length < 2}
                className="flex-1 px-4 py-2 rounded-xl bg-[#A855F7] text-white text-sm font-semibold hover:bg-[#9333EA] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pollSubmitting ? "Creating…" : "Create Poll"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coordinator plan modal — shown before session starts when a Coordinator agent is present */}
      {showCoordinatorPlan && (() => {
        const perCoordPlans = coordinatorPlan?.coordinator_plans ?? {};
        const coordIds = Object.keys(perCoordPlans);
        const isMultiCoord = coordIds.length > 1;
        const activeTab = activeCoordinatorTab ?? coordIds[0] ?? null;
        const tabAssignments = isMultiCoord && activeTab
          ? (perCoordPlans[activeTab]?.assignments ?? [])
          : editedAssignments;
        const tabSummary = isMultiCoord && activeTab
          ? (perCoordPlans[activeTab]?.summary ?? "")
          : (coordinatorPlan?.summary ?? "");
        const coordNode = (id: string) => graphNodesRef.current.find((n) => n.id === id);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="relative w-full max-w-lg mx-4 rounded-2xl border p-6 flex flex-col gap-5"
            style={{ background: "#0F1117", borderColor: "rgba(255,107,53,0.35)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧭</span>
              <div>
                <h2 className="text-base font-bold text-white">Coordinator Plan</h2>
                <p className="text-xs text-al-muted mt-0.5">Task decomposition generated by the Coordinator agent</p>
              </div>
            </div>

            {/* Tabs — only shown when multiple coordinators */}
            {isMultiCoord && !coordinatorPlanLoading && (
              <div className="flex gap-1 border-b border-al-border pb-0">
                {coordIds.map((cid) => {
                  const label = coordNode(cid)?.label ?? cid;
                  return (
                    <button
                      key={cid}
                      onClick={() => setActiveCoordinatorTab(cid)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-t transition-colors ${
                        activeTab === cid
                          ? "text-orange-400 border-b-2 border-orange-400"
                          : "text-al-muted hover:text-al-text"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {coordinatorPlanLoading ? (
              <div className="flex items-center justify-center py-8 gap-3">
                <svg className="w-5 h-5 animate-spin text-orange-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-sm text-al-muted">Generating coordination plan…</span>
              </div>
            ) : coordinatorPlan ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-al-text leading-relaxed">{tabSummary}</p>
                <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                  {(isMultiCoord ? tabAssignments : editedAssignments).map((a, idx) => (
                    <div
                      key={a.agent_id}
                      className="flex gap-3 items-start rounded-lg p-3"
                      style={{ background: "rgba(255,107,53,0.07)", border: "1px solid rgba(255,107,53,0.2)" }}
                    >
                      <span
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-1"
                        style={{ background: "rgba(255,107,53,0.18)", color: "#FF6B35" }}
                      >
                        {a.agent_name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white mb-1">{a.agent_name}</p>
                        {isMultiCoord ? (
                          <p className="text-xs text-al-muted leading-relaxed">{a.subtask}</p>
                        ) : (
                          <textarea
                            value={a.subtask}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditedAssignments((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, subtask: val } : x)),
                              );
                            }}
                            rows={2}
                            className="w-full text-xs bg-black/20 border border-white/10 rounded px-2 py-1.5 text-al-text placeholder:text-al-muted focus:outline-none focus:border-orange-500/50 transition-colors resize-none"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {!isMultiCoord && <p className="text-[11px] text-al-muted text-center">You can edit any subtask above before confirming.</p>}
              </div>
            ) : (
              <div className="py-4 text-center space-y-3">
                <p className="text-sm text-al-muted">Could not generate plan — retry or skip to proceed without subtask assignment.</p>
                <button
                  onClick={() => generateCoordinatorPlans(coordinatorsForRetryRef.current)}
                  disabled={coordinatorPlanLoading || confirmingPlan}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "rgba(255,107,53,0.12)", border: "1px solid rgba(255,107,53,0.4)", color: "#FF6B35" }}
                >
                  {coordinatorPlanLoading ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Retrying…
                    </>
                  ) : "Retry"}
                </button>
              </div>
            )}

            <div className="flex gap-3">
              {/* Skip — clears plan, starts R1 with no subtask injection */}
              <button
                onClick={() => {
                  coordinatorPlanDoneRef.current = true;
                  coordinatorPlanRef.current = null;
                  coordinatorPlanResolveRef.current?.();
                }}
                disabled={coordinatorPlanLoading || confirmingPlan}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.3)", color: "#94A3B8" }}
              >
                Skip
              </button>

              {/* Confirm — PUT edited plan, then start R1 */}
              <button
                onClick={async () => {
                  if (coordinatorPlanLoading || confirmingPlan) return;
                  setConfirmingPlan(true);
                  try {
                    const body = {
                      assignments: editedAssignments,
                      summary: coordinatorPlan?.summary ?? "",
                    };
                    const res = await fetch(`${API}/rooms/${roomId}/coordinator/plan`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                      body: JSON.stringify(body),
                    });
                    if (res.ok) {
                      const saved = await res.json();
                      coordinatorPlanRef.current = saved;
                    } else {
                      // Still proceed — backend plan already saved from generate step
                      coordinatorPlanRef.current = { assignments: editedAssignments, summary: coordinatorPlan?.summary ?? "" };
                    }
                  } catch {
                    coordinatorPlanRef.current = { assignments: editedAssignments, summary: coordinatorPlan?.summary ?? "" };
                  } finally {
                    setConfirmingPlan(false);
                    coordinatorPlanDoneRef.current = true;
                    coordinatorPlanResolveRef.current?.();
                  }
                }}
                disabled={coordinatorPlanLoading || confirmingPlan || !coordinatorPlan}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: "rgba(255,107,53,0.15)", border: "1px solid rgba(255,107,53,0.45)", color: "#FF6B35" }}
              >
                {confirmingPlan && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {coordinatorPlanLoading ? "Generating plan…" : confirmingPlan ? "Saving…" : "Confirm Plan →"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Branch strategy modal */}
      {showRepoBranchModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-al-border bg-al-surface shadow-2xl p-6 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-al-accent shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <h2 className="text-base font-bold text-al-text">GitHub Repository Linked</h2>
              </div>
              <p className="text-xs text-al-muted font-mono truncate">{sessionGithubRepo}</p>
              <p className="text-xs text-al-muted pt-1">
                Agents will have read access to this repository. Choose how commits should be applied:
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => initRepo("branch")}
                disabled={repoInitializing}
                className="w-full flex flex-col items-start gap-0.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 text-left"
                style={{ background: "rgba(78,205,196,0.10)", border: "1.5px solid rgba(78,205,196,0.45)", color: "#4ECDC4" }}
              >
                <span>Work on new branch (safe)</span>
                <span className="text-[10px] font-normal text-al-muted">Creates <span className="font-mono">agentlink/session-{roomId.slice(0, 8)}</span> from main. You merge when ready.</span>
              </button>
              <button
                onClick={() => initRepo("main")}
                disabled={repoInitializing}
                className="w-full flex flex-col items-start gap-0.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 text-left"
                style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.35)", color: "#EF4444" }}
              >
                <span>Work directly on main (destructive)</span>
                <span className="text-[10px] font-normal text-al-muted">Commits go directly to the default branch. Use with caution — cannot be undone.</span>
              </button>
            </div>
            {repoInitializing && (
              <div className="flex items-center gap-2 justify-center text-xs text-al-muted">
                <svg className="w-3.5 h-3.5 animate-spin text-al-accent" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Initializing repository access…
              </div>
            )}
          </div>
        </div>
      )}


      {showFailureModal && failedAgent && (
        <AgentFailureModal
          agentName={failedAgent.name}
          onRetry={handleRetry}
          onContinueWithout={handleContinueWithout}
          onCloseSession={handleCloseSessionDueToFailure}
        />
      )}

      {/* Rating screen — peer reviews + human rating before close modal */}
      {showRatingScreen && (
        <RatingModal
          agents={agentNodes}
          peerReviewLoading={peerReviewLoading}
          peerReviewData={peerReviewData}
          teamRating={teamRating}
          setTeamRating={setTeamRating}
          individualRatings={individualRatings}
          setIndividualRatings={setIndividualRatings}
          onSubmit={submitRatings}
          submitting={ratingSubmitting}
        />
      )}

      {/* Close modal */}
      {showModal && outcome && (
        <CloseModal
          outcome={outcome}
          roomId={roomId}
          agents={agentNodes}
          messages={messages}
          graphClusters={graphClusters}
          agentRates={agentRates}
          agentMsgRates={agentMsgRates}
          sessionCost={sessionCost}
          actualCost={actualCost}
          refundAmount={refundAmount}
          deliverable={deliverableMsg}
          deliverableExt={deliverableExt}
          reputationUpdates={reputationUpdates}
          githubConnected={!!user?.github_username && !githubConnectionFailed}
          githubRepoUrl={sessionGithubRepo}
          githubPushing={githubPushing}
          githubPushTimedOut={githubPushTimedOut}
          githubDeliveryUrl={githubDeliveryUrl}
          onDownloadDeliverable={deliverableMsg ? downloadDeliverable : undefined}
          onPushGitHub={deliverableMsg && outcome === "SUCCESS" && !!user?.github_username && !githubConnectionFailed && !!sessionGithubRepo ? () => pushToGitHub() : undefined}
          onSaveAndRetryGitHub={deliverableMsg && outcome === "SUCCESS" ? saveGithubRepoAndRetry : undefined}
          githubPushError={githubPushError}
          onGithubOAuthSuccess={handleOAuthSuccess}
          repoBranch={repoBranch}
          repoBranchStrategy={repoBranchStrategy}
          repoMerging={repoMerging}
          repoMerged={repoMerged}
          showMergeConfirm={showMergeConfirm}
          onSetShowMergeConfirm={setShowMergeConfirm}
          onMergeToMain={mergeToMain}
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

function escMd(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInlineMd(s: string): string {
  return escMd(s)
    .replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:0.82em;background:rgba(10,22,40,0.9);border:1px solid #1E2D4A;border-radius:3px;padding:1px 5px;color:#7dd3fc">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;color:#f1f5f9">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em style="font-style:italic;color:#cbd5e1">$1</em>');
}

function patchForTyping(text: string): string {
  let out = text;
  const fenceCount = (out.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) out += "\n```";
  const lines = out.split("\n");
  const lastNonEmpty = [...lines].reverse().find((l) => l.trim() !== "");
  if (lastNonEmpty && lastNonEmpty.trim().startsWith("|") && !lastNonEmpty.trim().endsWith("|")) {
    out += " |";
  }
  return out;
}

function renderMarkdown(text: string): string {
  const codeBlocks: string[] = [];
  const withPlaceholders = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langAttr = lang ? ` data-lang="${escMd(lang)}"` : "";
    codeBlocks.push(
      `<pre${langAttr} style="background:#070e1a;border:1px solid #1E2D4A;border-radius:8px;padding:12px 14px;overflow-x:auto;overflow-y:auto;max-height:400px;margin:8px 0"><code style="font-family:monospace;font-size:0.8em;color:#93c5fd;white-space:pre">${escMd(code.replace(/\n$/, ""))}</code></pre>`
    );
    return `\x00BLOCK${idx}\x00`;
  });

  const lines = withPlaceholders.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];

    // code block placeholder
    const ph = raw.trim().match(/^\x00BLOCK(\d+)\x00$/);
    if (ph) {
      out.push(codeBlocks[parseInt(ph[1])]);
      i++;
      continue;
    }

    // HR
    if (/^-{3,}$/.test(raw.trim())) {
      out.push('<hr style="border:none;border-top:1px solid #1E2D4A;margin:10px 0">');
      i++;
      continue;
    }

    // h3
    const h3 = raw.match(/^###\s+(.+)/);
    if (h3) {
      out.push(`<h3 style="font-size:0.95em;font-weight:700;color:#e2e8f0;margin:10px 0 4px 0">${applyInlineMd(h3[1])}</h3>`);
      i++;
      continue;
    }

    // h2
    const h2 = raw.match(/^##\s+(.+)/);
    if (h2) {
      out.push(`<h2 style="font-size:1.05em;font-weight:700;color:#e2e8f0;margin:12px 0 5px 0">${applyInlineMd(h2[1])}</h2>`);
      i++;
      continue;
    }

    // h1
    const h1 = raw.match(/^#\s+(.+)/);
    if (h1) {
      out.push(`<h2 style="font-size:1.15em;font-weight:700;color:#f1f5f9;margin:12px 0 6px 0">${applyInlineMd(h1[1])}</h2>`);
      i++;
      continue;
    }

    // table: collect all consecutive | lines
    if (raw.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
        .filter((row) => !row.every((c) => /^[-:]+$/.test(c)));
      if (rows.length > 0) {
        const [hdr, ...body] = rows;
        const th = hdr.map((c) => `<th style="padding:5px 10px;text-align:left;border-bottom:1px solid #1E2D4A;color:#94a3b8;font-weight:600;font-size:0.8em;white-space:nowrap">${applyInlineMd(c)}</th>`).join("");
        const tb = body.map((row) =>
          `<tr>${row.map((c) => `<td style="padding:5px 10px;border-bottom:1px solid #0d1a2e;color:#cbd5e1;font-size:0.82em">${applyInlineMd(c)}</td>`).join("")}</tr>`
        ).join("");
        out.push(`<div style="overflow-x:auto;margin:8px 0"><table style="width:100%;border-collapse:collapse;background:rgba(7,14,26,0.7);border:1px solid #1E2D4A;border-radius:6px"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      }
      continue;
    }

    // unordered list: collect consecutive lines
    if (/^\s*[-*]\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li style="margin:2px 0">${applyInlineMd(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul style="list-style:disc;padding-left:18px;margin:5px 0">${items.join("")}</ul>`);
      continue;
    }

    // ordered list: collect consecutive lines
    if (/^\d+\.\s+/.test(raw)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li style="margin:2px 0">${applyInlineMd(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol style="list-style:decimal;padding-left:18px;margin:5px 0">${items.join("")}</ol>`);
      continue;
    }

    // empty line → paragraph break
    if (raw.trim() === "") {
      out.push("<br>");
      i++;
      continue;
    }

    out.push(applyInlineMd(raw) + "<br>");
    i++;
  }

  return out.join("");
}

function MessageBubble({
  msg,
  roomId,
  cluster,
  deliverableExt = "md",
  displayContent,
  isTyping = false,
  useMarkdown = true,
  onDownloadDeliverable,
}: {
  msg: Message;
  roomId: string;
  cluster?: GraphCluster;
  deliverableExt?: string;
  displayContent?: string;
  isTyping?: boolean;
  useMarkdown?: boolean;
  onDownloadDeliverable?: (msg: Message) => void;
}) {
  // Special rendering for REPO_COMMIT SYSTEM messages
  if (msg.type === "SYSTEM" && (msg.contentStructured as Record<string, unknown> | undefined)?.type === "repo_commit") {
    const cs = msg.contentStructured as Record<string, unknown>;
    const commitUrl = cs.commit_url as string | undefined;
    const sha = cs.commit_sha as string | undefined;
    return (
      <div
        className="rounded-xl p-3.5 flex flex-col gap-2"
        style={{ background: "rgba(78,205,196,0.06)", border: "1px solid rgba(78,205,196,0.25)" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <svg className="w-3.5 h-3.5 text-al-accent shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <span className="text-[11px] font-bold text-al-accent">REPO COMMIT</span>
          <span className="text-[10px] text-al-muted">·</span>
          <span className="text-[10px] font-semibold text-al-text">{cs.agent_name as string}</span>
          <span className="text-[10px] text-al-muted">({cs.agent_role as string})</span>
          <span className="ml-auto text-[10px] text-al-muted">{new Date(msg.ts).toLocaleTimeString()}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[10px] text-al-muted bg-al-bg border border-al-border rounded px-1.5 py-0.5">
            {cs.file_path as string}
          </span>
          {sha && commitUrl ? (
            <a
              href={commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[9px] text-al-accent hover:underline"
            >
              {sha.slice(0, 7)}
            </a>
          ) : sha ? (
            <span className="font-mono text-[9px] text-al-muted">{sha.slice(0, 7)}</span>
          ) : null}
        </div>
        {!!cs.commit_message && (
          <p className="text-[10px] text-al-muted italic">&ldquo;{cs.commit_message as string}&rdquo;</p>
        )}
        <div className="flex items-center gap-1 text-[10px]" style={{ color: msg.sigValid ? "#22C55E" : "#EF4444" }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
            {msg.sigValid
              ? <path strokeLinecap="round" strokeWidth={1.5} d="M1.5 6l3 3 5.5-5.5" />
              : <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l8 8M10 2l-8 8" />
            }
          </svg>
          {msg.sigValid ? "sig valid" : "sig invalid"}
        </div>
      </div>
    );
  }

  // Special rendering for coordinator plan SYSTEM messages
  if (msg.type === "SYSTEM" && (msg.contentStructured as Record<string, unknown> | undefined)?.type === "coordinator_plan") {
    const plan = (msg.contentStructured as Record<string, unknown>)?.coordinator_plan as {
      assignments?: Array<{ agent_id: string; agent_name: string; subtask: string }>;
      summary?: string;
    } | undefined;
    const assignments = plan?.assignments ?? [];
    return (
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{ background: "rgba(255,107,53,0.07)", border: "1px solid rgba(255,107,53,0.3)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">🧭</span>
          <span className="text-sm font-bold text-white">Coordinator Plan</span>
          <span className="ml-auto text-[10px] text-al-muted">{new Date(msg.ts).toLocaleTimeString()}</span>
        </div>
        {plan?.summary && (
          <p className="text-xs text-al-muted leading-relaxed">{plan.summary}</p>
        )}
        <div className="flex flex-col gap-1.5">
          {assignments.map((a) => (
            <div key={a.agent_id} className="flex gap-2 text-xs">
              <span className="font-semibold text-orange-300 shrink-0">{a.agent_name}</span>
              <span className="text-al-muted-2">→</span>
              <span className="text-al-text flex-1">{a.subtask}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px]" style={{ color: msg.sigValid ? "#22C55E" : "#EF4444" }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor">
            {msg.sigValid
              ? <path strokeLinecap="round" strokeWidth={1.5} d="M1.5 6l3 3 5.5-5.5" />
              : <path strokeLinecap="round" strokeWidth={1.5} d="M2 2l8 8M10 2l-8 8" />
            }
          </svg>
          {msg.sigValid ? "sig valid" : "sig invalid"}
        </div>
      </div>
    );
  }

  const rc  = msg.isHuman ? HUMAN_COLOR : (ROLE_COLOR[msg.role] ?? "#64748B");
  const mtc = MSG_COLOR[msg.type];
  const ini = msg.isHuman ? "YOU" : initials(msg.agentName);

  return (
    <div className="flex gap-3 min-w-0">
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
        {(() => {
          const content = displayContent !== undefined ? displayContent : msg.content;
          const showPlaceholder = displayContent === "" && !isTyping;
          if (showPlaceholder) {
            return (
              <div
                className="rounded-xl px-3.5 py-2.5 text-sm text-al-muted"
                style={{ background: "rgba(13,20,33,0.7)", border: "1px solid #1E2D4A" }}
              >
                <span className="animate-pulse">···</span>
              </div>
            );
          }
          if (useMarkdown || isTyping) {
            return (
              <>
                <div
                  className="rounded-xl px-3.5 py-2.5 text-sm text-al-text leading-relaxed break-words"
                  style={{ background: "rgba(13,20,33,0.7)", border: "1px solid #1E2D4A" }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(isTyping ? patchForTyping(content) : content) }}
                />
                {isTyping && (
                  <span className="animate-pulse ml-0.5">|</span>
                )}
              </>
            );
          }
          return (
            <div
              className="rounded-xl px-3.5 py-2.5 text-sm text-al-text leading-relaxed break-words"
              style={{ background: "rgba(13,20,33,0.7)", border: "1px solid #1E2D4A" }}
            >
              <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</span>
            </div>
          );
        })()}
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

// ── Star components ─────────────────────────────────────────────────────────

const STAR_PATH = "M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z";

function StarDisplay({ value, size = 12 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20"
          fill={i <= full ? "#F59E0B" : "none"}
          stroke={i <= full ? "#F59E0B" : "#475569"}
          strokeWidth={1.5}
        >
          <path d={STAR_PATH} />
        </svg>
      ))}
    </div>
  );
}

function StarSelector({ value, onChange, size = 24 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div className="flex gap-1 items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="transition-transform hover:scale-110 focus:outline-none"
        >
          <svg width={size} height={size} viewBox="0 0 20 20"
            fill={active >= n ? "#F59E0B" : "none"}
            stroke={active >= n ? "#F59E0B" : "#475569"}
            strokeWidth={1.5}
          >
            <path d={STAR_PATH} />
          </svg>
        </button>
      ))}
    </div>
  );
}

function RatingModal({
  agents,
  peerReviewLoading,
  peerReviewData,
  teamRating,
  setTeamRating,
  individualRatings,
  setIndividualRatings,
  onSubmit,
  submitting,
}: {
  agents: GraphNode[];
  peerReviewLoading: boolean;
  peerReviewData: PeerReviewData | null;
  teamRating: number;
  setTeamRating: (v: number) => void;
  individualRatings: Record<string, number>;
  setIndividualRatings: (v: Record<string, number>) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const voters = peerReviewData?.reviews ?? [];
  const wavg = peerReviewData?.weighted_averages ?? {};
  const canSubmit = teamRating > 0 && !submitting && !peerReviewLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        style={{ boxShadow: "0 0 60px rgba(78,205,196,0.1)" }}
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-5">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ background: "rgba(78,205,196,0.12)", border: "2px solid rgba(78,205,196,0.3)" }}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="#4ECDC4">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-al-text">Session Review</h2>
          <p className="text-sm text-al-muted mt-0.5 text-center">
            Rate your team before closing the session
          </p>
        </div>

        {/* Section 1: Agent Peer Reviews */}
        <div className="mb-5">
          <p className="text-[10px] text-al-muted uppercase tracking-wider font-semibold mb-3">
            Agent Peer Reviews
          </p>
          {peerReviewLoading ? (
            <div className="flex flex-col items-center gap-3 py-7 bg-al-bg rounded-xl border border-al-border">
              <div className="w-5 h-5 rounded-full border-2 border-[#4ECDC4] border-t-transparent animate-spin" />
              <p className="text-sm text-al-muted text-center px-4">
                Agents are reviewing each other's contributions...
              </p>
            </div>
          ) : voters.length > 0 ? (
            <div className="bg-al-bg rounded-xl border border-al-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-al-border">
                      <th className="px-3 py-2 text-left text-al-muted font-medium">Agent</th>
                      {voters.map((v) => (
                        <th key={v.voter_id} className="px-2 py-2 text-center text-al-muted font-medium whitespace-nowrap">
                          {v.voter.split(/[-\s]/)[0]}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-center text-amber-400 font-semibold">W.Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <tr key={agent.id} className="border-b border-al-border/40 last:border-0">
                        <td className="px-3 py-2 text-al-text font-medium whitespace-nowrap">{agent.label}</td>
                        {voters.map((v) => {
                          const score = v.scores[agent.id];
                          return (
                            <td key={v.voter_id} className="px-2 py-2 text-center">
                              {v.voter_id === agent.id ? (
                                <span className="text-al-border text-xs">—</span>
                              ) : score != null ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <StarDisplay value={score} size={9} />
                                  <span className="text-al-muted text-[10px]">{score.toFixed(1)}</span>
                                </div>
                              ) : (
                                <span className="text-al-muted text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-center">
                          {wavg[agent.id] != null ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <StarDisplay value={wavg[agent.id]!} size={9} />
                              <span className="font-semibold text-amber-400 text-[10px]">
                                {wavg[agent.id]!.toFixed(1)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-al-muted text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="py-4 bg-al-bg rounded-xl border border-al-border text-center text-sm text-al-muted">
              Peer review data unavailable
            </div>
          )}
          {voters.length > 0 && voters.some((v) => Object.values(v.scores).some((s) => s === null)) && (
            <p className="mt-2 text-[11px] text-amber-400/80">
              Peer review unavailable for some agents — scores marked with —
            </p>
          )}
        </div>

        {/* Section 2: Team Rating (required) */}
        <div className="mb-5 bg-al-bg rounded-xl border border-al-border p-4">
          <p className="text-[10px] text-al-muted uppercase tracking-wider font-semibold mb-1">
            Rate this team <span className="text-red-400 normal-case">*</span>
          </p>
          <p className="text-sm text-al-text mb-3">How do you rate the team's overall performance?</p>
          <div className="flex items-center gap-3">
            <StarSelector value={teamRating} onChange={setTeamRating} size={28} />
            {teamRating > 0 && (
              <span className="text-sm font-semibold text-amber-400">{teamRating} / 5</span>
            )}
          </div>
        </div>

        {/* Section 3: Individual Ratings (optional) */}
        {agents.length > 0 && (
          <div className="mb-5">
            <p className="text-[10px] text-al-muted uppercase tracking-wider font-semibold mb-3">
              Individual ratings{" "}
              <span className="text-al-muted normal-case font-normal">(optional)</span>
            </p>
            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="bg-al-bg rounded-xl border border-al-border px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-al-text">{agent.label}</span>
                    <span className="text-xs text-al-muted ml-2">— {agent.role}</span>
                  </div>
                  <StarSelector
                    value={individualRatings[agent.id] ?? 0}
                    onChange={(v) =>
                      setIndividualRatings({ ...individualRatings, [agent.id]: v })
                    }
                    size={20}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: canSubmit ? "rgba(78,205,196,0.15)" : "rgba(100,116,139,0.08)",
            border: `1px solid ${canSubmit ? "rgba(78,205,196,0.5)" : "rgba(100,116,139,0.25)"}`,
            color: canSubmit ? "#4ECDC4" : "#64748B",
          }}
        >
          {submitting
            ? "Submitting..."
            : teamRating === 0
            ? "Select a team rating to continue"
            : "Submit Review & Close Session"}
        </button>
      </div>
    </div>
  );
}

function AgentFailureModal({
  agentName,
  onRetry,
  onContinueWithout,
  onCloseSession,
}: {
  agentName: string;
  onRetry: () => void;
  onContinueWithout: () => void;
  onCloseSession: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div
        className="bg-al-surface border border-al-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
        style={{ boxShadow: "0 0 60px rgba(239,68,68,0.1)" }}
      >
        <div className="flex flex-col items-center mb-5">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
            style={{ background: "rgba(245,158,11,0.12)", border: "2px solid rgba(245,158,11,0.35)" }}
          >
            <span className="text-2xl leading-none">⚠️</span>
          </div>
          <h2 className="text-lg font-bold text-al-text text-center">
            Agent {agentName} is not responding
          </h2>
          <p className="text-sm text-al-muted mt-2 text-center leading-relaxed">
            The agent failed to respond after 3 attempts. Its owner has been notified.
            How would you like to proceed?
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={onRetry}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: "rgba(78,205,196,0.18)",
              border: "1px solid rgba(78,205,196,0.6)",
              color: "#4ECDC4",
            }}
          >
            Retry
          </button>
          <button
            onClick={onContinueWithout}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: "rgba(78,205,196,0.08)",
              border: "1px solid rgba(78,205,196,0.25)",
              color: "#4ECDC4",
            }}
          >
            Continue without {agentName}
          </button>
          <button
            onClick={onCloseSession}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: "rgba(239,68,68,0.10)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "#EF4444",
            }}
          >
            Close session — full refund
          </button>
        </div>
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
  agentMsgRates,
  sessionCost,
  actualCost,
  refundAmount,
  deliverable,
  deliverableExt = "md",
  reputationUpdates,
  githubConnected,
  githubRepoUrl,
  githubPushing,
  githubPushTimedOut,
  githubDeliveryUrl,
  githubPushError,
  onDownloadDeliverable,
  onPushGitHub,
  onSaveAndRetryGitHub,
  onGithubOAuthSuccess,
  repoBranch,
  repoBranchStrategy,
  repoMerging,
  repoMerged,
  showMergeConfirm,
  onSetShowMergeConfirm,
  onMergeToMain,
  onDownload,
  onClose,
}: {
  outcome: "SUCCESS" | "DISPUTED" | "INCOMPLETE" | "CANCELLED";
  roomId: string;
  agents: GraphNode[];
  messages: Message[];
  graphClusters: GraphCluster[];
  agentRates: Record<string, number>;
  agentMsgRates: Record<string, number>;
  sessionCost?: number | null;
  actualCost?: number | null;
  refundAmount?: number | null;
  deliverable?: Message | null;
  deliverableExt?: string;
  reputationUpdates?: Record<string, ReputationUpdate> | null;
  githubConnected?: boolean;
  githubRepoUrl?: string;
  githubPushing?: boolean;
  githubPushTimedOut?: boolean;
  githubDeliveryUrl?: string | null;
  githubPushError?: string | null;
  onDownloadDeliverable?: (msg: Message) => void;
  onPushGitHub?: () => void;
  onSaveAndRetryGitHub?: (url: string) => Promise<void>;
  onGithubOAuthSuccess?: () => void;
  repoBranch?: string;
  repoBranchStrategy?: "branch" | "main";
  repoMerging?: boolean;
  repoMerged?: boolean;
  showMergeConfirm?: boolean;
  onSetShowMergeConfirm?: (v: boolean) => void;
  onMergeToMain?: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const { login } = useAuth();
  const [inlineRepo, setInlineRepo] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Local flag: set to true the moment OAuth succeeds, before parent prop propagates.
  const [oauthConnected, setOauthConnected] = useState(false);

  // Keep the callback fresh inside the effect without re-subscribing the listener.
  const onGithubOAuthSuccessRef = useRef(onGithubOAuthSuccess);
  useEffect(() => { onGithubOAuthSuccessRef.current = onGithubOAuthSuccess; });

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "github-oauth-success") {
        if (e.data.token && e.data.user) {
          login(e.data.token, e.data.user as AuthUser);
          // Update local state immediately — don't wait for the prop to trickle down
          // from the parent re-render so the modal transitions in the same paint.
          if ((e.data.user as AuthUser).github_username) setOauthConnected(true);
        }
        setOauthLoading(false);
        onGithubOAuthSuccessRef.current?.();
      } else if (e.data?.type === "github-oauth-error") {
        setOauthError((e.data.error as string | undefined) ?? "OAuth failed.");
        setOauthLoading(false);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleOAuthRedirect() {
    setOauthLoading(true);
    setOauthError(null);
    // Open the popup synchronously before any await so browsers allow it.
    // Then navigate it to the OAuth URL once the fetch resolves.
    const popup = window.open("", "github-oauth", "width=600,height=700,left=300,top=100");
    try {
      const url = await fetchGithubOAuthUrl();
      if (!url) throw new Error("Could not start GitHub OAuth.");
      if (popup) {
        popup.location.href = url;
      } else {
        throw new Error("Popup blocked. Please allow popups for this site and try again.");
      }
    } catch (err) {
      if (popup) popup.close();
      setOauthError(err instanceof Error ? err.message : "GitHub OAuth failed.");
      setOauthLoading(false);
    }
  }

  async function handleSaveAndRetry() {
    if (!inlineRepo.trim() || !onSaveAndRetryGitHub) return;
    setInlineSaving(true);
    setInlineError(null);
    try {
      await onSaveAndRetryGitHub(inlineRepo.trim());
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : "Failed. Please try again.");
    } finally {
      setInlineSaving(false);
    }
  }

  const isSuccess    = outcome === "SUCCESS";
  const isIncomplete = outcome === "INCOMPLETE";
  const isCancelled  = outcome === "CANCELLED";
  const color        = isSuccess ? "#22C55E" : (isIncomplete || isCancelled) ? "#EF4444" : "#F59E0B";

  // Merge prop + local flag so the modal transitions the moment OAuth succeeds,
  // without waiting for the parent prop to propagate through a render cycle.
  const effectiveGithubConnected = githubConnected || oauthConnected;

  // Per-agent cost breakdown
  const agentBreakdown = agents.map((a) => {
    const msgCount = messages.filter((m) => m.agentId === a.id && !m.isHuman && m.agentId !== "system").length;
    const sessionFee = agentRates[a.id] ?? 3;
    const costPerMsg = agentMsgRates[a.id] ?? 1;
    const variableCost = Math.round(msgCount * costPerMsg * 10) / 10;
    const total = Math.round((sessionFee + variableCost) * 10) / 10;
    return {
      agent: a,
      cluster: graphClusters.find((c) => c.id === a.clusterId),
      msgCount,
      sessionFee,
      costPerMsg,
      variableCost,
      total,
    };
  });
  const actualBase = Math.round(agentBreakdown.reduce((s, a) => s + a.total, 0) * 10) / 10;
  const alcFee = Math.round(actualBase * 0.03 * 10) / 10;

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
            ) : (isIncomplete || isCancelled) ? (
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={color}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M18.364 5.636a9 9 0 11-12.728 0M12 3v9" />
              </svg>
            ) : (
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={color}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            )}
          </div>
          <h2 className="text-xl font-bold text-al-text">
            {isSuccess ? "Session Completed" : isCancelled ? "Session Cancelled" : isIncomplete ? "Session Closed" : "Session Disputed"}
          </h2>
          <p className="text-sm text-al-muted mt-1 text-center">
            {isSuccess
              ? "All parties satisfied. Escrow released to contributors."
              : isCancelled
              ? "Session cancelled. You have been charged for work completed so far."
              : isIncomplete
              ? "Session closed due to agent failure. Full escrow returned to you."
              : "Dispute logged on-chain. Escalated to AgentLink arbitration."}
          </p>
        </div>

        {/* Reputation updates — real per-agent deltas when available */}
        {agents.length > 0 && !isIncomplete && (
          <div className="bg-al-bg rounded-xl border border-al-border p-4 mb-4">
            <p className="text-[10px] text-al-muted uppercase tracking-wider mb-3">Reputation Updates</p>
            <div className="space-y-3">
              {agents.map((agent) => {
                const upd = reputationUpdates?.[agent.id];
                const score = upd?.final_score ?? null;
                const scoreColor = score === null
                  ? (isSuccess ? "#22C55E" : "#EF4444")
                  : score > 3.5 ? "#22C55E" : score >= 2.5 ? "#F59E0B" : "#EF4444";
                const delta = upd?.delta;
                const deltaLabel = delta === undefined || delta === null
                  ? (score !== null ? "New ★" : isSuccess ? "+0.10" : "-0.10")
                  : delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);
                return (
                  <div key={agent.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-al-text">{agent.label}</span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: scoreColor }}>
                        {deltaLabel}
                      </span>
                    </div>
                    {upd && (
                      <div className="text-[10px] text-al-muted font-mono">
                        Peer: {upd.breakdown.peer_review.toFixed(2)} | Human: {upd.breakdown.human_rating.toFixed(2)} | Activity: {upd.breakdown.messages_contributed.toFixed(2)} | Role: {upd.breakdown.role_weight.toFixed(2)} = <span style={{ color: scoreColor }}>{score?.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Cost breakdown per agent — not shown for INCOMPLETE (no payments made) */}
        {agents.length > 0 && !isIncomplete && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 mb-4 overflow-hidden">
            <div className="px-4 py-2 border-b border-amber-400/15">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider font-bold">Cost Breakdown</p>
            </div>
            <div className="px-3 py-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 gap-y-1.5 items-center">
                <span className="text-[9px] text-al-muted uppercase tracking-wider">Agent</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">Msgs</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">Fixed</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">Msgs cost</span>
                <span className="text-[9px] text-al-muted uppercase tracking-wider text-right">Total</span>
                {agentBreakdown.map(({ agent, cluster, msgCount, sessionFee, variableCost, total }) => (
                  <>
                    <div key={`name-${agent.id}`} className="min-w-0">
                      <div className="text-[11px] text-al-text truncate">{agent.label}</div>
                      {cluster && (
                        <div className="text-[9px] font-semibold" style={{ color: cluster.color }}>{cluster.name}</div>
                      )}
                    </div>
                    <span key={`msgs-${agent.id}`} className="text-[11px] text-al-muted-2 tabular-nums text-right">{msgCount}</span>
                    <span key={`fee-${agent.id}`} className="text-[11px] text-al-muted-2 tabular-nums text-right">{sessionFee}</span>
                    <span key={`var-${agent.id}`} className="text-[11px] text-al-muted-2 tabular-nums text-right">{variableCost}</span>
                    <span key={`tot-${agent.id}`} className="text-[11px] font-semibold text-amber-400 tabular-nums text-right">{total}</span>
                  </>
                ))}
              </div>
            </div>
            <div className="border-t border-amber-400/15 px-3 py-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-al-muted">Subtotal</span>
                <span className="text-[11px] text-al-text tabular-nums">{actualBase} ALC</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-al-muted">AgentLink fee (3%)</span>
                <span className="text-[11px] text-al-muted tabular-nums">{alcFee} ALC</span>
              </div>
              <div className="flex items-center justify-between border-t border-amber-400/15 pt-1">
                <span className="text-[11px] font-bold text-amber-400">Total actual cost</span>
                <span className="text-[11px] font-bold text-amber-400 tabular-nums">{Math.round((actualBase + alcFee) * 10) / 10} ALC</span>
              </div>
            </div>
          </div>
        )}

        {/* Escrow settlement */}
        {sessionCost != null && (
          <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/5 overflow-hidden">
            <div className="px-4 py-2 border-b border-amber-400/15">
              <p className="text-[10px] text-amber-400 uppercase tracking-wider font-bold">Escrow Settlement</p>
            </div>
            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-al-muted">Maximum blocked</span>
                <span className="text-[11px] text-al-text tabular-nums">{sessionCost} ALC</span>
              </div>
              {actualCost != null && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-al-muted">Actual cost</span>
                  <span className="text-[11px] text-al-text tabular-nums">{actualCost} ALC</span>
                </div>
              )}
              {refundAmount != null && (
                <div className="flex items-center justify-between border-t border-amber-400/15 pt-1.5">
                  <span className="text-[11px] font-semibold text-green-400">Refund returned</span>
                  <span className="text-[11px] font-bold text-green-400 tabular-nums">+{refundAmount} ALC</span>
                </div>
              )}
            </div>
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
          {/* Already pushed */}
          {githubDeliveryUrl && (
            <a
              href={githubDeliveryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.45)", color: "#22C55E" }}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/>
              </svg>
              Pushed to GitHub — View Branch
            </a>
          )}
          {/* BUG A fix: connected + repo URL — push button with explicit no-arg call */}
          {!githubDeliveryUrl && onPushGitHub && outcome === "SUCCESS" && deliverable && (
            <button
              onClick={() => onPushGitHub()}
              disabled={githubPushing}
              className={`w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50${oauthConnected && !githubPushing ? " animate-pulse" : ""}`}
              style={oauthConnected && !githubPushing
                ? { background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.7)", color: "#22C55E", boxShadow: "0 0 14px rgba(34,197,94,0.3)" }
                : { background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.45)", color: "#8B5CF6" }
              }
            >
              {githubPushing ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              )}
              {githubPushTimedOut ? "Retry — Push to GitHub" : githubPushing ? "Pushing to GitHub…" : oauthConnected ? "GitHub connected — click to push" : "Push to GitHub"}
            </button>
          )}
          {/* Step 2: GitHub connected but no repo URL — enter repo to push */}
          {!githubDeliveryUrl && !onPushGitHub && effectiveGithubConnected && !githubRepoUrl && outcome === "SUCCESS" && deliverable && (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-al-muted">
                Enter a GitHub repo URL to push the deliverable:
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inlineRepo}
                  onChange={(e) => setInlineRepo(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  className="flex-1 bg-al-bg border border-al-border rounded-lg px-3 py-1.5 text-xs text-al-text placeholder:text-al-muted focus:outline-none focus:border-al-accent transition-colors"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveAndRetry(); }}
                />
                <button
                  onClick={handleSaveAndRetry}
                  disabled={inlineSaving || !inlineRepo.trim()}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                  style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.45)", color: "#8B5CF6" }}
                >
                  {inlineSaving ? "…" : "Save & Push"}
                </button>
              </div>
              {inlineError && <p className="text-[10px] text-red-400">{inlineError}</p>}
            </div>
          )}
          {/* Step 1: GitHub not connected — OAuth popup to connect account */}
          {!githubDeliveryUrl && !onPushGitHub && !effectiveGithubConnected && outcome === "SUCCESS" && deliverable && (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs text-al-muted">
                Connect your GitHub account to push the deliverable to your repo.
              </p>
              <button
                onClick={handleOAuthRedirect}
                disabled={oauthLoading}
                className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.45)", color: "#8B5CF6" }}
              >
                {oauthLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                )}
                {oauthLoading ? "Connecting…" : "Connect with GitHub"}
              </button>
              {oauthError && <p className="text-[10px] text-red-400">{oauthError}</p>}
            </div>
          )}
          {githubPushError && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-xs text-red-400">{githubPushError}</p>
            </div>
          )}
          {/* Merge branch to main — only shown for SUCCESS + branch strategy */}
          {outcome === "SUCCESS" && repoBranchStrategy === "branch" && repoBranch && !repoMerged && (
            <div className="flex flex-col gap-2">
              {showMergeConfirm ? (
                <div className="rounded-xl border border-red-500/35 bg-red-500/08 p-3 space-y-2">
                  <p className="text-xs text-red-400 font-semibold">Merge confirmation</p>
                  <p className="text-[10px] text-al-muted">
                    This will merge <span className="font-mono text-al-text">{repoBranch}</span> into main.
                    <strong className="text-red-400"> This cannot be undone.</strong>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onSetShowMergeConfirm?.(false)}
                      className="flex-1 py-1.5 rounded-lg text-xs text-al-muted border border-al-border hover:border-al-accent/40 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={onMergeToMain}
                      disabled={repoMerging}
                      className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                      style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.45)", color: "#EF4444" }}
                    >
                      {repoMerging ? "Merging…" : "Confirm merge"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => onSetShowMergeConfirm?.(true)}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                  style={{ background: "rgba(78,205,196,0.08)", border: "1px solid rgba(78,205,196,0.35)", color: "#4ECDC4" }}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.38.6.1.82-.26.82-.58v-2.17c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .1-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 013-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  Merge branch to main
                </button>
              )}
            </div>
          )}
          {repoMerged && (
            <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30">
              <p className="text-xs text-green-400">Branch merged to main successfully.</p>
            </div>
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
