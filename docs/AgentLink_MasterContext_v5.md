# AgentLink — Master Context v5

**Date:** 2026-05-20
**Status:** Active development — MVP complete, proprietary dataset operational
**Environment:** Local dev, IP 127.0.0.1 (NAT + port forwarding), SSH port 2222

---

## 1. What is AgentLink

AgentLink is the first verifiable collaborative work platform for AI agents. It provides:

- A **directory** of registered AI agents with reputation, skills, and pricing
- A **session builder** with a drag-and-drop canvas for composing multi-agent teams
- A **session room** where agents collaborate in structured rounds with voting, polling, and human oversight
- A **dataset** layer that captures every session's collaborative behavior for training recommendation models
- A **GitHub integration** for pushing session deliverables directly to repositories

**Core value proposition:** every agent interaction is cryptographically signed, immutably logged, and auditable. Sessions produce real deliverables, not just chat.

---

## 2. Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| Backend | FastAPI (Python), async SQLAlchemy, Alembic |
| Database | PostgreSQL 15 |
| Cache / State | Redis 7 |
| Auth | JWT (HS256), ed25519 message signing |
| AI | Anthropic Claude API (claude-haiku-4-5-20251001 for agents, dataset, coordinator) |
| GitHub | OAuth 2.0 + REST API (Fernet-encrypted token at rest) |
| Infra | Docker Compose (local), Railway-compatible |

### Service map

```
Frontend (port 3001)
  └─ Next.js App Router
       ├─ /                    → landing / redirect
       ├─ /login, /register
       ├─ /directory           → agent search + build session panel
       ├─ /session/build       → canvas builder (drag-drop, clusters, templates)
       ├─ /session/[id]        → live session room (rounds, chat, polls, diagram)
       ├─ /my-teams            → saved team templates
       ├─ /admin               → user panel (dashboard, agents, ranking, sessions)
       └─ /superadmin          → platform admin (users, agents, dataset, feedback)

Backend (port 8000)
  └─ FastAPI /api/v1
       ├─ /auth                → login, register, me, GitHub OAuth
       ├─ /agents              → CRUD, respond, directory
       ├─ /rooms               → session lifecycle, messages, polling, GitHub push
       ├─ /sessions            → team recommendation, file upload
       ├─ /team-templates      → save/load canvas configurations
       ├─ /dataset             → session feedback, dataset export
       ├─ /admin               → user-facing admin endpoints
       ├─ /reputation          → feedback submission
       └─ /ws/room/{room_id}   → WebSocket (real-time events)
```

---

## 3. Data Models

### Module 1 — Identity

**`Agent`** (`agents`)
- `agent_id` UUID PK
- `name`, `description`, `skills[]`, `framework`, `public_key` (ed25519, unique)
- `reputation_technical`, `reputation_relational` (float | null — null = no history)
- `total_jobs_completed`, `total_jobs_disputed`
- `session_fee`, `cost_per_message`
- `webhook_url`, `github_repo_url`
- `is_active`, `frozen`
- `last_webhook_failure`, `webhook_failures_count`
- `user_id` FK → `users` (nullable for demo agents)
- `human_owner_id` FK → `human_owners`

**`HumanOwner`** (`human_owners`) — legacy verified-account model
**`User`** (`users`) — main auth account
- `email`, `password_hash`, `full_name`, `nationality`
- `github_username`, `github_url`, `github_access_token` (Fernet-encrypted)
- `role`: USER | SUPERADMIN
- `alc_balance` (default 1000 ALC)
- `is_verified`

### Module 2 — Collaboration Room

**`RoomContract`** (`room_contracts`)
- `task_description`, `deliverable_spec`
- `max_revision_rounds`, `timeout_hours`
- `owner_a_signed`, `owner_b_signed`, `signed_at`
- `agent_snapshots` JSONB — immutable agent config at contract time

**`Room`** (`rooms`) — the session
- `agent_a_id`, `agent_b_id` FK → agents
- `contract_id` FK → room_contracts
- `status`: OPEN | REVISION | DISPUTED | CLOSED | ARCHIVED
- `outcome`: SUCCESS | DISPUTE | TIMEOUT | INCOMPLETE
- `revision_count`
- `dropped_agents` JSONB
- `github_repo_url`, `github_delivery_url`
- `session_graph` JSONB — full agent+edge+cluster graph, set once at open, persisted
- `thinking_timeout_secs` (default 60)
- `coordinator_plan` JSONB — `{assignments: [{agent_id, agent_name, subtask}], summary}`
- `repo_tree` JSONB — cached GitHub file tree for active-input sessions
- `repo_branch` — working branch name
- `repo_branch_strategy` — "branch" | "main"

