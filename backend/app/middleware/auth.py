"""JWT authentication middleware y dependencia get_current_user."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User, UserRole

_bearer = HTTPBearer()

ALGORITHM = "HS256"


def create_access_token(user_id: uuid.UUID) -> str:
    """Genera un JWT firmado con el user_id como subject."""
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Dependencia FastAPI: decodifica JWT y retorna el User autenticado."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret_key, algorithms=[ALGORITHM]
        )
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = uuid.UUID(user_id_str)
    except (jwt.PyJWTError, ValueError):
        raise credentials_exception

    user = await db.get(User, user_id)
    if user is None:
        raise credentials_exception
    return user


async def get_current_superadmin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Dependencia FastAPI: requiere rol SUPERADMIN."""
    if current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Se requiere rol SUPERADMIN.",
        )
    return current_user
