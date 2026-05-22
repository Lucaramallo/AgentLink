"""GitHub repo service — read/write access during active sessions."""

import base64
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_IGNORED_PREFIXES = (
    "node_modules/",
    ".git/",
    "dist/",
    "build/",
    "__pycache__/",
    ".next/",
    "venv/",
    ".venv/",
    "coverage/",
    ".coverage",
    "*.pyc",
)
_MAX_BLOB_SIZE = 1_000_000  # 1 MB
_MAX_TREE_ITEMS = 500
_MAX_FILE_BYTES = 50 * 1024  # 50 KB


def _decrypt(encrypted: str) -> str:
    from app.services.github_delivery import _decrypt_token
    return _decrypt_token(encrypted)


def _parse_repo_path(repo_url: str) -> str:
    return repo_url.rstrip("/").replace("https://github.com/", "").removesuffix(".git")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _b64enc(content: str) -> str:
    return base64.b64encode(content.encode()).decode()


def _should_ignore(path: str) -> bool:
    for prefix in _IGNORED_PREFIXES:
        if path.startswith(prefix) or path == prefix.rstrip("/"):
            return True
    if path.endswith(".pyc") or path.endswith(".pyo"):
        return True
    return False


async def get_repo_tree(github_token_encrypted: str, repo_url: str) -> dict[str, Any]:
    """Return filtered file tree for the repo. Caps at 500 items."""
    token = _decrypt(github_token_encrypted)
    if not token:
        raise ValueError("Invalid GitHub token.")
    repo_path = _parse_repo_path(repo_url)
    api_base = f"https://api.github.com/repos/{repo_path}"
    hdrs = _headers(token)

    async with httpx.AsyncClient(timeout=30) as client:
        repo_resp = await client.get(api_base, headers=hdrs)
        if repo_resp.status_code == 401:
            raise ValueError("GitHub token rejected (401). Please reconnect your account.")
        if repo_resp.status_code == 404:
            raise ValueError(f"Repository not found: {repo_path}")
        if repo_resp.status_code != 200:
            raise ValueError(f"GitHub API error: {repo_resp.status_code}")

        default_branch = repo_resp.json()["default_branch"]

        tree_resp = await client.get(
            f"{api_base}/git/trees/{default_branch}",
            headers=hdrs,
            params={"recursive": "1"},
        )
        if tree_resp.status_code != 200:
            raise ValueError(f"Cannot fetch repo tree: {tree_resp.status_code}")

        raw_items = tree_resp.json().get("tree", [])
        items = []
        for item in raw_items:
            path: str = item.get("path", "")
            if _should_ignore(path):
                continue
            if item.get("type") == "blob" and (item.get("size") or 0) > _MAX_BLOB_SIZE:
                continue
            items.append({
                "path": path,
                "type": item.get("type", "blob"),
                "size": item.get("size"),
                "sha": item.get("sha"),
            })
            if len(items) >= _MAX_TREE_ITEMS:
                break

        return {
            "items": items,
            "truncated": len(raw_items) > _MAX_TREE_ITEMS,
            "total_raw": len(raw_items),
            "default_branch": default_branch,
        }


async def get_file_content(
    github_token_encrypted: str,
    repo_url: str,
    file_path: str,
    branch: str,
) -> str:
    """Return decoded text content of a single file (capped at 50 KB)."""
    token = _decrypt(github_token_encrypted)
    if not token:
        raise ValueError("Invalid GitHub token.")
    repo_path = _parse_repo_path(repo_url)
    api_base = f"https://api.github.com/repos/{repo_path}"
    hdrs = _headers(token)

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{api_base}/contents/{file_path}",
            headers=hdrs,
            params={"ref": branch},
        )
        if resp.status_code == 404:
            raise ValueError(f"File not found: {file_path}")
        if resp.status_code != 200:
            raise ValueError(f"GitHub API error: {resp.status_code}")

        data = resp.json()
        if data.get("encoding") == "base64":
            raw_bytes = base64.b64decode(data["content"])
        else:
            raw_bytes = data.get("content", "").encode()

        content = raw_bytes[:_MAX_FILE_BYTES].decode("utf-8", errors="replace")
        if len(raw_bytes) > _MAX_FILE_BYTES:
            content += f"\n\n[...truncated — file is {len(raw_bytes)} bytes, showing first {_MAX_FILE_BYTES}]"
        return content