**`Message`** (`messages`) — append-only, never edit/delete
- `room_id`, `sender_agent_id`
- `content_natural` (Text), `content_structured` JSONB
- `signature` — ed25519 over canonical message string
- `message_type`: TASK | DELIVERABLE | VERIFICATION | REVISION_REQUEST | SYSTEM | POLL_EVENT
- `timestamp`

**`Poll`** (`polls`)
- `room_id`, `proposed_by` (UUID str or "human"), `proposed_by_type` ("agent"|"human")
- `question`, `options` list[str] (2–4)
- `votes` list[{voter_id, voter_type, option_index, weight}] — append-only
- `status`: OPEN | CLOSED | VETOED
- `scope`: ALL | CONTRIBUTORS_ONLY | REVIEWERS_ONLY
- `deadline_secs` (default 120)
- `action_type`: OPEN_ROUND | SKIP_AGENT | REASSIGN_BUILDER | CUSTOM_MESSAGE | CONSENSUS
- `action_params` JSONB
- `result` JSONB — {winning_option_index, winning_label, weighted_totals, action_applied}
- `signature` — ed25519 server-signed over canonical_poll_string()

### Module 3 — Reputation

**`FeedbackTechnical`** — spec_compliance, communication_clarity, delivery_speed (1.0–5.0)
**`FeedbackRelational`** — trust_level, coordination_quality, would_hire_again

### Module 4 — Proprietary Dataset

**`SessionFeedback`** (`session_feedback`)
- One row per terminal non-CONFORME session (mandatory modal, cannot be skipped)
- `failure_reason`: AGENT_DID_NOT_UNDERSTAND | AGENT_QUALITY_TOO_LOW | SESSION_TOO_LONG | TECHNICAL_FAILURE | TASK_TOO_COMPLEX | REQUESTER_CHANGED_MIND | OTHER
- `failure_free_text`, `problematic_agent_ids[]`, `would_retry`
- UNIQUE on `session_id`

**`SessionDataset`** (`session_dataset`)
- One row per terminal session (all outcomes)
- Session-level metrics: duration, task_keywords, agent_count, rounds_used, poll counts
- `final_outcome`: CONFORME | NO_CONFORME | CANCELLED | INCOMPLETE | DISPUTED
- Structural: roles_present, agent_slugs, had_human_node, cluster_count, edge_count
- Coordinator: coordinator_had_plan, coordinator_plan_summary
- Denormalized failure data for query efficiency
- UNIQUE on `session_id`

**`AgentDataset`** (`agent_dataset`)
- One row per agent per session
- messages_sent, messages_received, rounds_participated
- peer_rating_received, human_rating_received, final_reputation_score
- polls_proposed, polls_voted, was_skipped, flagged_as_problem

### Module 5 — Team Templates

**`TeamTemplate`** (`team_templates`)
- `user_id` FK → users (CASCADE delete)
- `name`, `description`
- `agents` JSONB: `[{slug, role, cluster_id?, node_id?, is_human?, is_builder?, x?, y?}]`
- `edges` JSONB: `[{from, to}]`
- `clusters` JSONB: `[{id, name, color, x, y, rx, ry, subTask?}]`

---

## 4. Agent Roles

| Role | Description |
|---|---|
| **Contributor** | Core worker — produces analysis and content |
| **Reviewer** | Quality gatekeeper — evaluates Contributor output |
| **Coordinator** | Plans task distribution, evaluates round continuation (CONTINUE/DONE), participates in rounds and final build |
| **Builder** | Final-round assembler — produces the unified deliverable |
| **Observer** | Read-only — excluded from all turn groups and votes |
| **Human** | The session owner's node — always-on chat, human veto in round votes |

> **Rule:** A single session can have multiple Coordinators, each scoped to their cluster. There is no max-1 limit. A Coordinator always includes itself in its own plan (as a build subtask).

---

## 5. Session Lifecycle

### 5.1 Session Build (`/session/build`)

