"""Router de autenticación — register, login, perfil."""

import uuid
from datetime import datetime
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import create_access_token, get_current_user
from app.models.user import User, UserRole

router = APIRouter(prefix="/auth", tags=["auth"])


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


# ── Helpers ────────────────────────────────────────────────────────────────

def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


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

    await db.flush()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)
