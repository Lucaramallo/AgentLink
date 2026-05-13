"""Router de autenticación — register, login, perfil, GitHub OAuth."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
import httpx
import jwt as pyjwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import create_access_token, get_current_user
from app.models.user import User, UserRole

router = APIRouter(prefix="/auth", tags=["auth"])

_fernet = Fernet(settings.github_token_encryption_key.encode())


def _encrypt_token(plain: str) -> str:
    return _fernet.encrypt(plain.encode()).decode()


def _decrypt_token(encrypted: str) -> str:
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except (InvalidToken, Exception):
        return ""


# ── Schemas ────────────────────────────────────────────────────────────────

class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    nationality: str
    github_username: str | None = None
    github_url: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdateIn(BaseModel):
    full_name: str | None = None
    nationality: str | None = None
    github_username: str | None = None
    github_url: str | None = None
    current_password: str | None = None
    new_password: str | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    nationality: str
    github_username: str | None
    github_url: str | None
    role: UserRole
    alc_balance: float
    is_verified: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AuthOut(BaseModel):
    token: str
    user: UserOut


class GithubRepoOut(BaseModel):
    name: str
    full_name: str
    html_url: str
    description: str | None


# ── Helpers ────────────────────────────────────────────────────────────────

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _create_oauth_state(user_id: uuid.UUID) -> str:
    """Creates a short-lived signed token to carry user_id through OAuth flow."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=10)
    payload = {"sub": str(user_id), "exp": expire, "typ": "oauth_state"}
    return pyjwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def _verify_oauth_state(state: str) -> uuid.UUID:
    """Verifies OAuth state token and returns user_id."""
    try:
        payload = pyjwt.decode(state, settings.jwt_secret_key, algorithms=["HS256"])
        if payload.get("typ") != "oauth_state":
            raise ValueError("invalid type")
        return uuid.UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=400, detail="OAuth state inválido o expirado.")


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    """Registra un nuevo usuario y retorna JWT."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email ya registrado.")

    user = User(
        email=body.email,
        password_hash=_hash_password(body.password),
        full_name=body.full_name,
        nationality=body.nationality,
        github_username=body.github_username,
        github_url=body.github_url,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    token = create_access_token(user.id)
    return AuthOut(token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthOut)
async def login(body: LoginIn, db: Annotated[AsyncSession, Depends(get_db)]) -> AuthOut:
    """Autentica con email + password y retorna JWT."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not _verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas.",
        )

    token = create_access_token(user.id)
    return AuthOut(token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> UserOut:
    """Retorna el perfil del usuario autenticado."""
    return UserOut.model_validate(current_user)


@router.put("/me", response_model=UserOut)
async def update_me(
    body: ProfileUpdateIn,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserOut:
    """Actualiza el perfil del usuario autenticado."""
    if body.full_name is not None:
        current_user.full_name = body.full_name
    if body.nationality is not None:
        current_user.nationality = body.nationality
    if body.github_username is not None:
        current_user.github_username = body.github_username
    if body.github_url is not None:
        current_user.github_url = body.github_url
    if body.current_password is not None and body.new_password is not None:
        if not _verify_password(body.current_password, current_user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect.")
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
        current_user.password_hash = _hash_password(body.new_password)

    await db.flush()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.delete("/github", response_model=AuthOut)
async def github_disconnect(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthOut:
    """Disconnects GitHub account by clearing stored credentials."""
    current_user.github_username = None
    current_user.github_url = None
    current_user.github_access_token = None
    await db.flush()
    await db.refresh(current_user)
    new_token = create_access_token(current_user.id)
    return AuthOut(token=new_token, user=UserOut.model_validate(current_user))


@router.get("/github")
async def github_oauth_start(
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Returns the GitHub OAuth authorization URL. Requires JWT."""
    if not settings.github_client_id:
        raise HTTPException(status_code=503, detail="GitHub OAuth no configurado.")

    state = _create_oauth_state(current_user.id)
    callback_uri = f"{settings.frontend_url}/auth/github/callback"
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={settings.github_client_id}"
        f"&redirect_uri={callback_uri}"
        f"&scope=repo,read:user"
        f"&state={state}"
    )
    return {"url": url}


@router.get("/github/callback", response_model=AuthOut)
async def github_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> AuthOut:
    """Exchanges GitHub OAuth code for access token, updates user profile."""
    user_id = _verify_oauth_state(state)

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
            },
            headers={"Accept": "application/json"},
            timeout=15,
        )

    if token_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Error obteniendo token de GitHub.")

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail=f"GitHub OAuth error: {token_data.get('error_description', 'unknown')}")

    # Fetch GitHub user info
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
            timeout=15,
        )

    if user_resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Error obteniendo perfil de GitHub.")

    gh_user = user_resp.json()

    user.github_username = gh_user.get("login")
    user.github_url = gh_user.get("html_url")
    user.github_access_token = _encrypt_token(access_token)

    await db.flush()
    await db.refresh(user)

    token = create_access_token(user.id)
    return AuthOut(token=token, user=UserOut.model_validate(user))


@router.get("/github/repos", response_model=list[GithubRepoOut])
async def github_get_repos(
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[GithubRepoOut]:
    """Returns user's GitHub repos using their stored access token."""
    if not current_user.github_access_token:
        raise HTTPException(status_code=400, detail="GitHub no conectado. Conecta tu cuenta primero.")

    access_token = _decrypt_token(current_user.github_access_token)
    if not access_token:
        raise HTTPException(status_code=400, detail="Token de GitHub inválido. Reconecta tu cuenta.")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.github.com/user/repos",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
            params={"sort": "updated", "per_page": 100, "affiliation": "owner"},
            timeout=15,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Error obteniendo repos de GitHub.")

    repos = resp.json()
    return [
        GithubRepoOut(
            name=r["name"],
            full_name=r["full_name"],
            html_url=r["html_url"],
            description=r.get("description"),
        )
        for r in repos
    ]