async def create_session_branch(
    github_token_encrypted: str,
    repo_url: str,
    session_id: str,
) -> str:
    """Create agentlink/session-{id[:8]} from default branch. Returns branch name."""
    token = _decrypt(github_token_encrypted)
    if not token:
        raise ValueError("Invalid GitHub token.")
    repo_path = _parse_repo_path(repo_url)
    api_base = f"https://api.github.com/repos/{repo_path}"
    hdrs = _headers(token)
    branch_name = f"agentlink/session-{session_id[:8]}"

    async with httpx.AsyncClient(timeout=30) as client:
        repo_resp = await client.get(api_base, headers=hdrs)
        if repo_resp.status_code != 200:
            raise ValueError(f"Cannot access repo: {repo_resp.status_code}")
        default_branch = repo_resp.json()["default_branch"]

        ref_resp = await client.get(
            f"{api_base}/git/ref/heads/{default_branch}", headers=hdrs
        )
        if ref_resp.status_code != 200:
            raise ValueError("Cannot read default branch reference.")
        base_sha = ref_resp.json()["object"]["sha"]

        branch_resp = await client.post(
            f"{api_base}/git/refs",
            headers=hdrs,
            json={"ref": f"refs/heads/{branch_name}", "sha": base_sha},
        )
        # 422 = branch already exists — that's fine
        if branch_resp.status_code not in (200, 201, 422):
            raise ValueError(f"Cannot create branch: {branch_resp.status_code}")

    return branch_name


async def commit_file(
    github_token_encrypted: str,
    repo_url: str,
    branch: str,
    file_path: str,
    content: str,
    agent_name: str,
    agent_role: str,
    message: str,
) -> str:
    """Commit content to file_path on branch. Returns commit SHA."""
    token = _decrypt(github_token_encrypted)
    if not token:
        raise ValueError("Invalid GitHub token.")
    repo_path = _parse_repo_path(repo_url)
    api_base = f"https://api.github.com/repos/{repo_path}"
    hdrs = _headers(token)
    commit_msg = f"[{agent_name}] ({agent_role}): {message}"
    slug = re.sub(r"[^a-z0-9]", "", agent_name.lower())
    author_email = f"{slug}@agentlink.ai"

    async def _get_sha(client: httpx.AsyncClient) -> str | None:
        check = await client.get(
            f"{api_base}/contents/{file_path}",
            headers=hdrs,
            params={"ref": branch},
        )
        if check.status_code == 200:
            return check.json().get("sha")
        return None

    async with httpx.AsyncClient(timeout=30) as client:
        existing_sha = await _get_sha(client)

        body: dict[str, Any] = {
            "message": commit_msg,
            "content": _b64enc(content),
            "branch": branch,
            "author": {"name": agent_name, "email": author_email},
        }
        if existing_sha:
            body["sha"] = existing_sha

        resp = await client.put(f"{api_base}/contents/{file_path}", headers=hdrs, json=body)

        # 409 Conflict / 422 Unprocessable: SHA is stale — refetch and retry once.
        if resp.status_code in (409, 422):
            fresh_sha = await _get_sha(client)
            if fresh_sha:
                body["sha"] = fresh_sha
            elif "sha" in body:
                del body["sha"]
            resp = await client.put(f"{api_base}/contents/{file_path}", headers=hdrs, json=body)

        if resp.status_code not in (200, 201):
            raise ValueError(f"Commit failed: {resp.status_code} — {resp.text[:200]}")

        commit_sha: str = resp.json().get("commit", {}).get("sha", "")
        return commit_sha


async def merge_branch_to_main(
    github_token_encrypted: str,
    repo_url: str,
    branch: str,
) -> str:
    """Merge session branch into the default branch. Returns merge commit SHA."""
    token = _decrypt(github_token_encrypted)
    if not token:
        raise ValueError("Invalid GitHub token.")
    repo_path = _parse_repo_path(repo_url)
    api_base = f"https://api.github.com/repos/{repo_path}"
    hdrs = _headers(token)

    async with httpx.AsyncClient(timeout=30) as client:
        repo_resp = await client.get(api_base, headers=hdrs)
        if repo_resp.status_code != 200:
            raise ValueError(f"Cannot access repo: {repo_resp.status_code}")
        default_branch = repo_resp.json()["default_branch"]

        merge_resp = await client.post(
            f"{api_base}/merges",
            headers=hdrs,
            json={
                "base": default_branch,
                "head": branch,
                "commit_message": f"Merge AgentLink session branch {branch} into {default_branch}",
            },
        )
        if merge_resp.status_code == 204:
            # Nothing to merge (branch is up to date)
            return ""
        if merge_resp.status_code not in (200, 201):
            raise ValueError(f"Merge failed: {merge_resp.status_code} — {merge_resp.text[:200]}")

        sha: str = merge_resp.json().get("sha", "")
        return sha
