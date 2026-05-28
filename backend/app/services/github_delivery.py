"""GitHub delivery service — pushes session deliverables to GitHub."""

import base64
import logging
import re
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


_CODE_FENCE_RE = re.compile(r"^```([^\n]*)\n(.*?)^```[ \t]*$", re.DOTALL | re.MULTILINE)

_EXT = r"py|html?|jsx?|tsx?|css|json|ya?ml|sh|txt|md|vue|go|rs|java|cpp|c"

# Matches "## FILE 1: filename.ext" (any depth ##, any digit)
_FILE_HEADER_RE = re.compile(
    rf"^##+ FILE \d+\s*:\s*([A-Za-z0-9_\-./]+\.(?:{_EXT}))\b",
    re.IGNORECASE | re.MULTILINE,
)

# Tried in order against each preceding line; first match wins.
_FILENAME_PATTERNS: list[re.Pattern] = [
    # **filename.ext** or *filename.ext* (bold / italic markdown)
    re.compile(rf"\*{{1,2}}([A-Za-z0-9_\-./]+\.(?:{_EXT}))\*{{1,2}}", re.IGNORECASE),
    # File: filename.ext  /  Filename: ...  /  Path: ...
    re.compile(
        rf"\b(?:file(?:name)?|path)\s*:\s*`?([A-Za-z0-9_\-./]+\.(?:{_EXT}))`?\b",
        re.IGNORECASE,
    ),
    # General: ## `file.py`, ### FILE N: file.py, standalone `name.ext:`, plain mentions
    re.compile(
        rf"(?:^|[\s`*(:\[])([A-Za-z0-9_\-./]+\.(?:{_EXT}))\b",
        re.IGNORECASE,
    ),
]

_LANG_TO_FILENAME: dict[str, str] = {
    "python": "main.py", "py": "main.py",
    "html": "index.html",
    "javascript": "main.js", "js": "main.js",
    "typescript": "main.ts", "ts": "main.ts",
    "css": "styles.css",
    "jsx": "main.jsx",
    "tsx": "main.tsx",
    "json": "data.json",
    "yaml": "config.yaml", "yml": "config.yml",
    "sh": "script.sh", "bash": "script.sh",
    "go": "main.go",
    "rust": "main.rs", "rs": "main.rs",
    "java": "Main.java",
    "cpp": "main.cpp",
    "c": "main.c",
    "vue": "App.vue",
    "markdown": "README.md", "md": "README.md",
}


def _find_filename_in_line(line: str) -> str | None:
    """Return the first filename found in `line` using all known patterns, or None."""
    for pattern in _FILENAME_PATTERNS:
        m = pattern.search(line)
        if m:
            return m.group(1)
    return None


def _extract_named_files(content: str) -> list[tuple[str, str]]:
    """Return [(filename, file_content), ...] if named code blocks found, else []."""
    logger.info(
        "_extract_named_files: content len=%d, first 200 chars: %r",
        len(content),
        content[:200],
    )
    files: dict[str, str] = {}

    # Fast path: explicit "## FILE N: filename.ext" headers.
    # Slice the content between consecutive headers and grab the first fence in each slice.
    file_headers = list(_FILE_HEADER_RE.finditer(content))
    logger.info(
        "_extract_named_files: found %d FILE headers: %s",
        len(file_headers),
        [hdr.group(1) for hdr in file_headers],
    )
    if file_headers:
        for i, hdr in enumerate(file_headers):
            filename = hdr.group(1)
            section_start = hdr.end()
            section_end = file_headers[i + 1].start() if i + 1 < len(file_headers) else len(content)
            section = content[section_start:section_end]
            logger.info(
                "_extract_named_files: section for %r: len=%d, preview=%r",
                filename,
                len(section),
                section[:80],
            )
            fence_m = _CODE_FENCE_RE.search(section)
            if fence_m:
                files[filename] = fence_m.group(2).rstrip("\n")
                logger.info(
                    "_extract_named_files: extracted %r (%d chars)",
                    filename,
                    len(files[filename]),
                )
            else:
                logger.warning(
                    "_extract_named_files: no code fence found in section for %r",
                    filename,
                )
        if files:
            result = list(files.items())
            logger.info(
                "_extract_named_files: returning %d files: %s",
                len(result),
                [f for f, _ in result],
            )
            return result

    # Fallback: look-back approach for deliverables that use other header conventions.
    content_lines = content.split("\n")
    fence_matches = list(_CODE_FENCE_RE.finditer(content))

    for m in fence_matches:
        body = m.group(2)
        fence_start_line = content[: m.start()].count("\n")

        found: str | None = None
        non_empty_seen = 0
        for i in range(fence_start_line - 1, max(-1, fence_start_line - 30), -1):
            if i < 0:
                break
            line = content_lines[i].strip()
            if not line:
                continue
            non_empty_seen += 1
            if non_empty_seen > 3:
                break
            found = _find_filename_in_line(line)
            if found:
                break

        if found:
            files[found] = body.rstrip("\n")

    # Single-block fallback: infer filename from the language tag.
    if not files and len(fence_matches) == 1:
        lang = fence_matches[0].group(1).strip().lower()
        inferred = _LANG_TO_FILENAME.get(lang)
        if inferred:
            files[inferred] = fence_matches[0].group(2).rstrip("\n")
            logger.info(
                "_extract_named_files: single block, inferred filename=%r from lang=%r",
                inferred,
                lang,
            )

    result = list(files.items())
    logger.info(
        "_extract_named_files: returning %d files: %s",
        len(result),
        [f for f, _ in result],
    )
    return result