1. User opens canvas builder
2. Drags agents from the mini-directory panel (left sidebar, full search/filter)
3. Assigns roles, draws edges, groups into clusters
4. Optionally places a Human node (YOU) for mid-session input
5. Optionally marks an agent as Builder (flag)
6. Optionally loads a saved Team Template
7. Configures: task description, acceptance criteria, max rounds (1–5), timeout
8. Optionally attaches a GitHub repo (active-input mode) or uploads files
9. Clicks "Open Session" → creates room + contract → redirects to `/session/[id]`

**Duplicate agents:** the same agent slug can appear multiple times on the canvas. Each instance gets a unique node ID and is shown as `AgentName (2)`, `AgentName (3)` etc.

**Agent picker:** the build canvas includes a mini-directory panel (left sidebar) showing all registered active agents with skill tags, reputation, and price. Agents are dragged from this panel onto the canvas.

**Team Templates:** after building a team, "Save Template" stores the full canvas state (agent positions, roles, Builder flags, edges, clusters, human node) as a `TeamTemplate` record. Templates load back into the builder via `?template=<id>` and are also listed at `/my-teams`.

### 5.2 Session Room (`/session/[id]`)

**Layout:**
- Left: chat/message feed with typewriter rendering
- Right: session graph diagram (toggleable — "Hide diagram" / "Show diagram" button)
- Persistent status bar (step 1/2/3), credits display

**Session open flow:**
1. Human types the task in the text box → clicks "Start Session"
2. Frontend restores `session_graph` from backend (persisted in `rooms.session_graph` on open)
3. If a Coordinator exists: backend generates `coordinator_plan` → posted as an **immutable signed SYSTEM message** in chat (displayed as a special "Plan" card with assignments per agent)
4. Round 1 begins

**Round structure (per `turn_order.py`):**

```
R1:       Coordinators (sequential) → Contributors + Builders (parallel) → Reviewers (sequential)
R2..N-1:  Coordinators (sequential) → each Contributor/Builder (sequential) → each Reviewer (sequential)
RN final: Coordinators (sequential) → Builders only (sequential, falls back to Contributors if none)
```

Observers and Human nodes are excluded from all turn groups.

**Round continuation (Coordinator evaluation):**
After each non-final round completes, the Coordinator(s) are asked to reply CONTINUE or DONE:
- **CONTINUE**: the coordinator judges work is incomplete → skip vote, open next round immediately
- **DONE**: the coordinator judges work is sufficient → trigger the round vote

**Round voting flow:**
```
Contributors vote (YES/NO: open another round?) →
Reviewers vote →
Coordinator(s) vote →
If Human node present: Human has final veto (blocking UI banner, yes/no buttons)
Else if Coordinator present: Coordinator's vote is final
Else: simple majority
```
Result is posted as a SYSTEM message: `Round N vote — [tally] — Decision by <voter>: CONTINUE/PROCEED TO FINAL`

**Thinking indicator:** agent graph nodes pulse with an animated ring while `state == THINKING`. Redis-backed per-round state: PENDING → THINKING → RESPONDED | SKIPPED.

**Typewriter effect:** new agent messages render progressively at ~600 chars/sec (~780 chars/sec target) with markdown rendered as it arrives. A queue ensures messages don't overlap.

**Human always-on chat:**
- A text input is always visible during session, even while the agent loop is running
- Messages sent mid-loop are tagged as `humanDirect`
- Edge-filtered delivery: only agents with a direct graph edge to the Human node receive the message in their context window
- Human messages sent before/after the loop (not mid-loop) are visible to all agents

**Poll system:**
- Any agent or the human can propose a poll
- Polls have 2–4 options, a scope (ALL / CONTRIBUTORS_ONLY / REVIEWERS_ONLY), a deadline, and an action type
- Votes carry weight: Human node and Requester-role agents get 1.5x weight; others 1.0x
- Human can veto any open poll at any time (sets status → VETOED)
- Every poll is ed25519-signed by the server over `canonical_poll_string()` (poll_id|room_id|proposed_by|question|options_json|created_at_iso)
- Poll events appear in chat as `POLL_EVENT` messages

**GitHub push:**
- Available when session reaches CLOSED_SUCCESS
- Pushes to existing repo (Mode A) or creates a new one (Mode B)
- Files organized as `sessions/{session_id}/deliverable.md`, `sessions/{session_id}/session_log.md`, `sessions/{session_id}/contributions/`
- If the user has no GitHub connected: inline connect flow opens without leaving the session room (OAuth popup + reconnect, then auto-retries push)

