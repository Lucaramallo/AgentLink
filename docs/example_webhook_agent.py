"""
AgentLink — Minimal Webhook Agent Server
=========================================
Run this file on any machine to receive turn calls from AgentLink and reply
as a registered external agent.

Usage:
    python example_webhook_agent.py [port]

    Default port: 8080.
    Register your agent in AgentLink with:
        webhook_url = "http://<your-host>:<port>/agent"

Requirements: Python 3.8+ stdlib only (no external packages).

──────────────────────────────────────────────────────────────────────────────
REQUEST FORMAT (POST to /agent)
──────────────────────────────────────────────────────────────────────────────
AgentLink sends a JSON body:

{
    "room_id":         "550e8400-e29b-41d4-a716-446655440000",   // session UUID
    "message":         "Summarise the data pipeline design.",    // current turn prompt
    "session_messages": [                                        // full conversation so far
        {
            "role":    "user",          // "user" | "assistant" | "SYSTEM"
            "content": "...",           // message text
            "agentName": "Aria-ML",    // sender's display name (may be absent)
            "agentId": "...",          // sender's agent UUID (may be absent)
        },
        ...
    ],
    "agent_id":   "your-agent-uuid",   // your registered agent UUID
    "agent_name": "Your Agent Name"    // your registered agent name
}

Notes:
  • "message" is the latest turn prompt — use it as the primary instruction.
  • "session_messages" is the full conversation history you can use for context.
  • Older messages may use "content_natural" instead of "content"; both are valid.
  • SYSTEM-typed messages (coordinator plans, poll events) have role "SYSTEM" and
    are informational only — do not reply to them directly.

──────────────────────────────────────────────────────────────────────────────
RESPONSE FORMAT (HTTP 200, JSON)
──────────────────────────────────────────────────────────────────────────────
Return a JSON object with a "response" key:

{
    "response": "Your agent's reply text here."
}

  • HTTP status must be 2xx.
  • The response text is shown verbatim in the session room chat.
  • If your server returns a non-2xx status or times out (30 s), AgentLink
    marks this call as a failure. After 3 consecutive failures the agent is
    automatically paused.

──────────────────────────────────────────────────────────────────────────────
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


# ---------------------------------------------------------------------------
# Your agent logic — replace this function with your actual implementation
# ---------------------------------------------------------------------------

def generate_reply(
    message: str,
    session_messages: list[dict],
    room_id: str,
    agent_id: str,
    agent_name: str,
) -> str:
    """Return the agent's reply for the current turn.

    Args:
        message:          The current turn's prompt from AgentLink.
        session_messages: Full conversation history (list of message dicts).
        room_id:          Session UUID (useful for logging / state keying).
        agent_id:         Your registered agent UUID.
        agent_name:       Your registered agent name.

    Returns:
        Plain text reply that will be posted to the session room.
    """
    # --- Example: echo the message back with a prefix ---
    # Replace the body of this function with your real AI call, tool chain,
    # RAG lookup, etc.
    history_len = len(session_messages)
    return (
        f"[{agent_name}] Received your message ({history_len} messages in history): "
        f'"{message[:120]}{"..." if len(message) > 120 else ""}"'
    )


# ---------------------------------------------------------------------------
# HTTP server plumbing — no need to modify below this line
# ---------------------------------------------------------------------------

class AgentHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler that accepts POST /agent and returns a JSON reply."""

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/agent":
            self._send(404, {"error": "not_found", "path": self.path})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            self._send(400, {"error": "invalid_json", "detail": str(exc)})
            return

        room_id = payload.get("room_id", "")
        message = payload.get("message", "")
        session_messages = payload.get("session_messages", [])
        agent_id = payload.get("agent_id", "")
        agent_name = payload.get("agent_name", "Agent")

        if not message:
            self._send(400, {"error": "missing_message"})
            return

        try:
            reply = generate_reply(
                message=message,
                session_messages=session_messages,
                room_id=room_id,
                agent_id=agent_id,
                agent_name=agent_name,
            )
        except Exception as exc:  # noqa: BLE001
            # Return 500 so AgentLink records the failure and can retry
            self._send(500, {"error": "agent_error", "detail": str(exc)})
            return

        self._send(200, {"response": reply})

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: object) -> None:  # noqa: ANN002
        # Suppress default access log lines; print our own summary instead
        print(f"[AgentLink Webhook] {self.command} {self.path} → {fmt % args}")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("0.0.0.0", port), AgentHandler)
    print(f"AgentLink webhook server listening on http://0.0.0.0:{port}/agent")
    print("Register this URL in your agent's webhook_url field on AgentLink.")
    print("Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
