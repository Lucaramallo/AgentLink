"""
AgentLink — Synthesis-G Webhook Agent (Google Gemini)
======================================================
Production-ready external agent powered by gemini-2.0-flash.

Synthesis-G is a strategic synthesiser: it pulls together contributions from
multiple agents into coherent, executive-level conclusions with clear action
items. Best used as the final Builder or Coordinator in a multi-agent session.

Usage:
    pip install google-genai flask
    export GEMINI_API_KEY="your-key-here"
    python gemini_webhook_agent.py [port]

    Default port: 9001.
    Register on AgentLink with:
        webhook_url = "http://<your-host>:<port>/agent"

Environment variables:
    GEMINI_API_KEY   Required. Your Google AI Studio API key.
    PORT             Optional. Overrides the command-line port argument.

──────────────────────────────────────────────────────────────────────────────
AGENTLINK WEBHOOK CONTRACT
──────────────────────────────────────────────────────────────────────────────
Incoming POST /agent body:
{
    "room_id":          "550e8400-...",
    "message":          "Current turn prompt",
    "session_messages": [
        {"role": "user"|"assistant"|"SYSTEM", "content": "...",
         "agentName": "...", "agentId": "..."},
        ...
    ],
    "agent_id":   "your-agent-uuid",
    "agent_name": "Synthesis-G"
}

Successful response (HTTP 200):
{
    "response": "Agent reply text"
}

Error response (HTTP 503):
{
    "error": "gemini_error",
    "detail": "..."
}
──────────────────────────────────────────────────────────────────────────────
"""

import logging
import os
import sys

from google import genai
from google.genai import types
from flask import Flask, jsonify, request

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [Synthesis-G] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("synthesis-g")

# ---------------------------------------------------------------------------
# Gemini client initialisation
# ---------------------------------------------------------------------------

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not GEMINI_API_KEY:
    log.error("GEMINI_API_KEY environment variable is not set — exiting.")
    sys.exit(1)

client = genai.Client(api_key=GEMINI_API_KEY)
MODEL_NAME = "gemini-2.5-flash"

# ---------------------------------------------------------------------------
# Synthesis-G system prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are Synthesis-G, a strategic synthesiser operating inside an AgentLink collaborative session.

Your role is to integrate and elevate. While other agents contribute deep expertise in their own domains, your job is to read everything, find the signal across all contributions, and produce a unified, executive-level output that stakeholders can act on immediately.

Your operating principles:
1. **Pattern recognition first.** Before writing a single word of your response, identify the threads that connect the contributions you have seen. What do they agree on? Where do they diverge? What gap does none of them address?
2. **Synthesis, not summary.** Do not list what other agents said. Extract the insight that only becomes visible when you look at all the pieces together.
3. **Executive clarity.** Your output should be readable by a decision-maker in 90 seconds. Lead with the conclusion. Support it with exactly as much evidence as it needs — no more.
4. **Action orientation.** Every synthesis must end with clear, prioritised next steps or recommendations. If you cannot identify concrete actions, state why and propose how to get to them.
5. **Intellectual honesty.** If contributions conflict and the conflict matters, name it explicitly and recommend how to resolve it. Do not paper over disagreement with vague language.
6. **Brevity as respect.** Dense, precise writing signals you have done the work. Padding signals you have not.

You are operating in a multi-agent session where your output may directly feed into a deliverable, a GitHub commit, or a client-facing document. Write accordingly."""

# ---------------------------------------------------------------------------
# Role mapping — AgentLink → Gemini
# ---------------------------------------------------------------------------

# AgentLink uses "SYSTEM" for coordinator plans and poll events.
# Gemini's Chat API only accepts "user" and "model" roles.
# Map accordingly: assistant → model, everything else → user.
_ROLE_MAP = {
    "assistant": "model",
    "user": "user",
    "SYSTEM": "user",
}


def _build_history(session_messages: list[dict]) -> list[dict]:
    """Convert AgentLink session_messages to Gemini chat history format.

    Gemini requires alternating user/model turns and cannot start with a
    model turn. Consecutive messages of the same role are merged with a
    newline separator to satisfy this constraint.
    """
    if not session_messages:
        return []

    gemini_turns: list[dict] = []

    for msg in session_messages:
        raw_role = msg.get("role", "user")
        # Support both "content" and the legacy "content_natural" field
        text = msg.get("content") or msg.get("content_natural") or ""
        if not text:
            continue

        # Prefix SYSTEM messages so Synthesis-G understands their source
        if raw_role == "SYSTEM":
            text = f"[SYSTEM] {text}"

        # Add sender attribution when available (helps Synthesis-G distinguish voices)
        agent_name = msg.get("agentName")
        if agent_name and raw_role != "SYSTEM":
            text = f"[{agent_name}] {text}"

        gemini_role = _ROLE_MAP.get(raw_role, "user")

        # Merge consecutive same-role turns
        if gemini_turns and gemini_turns[-1]["role"] == gemini_role:
            gemini_turns[-1]["parts"][0]["text"] += f"\n\n{text}"
        else:
            gemini_turns.append({"role": gemini_role, "parts": [{"text": text}]})

    # Gemini chat history must not start with a model turn
    if gemini_turns and gemini_turns[0]["role"] == "model":
        gemini_turns[0]["role"] = "user"

    return gemini_turns


# ---------------------------------------------------------------------------
# Core reply generation
# ---------------------------------------------------------------------------

def generate_reply(
    message: str,
    session_messages: list[dict],
    room_id: str,
    agent_id: str,
    agent_name: str,
) -> str:
    """Call Gemini and return Synthesis-G's reply.

    Raises:
        google.api_core.exceptions.GoogleAPIError: on any Gemini API failure.
    """
    history = _build_history(session_messages)

    log.info(
        "room=%s agent=%s history_turns=%d prompt_chars=%d",
        room_id[:8],
        agent_id[:8] if agent_id else "?",
        len(history),
        len(message),
    )

    contents = history + [{"role": "user", "parts": [{"text": message}]}]
    gemini_response = client.models.generate_content(
        model=MODEL_NAME,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
        ),
    )
    reply = gemini_response.text

    log.info("room=%s reply_chars=%d", room_id[:8], len(reply))
    return reply


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "agent": "Synthesis-G", "model": MODEL_NAME})


@app.route("/agent", methods=["POST"])
def agent_endpoint():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "invalid_json"}), 400

    room_id = payload.get("room_id", "")
    message = payload.get("message", "")
    session_messages = payload.get("session_messages", [])
    agent_id = payload.get("agent_id", "")
    agent_name = payload.get("agent_name", "Synthesis-G")

    if not message:
        return jsonify({"error": "missing_message"}), 400

    try:
        reply = generate_reply(
            message=message,
            session_messages=session_messages,
            room_id=room_id,
            agent_id=agent_id,
            agent_name=agent_name,
        )
    except Exception as exc:
        log.exception("Gemini API call failed: %s", exc)
        return jsonify({"error": "gemini_error", "detail": str(exc)}), 503

    return jsonify({"response": reply})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    port_env = os.environ.get("PORT")
    if port_env:
        port = int(port_env)
    elif len(sys.argv) > 1:
        port = int(sys.argv[1])
    else:
        port = 9001

    log.info("Synthesis-G starting on http://0.0.0.0:%d", port)
    log.info("Webhook endpoint : http://0.0.0.0:%d/agent", port)
    log.info("Health endpoint  : http://0.0.0.0:%d/health", port)
    log.info("Model            : %s", MODEL_NAME)
    log.info("Register this webhook_url on AgentLink to activate Synthesis-G.")

    app.run(host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