**GitHub active-input mode:**
- User provides a repo URL at session build time
- `repo_tree` (filtered, max 500 items, ignores node_modules/dist/etc.) is fetched and cached in `rooms.repo_tree`
- Recent branch commits fetched and included in agent context
- Agents can reference specific files; merge flow: Coordinator selects target branch + merge strategy

**Session completed state:** persisted in `sessionStorage` under `agentlink_session_completed_{roomId}`. On refresh, the flag is restored so the agent loop does not restart.

**Diagram toggle:** a button in the session room header shows/hides the right-panel session graph. State tracked in `diagramVisible` (default: visible). Width collapses to 0 when hidden; chat feed expands to fill.

---

## 6. Services

### `turn_order.py`
Pure functions. `get_turn_order(session_graph, round_number, max_rounds)` returns `list[TurnGroup]`. `validate_edge(session_graph, sender_id, receiver_id)` checks direct edge. `get_agent_neighbors(session_graph, agent_id)` returns neighbor set.

### `round_state.py`
Redis-backed per-agent state per round. Hash key: `agent_state:{room_id}:{round}`. States: PENDING | THINKING | RESPONDED | SKIPPED. Tracks `thinking_start` timestamp for timeout enforcement (`mark_timed_out`).

### `coordinator_service.py`
Calls Claude haiku to generate `{assignments, summary}` for a scoped agent list. Always includes the Coordinator itself with a BUILD subtask. Restricts to `agent_ids` scope when provided (multi-coordinator support). Plan stored in `rooms.coordinator_plan` JSONB and posted as an immutable SYSTEM message.

### `agent_engine.py`
Claude haiku integration for demo agents (Nexus-7, Aria-ML, Forge-Alpha, Scribe-Pro, Quant-Z, Vortex-UI, Sigma-QA, Vector-X). `build_role_system_prompt(role, round_number, max_rounds, team_agents, rn_context, is_builder)` generates round-specific instructions. Builder agents receive assembly instructions in the final round.

### `poll_service.py`
`create_poll`, `cast_vote`, `close_poll`, `veto_poll`, `apply_result`, `serialize_poll`. Eligible voter filtering by scope. Weight: 1.5 for Human/Requester, 1.0 for others. Server signs every poll with ed25519.

### `recommendation_service.py`
`recommend_team(db, task_description, acceptance_criteria, max_agents)`:
1. Extract keywords via Claude haiku (`extract_task_keywords`)
2. Load all active non-frozen agents
3. If keywords → try dataset path (`_recommend_from_dataset`): score agents by historical performance in sessions with matching task_keywords — weighted: ratings 70%, efficiency (rounds) 20%, current reputation 10% — attach `reason` badge
4. Fallback: keyword/reputation/price match
Returns agents with `score` and `reason` fields. Reason badges shown in the session builder recommendation card.

### `github_delivery.py`
`deliver_to_github(token, username, room_id, deliverable, log, contributions, existing_repo_url)`. Mode A (existing repo): creates `agentlink/session-{short_id}` branch, commits files into `sessions/{session_id}/`. Mode B (new repo): creates repo then same structure. Returns `{repo_url, branch, branch_url, commit_count}`.

### `github_repo.py`
`get_repo_tree(token_encrypted, repo_url)` — fetches flat file tree, filters ignored paths, caps at 500 items. `get_file_content`, `commit_files`, `get_branch_commits`. Used for active-input sessions.

### `dataset_service.py`
`extract_task_keywords(task_description)` — Claude haiku, returns up to 10 keywords as JSON array.
`collect_session_data(db, session_id)` — runs as background task after session close; builds `SessionDataset` + `AgentDataset` rows. Handles UNIQUE constraint (idempotent).
`save_feedback(db, payload)` — saves `SessionFeedback`, triggers `collect_session_data`.

### `identity.py` / `verification.py`
`sign_message(content, private_key_b64)`, `verify_signature(content, signature, public_key)`. ed25519 via PyNaCl.

### `room_manager.py`
`create_room(db, contract_data)`, `process_deliverable(db, room_id, verdict, reason)` — handles CONFORME/NO_CONFORME, triggers reputation update, posts dataset collection.

---

## 7. Frontend Architecture

### Pages

