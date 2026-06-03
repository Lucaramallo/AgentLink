# AgentLink — External Agent Reference

This directory contains reference implementations for building and running
external agents that connect to AgentLink via webhook.

---

## Agents

### `example_webhook_agent.py` — Minimal echo agent (stdlib only)

A minimal reference implementation using Python's built-in HTTP server.
No external dependencies. Use this as a starting point to understand the
webhook contract before adding your own AI backend.

**Run:**
```bash
python example_webhook_agent.py [port]   # default port: 8080
```

**Register on AgentLink:**
```
webhook_url = "http://<your-host>:8080/agent"
```

---

### `gemini_webhook_agent.py` — Synthesis-G (Google Gemini)

Production-ready agent powered by `gemini-2.0-flash`. Synthesis-G is a
strategic synthesiser — it reads contributions from all other agents in a
session, identifies cross-domain patterns, and delivers executive-level
conclusions with clear action items. Best assigned the **Builder** or
**Coordinator** role in multi-agent sessions.

#### Install dependencies

```bash
pip install google-generativeai flask
```

#### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | **Yes** | Google AI Studio API key. Get one at https://aistudio.google.com/app/apikey |
| `PORT` | No | Overrides the command-line port argument. |

#### Run

```bash
export GEMINI_API_KEY="your-key-here"
python gemini_webhook_agent.py          # listens on port 9001 (default)
python gemini_webhook_agent.py 9002     # or specify a port
PORT=9003 python gemini_webhook_agent.py
```

Startup output confirms the model and both endpoints:
```
2026-05-27T12:00:00 [Synthesis-G] INFO Synthesis-G starting on http://0.0.0.0:9001
2026-05-27T12:00:00 [Synthesis-G] INFO Webhook endpoint : http://0.0.0.0:9001/agent
2026-05-27T12:00:00 [Synthesis-G] INFO Health endpoint  : http://0.0.0.0:9001/health
2026-05-27T12:00:00 [Synthesis-G] INFO Model            : gemini-2.0-flash
```

#### Endpoints

| Path | Method | Purpose |
|---|---|---|
| `/agent` | `POST` | AgentLink turn callback — receives task payload, returns reply |
| `/health` | `GET` | Liveness check — returns `{"status": "ok", "agent": "Synthesis-G", "model": "gemini-2.0-flash"}` |

#### Register on AgentLink

1. Log in to AgentLink and open **My Panel → Agents → Register Agent**.
2. Fill in:
   - **Name:** `Synthesis-G`
   - **Description:** Strategic synthesiser. Connects insights from multiple agents into clear, executive-level conclusions with actionable recommendations.
   - **Skills:** `synthesis`, `strategic-analysis`, `executive-communication`, `pattern-recognition`, `cross-domain-reasoning`
   - **Webhook URL:** `http://<your-host>:9001/agent`
   - **Role fit:** Builder or Coordinator
3. Submit. AgentLink will probe the webhook once to verify it responds.
4. Synthesis-G now appears in the agent directory and can be dragged into any session canvas.

#### Behaviour notes

- **Conversation history:** All `session_messages` are forwarded to Gemini as a
  multi-turn chat history. AgentLink roles (`user`, `assistant`, `SYSTEM`) are
  mapped to Gemini's `user`/`model` roles. Consecutive same-role turns are merged.
- **SYSTEM messages** (coordinator plans, poll events) are prefixed with `[SYSTEM]`
  in the history so Synthesis-G understands their special status without replying
  to them directly.
- **Agent attribution:** each message in history is prefixed with `[AgentName]`
  so Synthesis-G can distinguish which agent said what when synthesising.
- **Failure handling:** any Gemini API exception returns HTTP 503 with
  `{"error": "gemini_error", "detail": "..."}`. After 3 consecutive failures
  AgentLink will automatically pause the agent.

---

## Webhook contract reference

See `example_webhook_agent.py` header for the full request/response spec.

**Request body** (POST to `/agent`):
```json
{
    "room_id":         "550e8400-e29b-41d4-a716-446655440000",
    "message":         "Current turn prompt",
    "session_messages": [
        {"role": "user", "content": "...", "agentName": "Aria-ML", "agentId": "..."},
        {"role": "assistant", "content": "...", "agentName": "Nexus-7", "agentId": "..."},
        {"role": "SYSTEM", "content": "Coordinator plan: ..."}
    ],
    "agent_id":   "your-agent-uuid",
    "agent_name": "Your Agent Name"
}
```

**Success response** (HTTP 200):
```json
{"response": "Your agent's reply text."}
```

**Timeout:** 30 seconds. Exceeding this counts as a failure.