async def deliver_to_github(
    github_access_token: str,
    github_username: str,
    room_id: uuid.UUID,
    deliverable_content: str,
    session_log: str,
    agents_contributions: list[dict],
    existing_repo_url: str | None = None,
    session_messages: list[dict] | None = None,
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
        "github_delivery: room=%s username=%s repo=%s token_prefix=%s...",
        room_id,
        github_username,
        existing_repo_url,
        token[:6] if token else "EMPTY",
    )
    logger.info(
        "deliver_to_github: deliverable first 200 chars: %r",
        deliverable_content[:200],
    )

    # Scan messages by priority: R1 (lowest) → R2 → R3 → DELIVERABLE (highest).
    # Later types override earlier ones for the same filename.
    merged: dict[str, str] = {}
    if session_messages:
        for msg_type in ("R1", "R2", "R3", "DELIVERABLE"):
            for msg in session_messages:
                if msg.get("type") == msg_type:
                    for filename, file_content in _extract_named_files(msg.get("content", "")):
                        merged[filename] = file_content
    else:
        for filename, file_content in _extract_named_files(deliverable_content):
            merged[filename] = file_content

    logger.info(
        "deliver_to_github: merged project files=%d: %s",
        len(merged),
        list(merged.keys()),
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
        project_files_committed = 0
        # Always commit DELIVERABLE.md with the full content as-is.
        deliverable_files: list[tuple[str, str, str, str]] = [
            (f"{folder}/DELIVERABLE.md", deliverable_content, author_name, f"{author_slug}@agentlink.ai"),
        ]
        if merged:
            deliverable_files += [
                (f"{folder}/project/{filename}", file_content, author_name, f"{author_slug}@agentlink.ai")
                for filename, file_content in merged.items()
            ]
        else:
            deliverable_files.append((
                f"{folder}/project/README.md",
                "No code files were extracted from this session. The full deliverable is available in DELIVERABLE.md.",
                author_name,
                f"{author_slug}@agentlink.ai",
            ))

        files = deliverable_files + [
            (f"{folder}/SESSION_LOG.md", session_log, "AgentLink System", "system@agentlink.ai"),
            (f"{folder}/CONTRIBUTORS.md", contributors_md, "AgentLink System", "system@agentlink.ai"),
        ]

        for path, content, agent_name, agent_email in files:
            is_project_file = path.startswith(f"{folder}/project/")
            logger.info(
                "deliver_to_github: committing path=%s project_file=%s content_len=%d",
                path,
                is_project_file,
                len(content),
            )
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
            logger.info(
                "deliver_to_github: commit result path=%s status=%s",
                path,
                resp.status_code,
            )
            if resp.status_code in (200, 201):
                commit_count += 1
                if is_project_file:
                    project_files_committed += 1

        if project_files_committed == 0:
            logger.warning(
                "deliver_to_github: no project files committed (all commit requests failed)",
            )

    branch_url = f"{repo_url}/tree/{branch_name}"
    return {
        "repo_url": repo_url,
        "branch": branch_name,
        "branch_url": branch_url,
        "commit_count": commit_count,
    }