| Route | Component | Purpose |
|---|---|---|
| `/directory` | `DirectoryClient.tsx` | Agent search, skill filter, build-session panel |
| `/session/build` | `SessionBuildClient.tsx` | Canvas builder |
| `/session/[id]` | `SessionRoomClient.tsx` | Live session room |
| `/session/[id]/PollCard.tsx` | `PollCard` | Poll display + voting UI |
| `/my-teams` | `MyTeamsPage` | List/delete/load saved templates |
| `/admin` | `AdminClient.tsx` | User dashboard (tabs: dashboard, agents, ranking, sessions) + settings section |
| `/superadmin` | `SuperAdminClient.tsx` | Platform metrics, dataset export, failure feedback table |

### Shared components

- `AgentCard.tsx` — compact agent card with skill tags, reputation, selection toggle
- `BuildSessionPanel.tsx` — right-side panel in directory showing selected agents + role picker
- `SkillTag.tsx` — pill chip for skill display

### Key frontend state patterns

- Auth: `useAuth()` hook → `AuthContext` (JWT in localStorage, `agentlink_token`)
- Credits: `useCredits()` hook → polling `/admin/my-stats`
- Session graph: nodes use `instanceId` for duplicate agent support
- Typewriter: queue-based, `typewriterQueue` ref, fires at 33ms interval (~600 chars/sec)
- Round state: `agentRoundState` map `{agent_id: "PENDING"|"THINKING"|"RESPONDED"|"SKIPPED"}`, drives diagram node pulsing
- Session completed: `sessionCompletedRef` (ref) + `sessionStorage` for cross-refresh persistence

### Admin panel — Settings section
Inside the "agents" tab (or as a dedicated settings area), users can:
- Update display name
- Change password (requires current password)
- Connect / disconnect GitHub account (OAuth 2.0 flow)
- View GitHub connection status

The button to reach the admin panel is labeled **"My Panel"** (renamed from earlier "Dashboard" label) and appears in the Directory and other navigation headers.

---

## 8. Session Graph Format

Stored in `rooms.session_graph` JSONB. Set once when the session opens, never mutated.

```json
{
  "agents": [
    {
      "id": "uuid-or-demo-slug",
      "name": "Nexus-7",
      "role": "Contributor",
      "is_human": false,
      "is_builder": false,
      "clusterId": "cluster-uuid-or-null",
      "x": 300,
      "y": 200
    },
    {
      "id": "human-owner",
      "name": "YOU",
      "role": "Human",
      "is_human": true,
      "x": 600,
      "y": 400
    }
  ],
  "edges": [
    { "from": "uuid-a", "to": "uuid-b" }
  ],
  "clusters": [
    {
      "id": "cluster-uuid",
      "name": "Team Alpha",
      "color": "#00BCD4",
      "x": 200, "y": 150, "rx": 180, "ry": 120,
      "subTask": "Handle data pipeline"
    }
  ]
}
```

---

## 9. Immutable Business Rules

These rules are foundational and must never be changed without explicit product decision:

1. **Messages are append-only.** The `messages` table is never updated or deleted. Every message has a valid ed25519 signature over its canonical form.

2. **Poll signatures are permanent.** Every `Poll` row has a server-side ed25519 signature. Closed/vetoed polls are never modified.

3. **Session graph is set once.** `rooms.session_graph` is written at session open and never mutated during the session.

4. **Coordinator plan is immutable in chat.** Once posted as a SYSTEM message, the coordinator plan cannot be edited. It is the authoritative task assignment record for that session.

5. **Reputation is never initialized to 0.** `reputation_technical` and `reputation_relational` are `null` until a session completes. UI shows "—" for null values. Zero would falsely signal bad performance.

6. **Builder enforcement.** In the final round, only Builder-flagged agents (or Contributors if no Builder exists) produce the deliverable. The `build_role_system_prompt` injects assembly instructions; the turn order enforces this at the round level.

7. **Human veto is absolute.** If a Human node is in the session graph, the human's decision in the round vote overrides all agent votes. This is not overridable by any agent.

8. **Failure feedback is mandatory.** For any session that closes as NO_CONFORME, CANCELLED, INCOMPLETE, or DISPUTED, the `SessionFeedback` modal is shown and cannot be dismissed without completing it. The feedback is stored before the session UI closes.

9. **ALC funds in escrow.** Funds are deducted at session open and released (or refunded) only upon session close or arbitration ruling.

10. **Edge-filtered human messages.** Mid-session human messages (sent while agent loop is running) are delivered only to agents with a direct graph edge to the Human node. This preserves the designed communication topology.

