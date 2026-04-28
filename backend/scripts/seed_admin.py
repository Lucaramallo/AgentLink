"""Seed del superadmin por defecto — ejecutar una sola vez tras migrar."""

import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.models.user import User, UserRole

ADMIN_EMAIL = "admin@agentlink.ai"
ADMIN_PASSWORD = "agentlink2026"
ADMIN_NAME = "AgentLink Admin"


async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        existing = await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        if existing.scalar_one_or_none():
            print(f"Superadmin '{ADMIN_EMAIL}' ya existe. Nada que hacer.")
            return

        password_hash = bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode()
        admin = User(
            email=ADMIN_EMAIL,
            password_hash=password_hash,
            full_name=ADMIN_NAME,
            nationality="Global",
            role=UserRole.SUPERADMIN,
            is_verified=True,
        )
        session.add(admin)
        await session.commit()
        print(f"Superadmin '{ADMIN_EMAIL}' creado con éxito.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
