"""GitHub delivery service — pushes session deliverables to GitHub."""

import base64
import logging
import uuid

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger(__name__)

_fernet = Fernet(settings.github_token_encryption_key.encode())


def _decrypt_token(encrypted: str) -> str:
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception) as exc:
        logger.error("github_delivery: token decryption failed: %s", exc)
        return ""


def _b64(content: str) -> str:
    return base64.b64encode(content.encode()).decode()


async def deliver_to_github(
    github_access_token: str,
    github_username: str,
    room_id: uuid.UUID,
    deliverable_content: str,
    session_log: str,
    agents_contributions: list[dict],
    existing_repo_url: str | None = None,
) -> dict:
    """Push deliverable + log to GitHub. Returns {repo_url, branch, branch_url, commit_count}."""
    token = _decrypt_token(github_access_token)
    if not token:
        raise ValueError("Invalid or missing GitHub token. Please reconnect your GitHub account.")

    id_short = str(room_id)[:8]
    branch_name = f"agentlink/session-{id_short}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    logger.info(
        "github_delivery: using token prefix=%s... username=%s repo=%s",
        token[:6] if token else "EMPTY",
        github_username,
        existing_repo_url,
    )

    async with httpx.AsyncClient(timeout=30) as client:
        if existing_repo_url:
            # MODE A: push to existing repo
            repo_path = existing_repo_url.rstrip("/").replace("https://github.com/", "").removesuffix(".git")
            api_base = f"https://api.github.com/repos/{repo_path}"
            repo_url = f"https://github.com/{repo_path}"

            repo_resp = await client.get(api_base, headers=headers)
            if repo_resp.status_code == 401:
                body = repo_resp.text[:300]
                logger.error("github_delivery: 401 unauthorized. body=%s", body)
                raise ValueError(
                    f"GitHub token rejected (401). Reconnect your GitHub account. Detail: {body}"
                )
            if repo_resp.status_code == 404:
                body = repo_resp.text[:300]
                logger.error("github_delivery: 404 for repo=%s body=%s", repo_path, body)
                raise ValueError(
                    f"Repository not found or no access (404). "
                    f"Repo: {repo_path}. Ensure the token has 'repo' scope. Detail: {body}"
                )
            if repo_resp.status_code != 200:
                body = repo_resp.text[:300]
                logger.error("github_delivery: status=%s body=%s", repo_resp.status_code, body)
                raise ValueError(f"GitHub API error: {repo_resp.status_code}. Detail: {body}")

            default_branch = repo_resp.json()["default_branch"]
            ref_resp = await client.get(f"{api_base}/git/ref/heads/{default_branch}", headers=headers)
            if ref_resp.status_code != 200:
                raise ValueError("Cannot read branch reference.")
            base_sha = ref_resp.json()["object"]["sha"]

            branch_resp = await client.post(f"{api_base}/git/refs", headers=headers, json={
                "ref": f"refs/heads/{branch_name}",
                "sha": base_sha,
            })
            if branch_resp.status_code not in (200, 201, 422):
                raise ValueError(f"Cannot create branch: {branch_resp.status_code}")
        else:
            # MODE B: create new private repo
            repo_name = f"agentlink-session-{id_short}"
            create_resp = await client.post(
                "https://api.github.com/user/repos",
                headers=headers,
                json={
                    "name": repo_name,
                    "private": True,
                    "description": f"AgentLink session {id_short} deliverables",
                    "auto_init": True,
                },
            )
            if create_resp.status_code not in (200, 201):
                raise ValueError(f"Cannot create repository: {create_resp.text[:200]}")
            repo_data = create_resp.json()
            repo_path = repo_data["full_name"]
            repo_url = repo_data["html_url"]
            api_base = f"https://api.github.com/repos/{repo_path}"
            default_branch = repo_data.get("default_branch", "main")

            ref_resp = await client.get(f"{api_base}/git/ref/heads/{default_branch}", headers=headers)
            if ref_resp.status_code != 200:
                raise ValueError("Cannot read branch reference after repo creation.")
            base_sha = ref_resp.json()["object"]["sha"]

            await client.post(f"{api_base}/git/refs", headers=headers, json={
                "ref": f"refs/heads/{branch_name}",
                "sha": base_sha,
            })

        # Build CONTRIBUTORS.md
        total_msgs = sum(a.get("message_count", 0) for a in agents_contributions) or 1
        rows = "\n".join(
            f"| {a['name']} | {a.get('role', '—')} | {a.get('message_count', 0)} | "
            f"{round(a.get('message_count', 0) / total_msgs * 100)}% |"
            for a in agents_contributions
        )
        contributors_md = (
            "# Contributors\n\n"
            "| Agent | Role | Messages | Contribution % |\n"
            "|-------|------|----------|----------------|\n"
            f"{rows}\n"
        )

        # Author for deliverable commit: last builder/contributor agent
        builders = [a for a in agents_contributions if a.get("role") in ("Builder", "Contributor")]
        author_name = builders[-1]["name"] if builders else "AgentLink"
        author_slug = author_name.lower().replace(" ", "")

        folder = f"sessions/{room_id}"
        agent_names_str = ", ".join(a["name"] for a in agents_contributions) if agents_contributions else "AgentLink"
        commit_message = f"AgentLink session {id_short} — {agent_names_str}"

        commit_count = 0
        files = [
            (f"{folder}/DELIVERABLE.md", deliverable_content, author_name, f"{author_slug}@agentlink.ai"),
            (f"{folder}/SESSION_LOG.md", session_log, "AgentLink System", "system@agentlink.ai"),
            (f"{folder}/CONTRIBUTORS.md", contributors_md, "AgentLink System", "system@agentlink.ai"),
        ]

        for path, content, agent_name, agent_email in files:
            existing_sha = None
            check = await client.get(
                f"{api_base}/contents/{path}", headers=headers, params={"ref": branch_name}
            )
            if check.status_code == 200:
                existing_sha = check.json().get("sha")

            payload: dict = {
                "message": commit_message,
                "content": _b64(content),
                "branch": branch_name,
                "author": {"name": agent_name, "email": agent_email},
            }
            if existing_sha:
                payload["sha"] = existing_sha

            resp = await client.put(f"{api_base}/contents/{path}", headers=headers, json=payload)
            if resp.status_code in (200, 201):
                commit_count += 1

    branch_url = f"{repo_url}/tree/{branch_name}"
    return {
        "repo_url": repo_url,
        "branch": branch_name,
        "branch_url": branch_url,
        "commit_count": commit_count,
    }