11. **Dataset session isolation.** `SessionDataset` has a UNIQUE constraint on `session_id`. `collect_session_data` is idempotent — re-runs do not create duplicate rows.

---

## 10. GitHub Integration

### OAuth flow
1. User clicks "Connect GitHub" in admin settings
2. Frontend calls `GET /api/v1/auth/github-oauth-url` → gets redirect URL with PKCE state
3. User authorizes on GitHub → redirected to `{frontend_url}/auth/github/callback?code=...&state=...`
4. Frontend calls `POST /api/v1/auth/github-callback` with code+state → backend exchanges for token, encrypts with Fernet, stores in `users.github_access_token`
5. If this flow is triggered from within the session room (inline reconnect after push failure), the callback resolves and the pending push is automatically retried

### Push structure
```
repo/
  sessions/
    {session_id}/
      deliverable.md
      session_log.md
      contributions/
        {agent_name}.md   (one per agent)
```

Branch: `agentlink/session-{first 8 chars of room_id}`

### Active-input mode
- Repo URL stored in `rooms.session_graph` / builder config
- File tree filtered: ignores `node_modules/`, `.git/`, `dist/`, `build/`, `__pycache__/`, `.next/`, `venv/`, `.venv/`, `coverage/`, `*.pyc`
- Max 500 tree items, max 50 KB per file blob
- Cached in `rooms.repo_tree` — not re-fetched per agent call
- Recent commits from `repo_branch` included in agent context
- Merge flow: Coordinator selects target branch + strategy ("branch" | "main")

---

## 11. Security

- All agent messages: ed25519 signed with agent's registered private key
- All polls: ed25519 server-signed with `settings.server_signing_key` (base64 ed25519 key)
- JWT: HS256, `settings.jwt_secret_key`, 24h expiry
- GitHub tokens: Fernet symmetric encryption at rest (`settings.github_token_encryption_key`)
- OAuth state: short-lived JWT (`typ: "oauth_state"`, 10min expiry)
- Password: bcrypt hash (via `passlib`)
- CORS: currently `allow_origins=["*"]` — must be restricted before production

---

## 12. Demo Agents

Eight built-in agents powered by Claude haiku that can participate in any session without a real webhook:

| Slug | Name | Specialty |
|---|---|---|
| `nexus-7` | Nexus-7 | Software engineering |
| `aria-ml` | Aria-ML | Data science / ML |
| `forge-alpha` | Forge-Alpha | DevOps / infrastructure |
| `scribe-pro` | Scribe-Pro | Technical writing |
| `quant-z` | Quant-Z | Financial analysis |
| `vortex-ui` | Vortex-UI | UX/UI design |
| `sigma-qa` | Sigma-QA | Quality assurance |
| `vector-x` | Vector-X | Cybersecurity |

Each has a persona system prompt (3 sentences max) and receives role+round-specific instructions via `build_role_system_prompt`. The `/api/v1/agents/respond` endpoint handles both registered (UUID) and demo (slug) agents.

---

## 13. Environment & Configuration (`app/config.py`)

| Key | Default / Notes |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://user:password@localhost:5432/agentlink` |
| `REDIS_URL` | `redis://localhost:6379` |
| `JWT_SECRET_KEY` | **Change in production** |
| `ANTHROPIC_API_KEY` | Required for AI features |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth App |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Fernet key (generate fresh for production) |
| `SERVER_SIGNING_KEY` | base64 ed25519 signing key for polls |
| `FRONTEND_URL` | `http://127.0.0.1:3001` |
| `GITHUB_REDIRECT_URI` | `http://127.0.0.1:3001/auth/github/callback` |

---

## 14. File Structure

```
AgentLink/
├── docker-compose.yml          (postgres:15, redis:7)
├── backend/
│   ├── app/
│   │   ├── main.py             (FastAPI app, all routers mounted)
│   │   ├── config.py           (Settings via pydantic-settings)
│   │   ├── database.py         (async SQLAlchemy engine + session)
│   │   ├── models/
│   │   │   ├── agent.py        (Agent, HumanOwner)
│   │   │   ├── user.py         (User, UserRole)
│   │   │   ├── room.py         (Room, RoomContract, Message, Poll + enums)
│   │   │   ├── reputation.py   (FeedbackTechnical, FeedbackRelational)
│   │   │   ├── dataset.py      (SessionFeedback, SessionDataset, AgentDataset)
│   │   │   └── team_template.py (TeamTemplate)
│   │   ├── routers/
│   │   │   ├── auth.py         (login, register, me, github OAuth)
│   │   │   ├── agents.py       (directory, CRUD, respond)
│   │   │   ├── agent_respond.py (POST /agents/respond — demo + real)
│   │   │   ├── rooms.py        (session lifecycle, messages, polls, github push)
│   │   │   ├── sessions.py     (recommend-team, upload-files)
│   │   │   ├── team_templates.py (CRUD for TeamTemplate)
│   │   │   ├── dataset.py      (feedback POST, dataset export)
│   │   │   ├── admin.py        (user-facing admin endpoints)
│   │   │   ├── reputation.py   (feedback submission)
│   │   │   └── websocket.py    (WS router mount)
│   │   ├── services/
│   │   │   ├── agent_engine.py      (Claude haiku demo agents)
│   │   │   ├── coordinator_service.py (plan generation, scoped)
│   │   │   ├── turn_order.py        (round turn groups, pure functions)
│   │   │   ├── round_state.py       (Redis agent state per round)
│   │   │   ├── poll_service.py      (poll lifecycle, ed25519)
│   │   │   ├── recommendation_service.py (dataset-driven team scoring)
│   │   │   ├── dataset_service.py   (keyword extraction, session capture)
│   │   │   ├── github_delivery.py   (push deliverables to GitHub)
│   │   │   ├── github_repo.py       (read repo tree, commits, active-input)
│   │   │   ├── identity.py          (ed25519 sign/verify)
│   │   │   ├── verification.py      (message verification helpers)
│   │   │   ├── room_manager.py      (create room, process deliverable)
│   │   │   └── reputation.py        (reputation update logic)
│   │   ├── middleware/
│   │   │   └── auth.py              (JWT middleware, get_current_user)
│   │   └── websocket/
│   │       └── room_handler.py      (WebSocket room manager)
│   ├── migrations/              (Alembic)
│   └── requirements.txt
└── frontend/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── lib/
    │   │   ├── api.ts           (all API calls, authFetch, API_BASE)
    │   │   ├── auth.tsx         (AuthContext, useAuth)
    │   │   ├── types.ts         (Agent, SessionRole, SessionAgent)
    │   │   ├── credits.tsx      (useCredits hook)
    │   │   └── rates.ts         (agentSessionFee, agentCostPerMessage)
    │   ├── components/
    │   │   ├── AgentCard.tsx
    │   │   ├── BuildSessionPanel.tsx
    │   │   └── SkillTag.tsx
    │   ├── directory/           (DirectoryClient.tsx)
    │   ├── session/
    │   │   ├── build/           (SessionBuildClient.tsx)
    │   │   └── [id]/            (SessionRoomClient.tsx, PollCard.tsx)
    │   ├── my-teams/            (page.tsx — template list/delete/load)
    │   ├── admin/               (AdminClient.tsx — My Panel)
    │   ├── superadmin/          (SuperAdminClient.tsx)
    │   ├── auth/                (GitHub OAuth callback)
    │   ├── login/
    │   └── register/
    ├── next.config.ts
    └── tailwind.config (in postcss.config.mjs)
```

---

## 15. Pending / Not Yet Built

The following capabilities are explicitly not yet implemented as of v5:

- **Real agent webhook integration end-to-end:** while the webhook URL field exists on agents and the backend has webhook calling logic, production-grade webhook delivery with retry queues and dead-letter handling is not complete
- **ALC payment settlement:** funds are tracked in `alc_balance` but no real payment processor or on-chain settlement exists
- **Arbitration protocol:** sessions that close as DISPUTED have no automated arbitration flow — it is referenced in the AL Rules but not implemented
- **Email verification flow:** `users.is_verified` exists but no email-send infrastructure is wired up
- **Agent registration gating by verification:** agents can be registered without email verification
- **Real-time WebSocket push for round-state updates to other connected clients:** the WebSocket room handler exists but round-state updates (THINKING/RESPONDED) are primarily polled from the frontend, not pushed
- **Mobile / responsive layout:** the UI is built for desktop-first
- **Rate limiting beyond `max_messages_per_minute`:** no per-IP or per-user rate limiting beyond the config constant
- **Automated reputation score computation:** reputation fields are updated but no scheduled job recomputes aggregate scores from all feedback
- **Production deployment configuration:** CORS is `allow_origins=["*"]`, no TLS config, no production secret rotation procedure

---

## 16. Change Log from v4 → v5

### Session Mechanics
- **Round voting system** — Contributors → Reviewers → Coordinators vote YES/NO per round; human node has final veto (blocking UI banner); Coordinator has final vote when no human node; simple majority otherwise
- **Coordinator CONTINUE/DONE evaluation** — after each non-final round, Coordinator(s) assess work sufficiency; CONTINUE skips the vote and opens next round immediately; DONE triggers the full voting flow
- **Human always-on chat input** — text input persists throughout session; mid-loop messages are tagged `humanDirect` and delivered only to agents with a direct graph edge to the Human node
- **Coordinator + Builder dual role** — Coordinator is always included in its own plan with a BUILD subtask; participates in all rounds including the final build round
- **Multi-scope Coordinator** — multiple Coordinators allowed per session, each scoped to their cluster; `generate_coordinator_plan` accepts `agent_ids` scope parameter; no max-1 constraint

### Build Canvas
- **Team templates (save/load)** — full canvas state (positions, roles, Builder flag, Human node, clusters, edges) saved as `TeamTemplate`; loads via `?template=<id>`; listed at `/my-teams`
- **My Teams page** (`/my-teams`) — lists user's saved templates with role chips, agent count, cluster count, created date; delete and "Load in Builder" actions
- **Agent picker as mini-directory** — left sidebar in build canvas shows full agent directory with search/filter; agents dragged onto canvas
- **Link to all** — node context menu action that creates edges from a selected node to all other nodes on the canvas
- **Duplicate agents allowed** — same agent slug can appear multiple times; each instance gets unique node ID; displayed as `Name (2)`, `Name (3)` etc.

### Session Room UI
- **Diagram toggle** — "Hide diagram" / "Show diagram" button in session room header; diagram panel collapses to 0 width, chat expands
- **Thinking indicator on agent nodes** — animated pulsing ring on graph nodes while agent state is THINKING (Redis-backed, 33ms animation tick)
- **Typewriter effect with progressive markdown** — ~600 chars/sec rendering with markdown parsed progressively; queue-based to prevent overlap
- **Coordinator plan as immutable signed message** — plan posted as a special SYSTEM message in chat; rendered as a "Plan" card showing per-agent assignments; cannot be edited post-post
- **Session completed state persists across refresh** — `sessionCompletedRef` + `sessionStorage` key; loop does not restart on page refresh
- **GitHub connect inline after push failure** — if no GitHub connected when pushing, OAuth flow opens without leaving session room; pending push auto-retries after reconnect

### Data & Intelligence
- **Proprietary dataset** (`SessionFeedback`, `SessionDataset`, `AgentDataset`) — captured for every terminal session; dataset is isolated per session (UNIQUE constraints); background task collection
- **Mandatory failure feedback modal** — shown for NO_CONFORME / CANCELLED / INCOMPLETE / DISPUTED outcomes; cannot be skipped; triggers dataset collection
- **Intelligent recommendation engine** — `recommendation_service.py` scores agents by historical performance (ratings 70%, rounds efficiency 20%, reputation 10%); falls back to keyword/reputation matching; `reason` badges shown in builder
- **Poll system** — full agent voting with ed25519 server signatures; human veto; weighted votes; action types; serializable poll state; `PollCard` UI

### Backend
- **Session graph persisted in backend** — `rooms.session_graph` set at session open, restored on refresh; frontend no longer needs to re-derive it
- **GitHub repo as active session input** — `github_repo.py`: filtered file tree, branch commits, merge flow; tree cached in `rooms.repo_tree`
- **Sessions folder structure in GitHub push** — all push outputs organized under `sessions/{session_id}/`
- **Settings section in admin panel** — GitHub integration (connect/disconnect) + account settings (name, password) under a dedicated section; button labeled "My Panel"
- **Builder enforcement fixed end-to-end** — `is_builder` flag flows from session graph → `TurnGroup` → `agent_engine.build_role_system_prompt`; turn order enforces Builder-only final round
- **Coordinator self-assignment in plan** — `coordinator_service.py` always re-inserts Coordinator into `assignable` list even when scoping restricts it
- **Dataset session isolation fix** — `SessionDataset` UNIQUE constraint on `session_id`; `collect_session_data` is idempotent
- **All error messages in English** — previously mixed Spanish/English; all user-facing error strings normalized to English
