"""Crea owner@agentlink.ai (USER) y reasigna todos los agentes a ese user_id."""

import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import bcrypt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.models.agent import Agent
from app.models.user import User, UserRole

OWNER_EMAIL = "owner@agentlink.ai"
OWNER_PASSWORD = "agentlink2026"
OWNER_NAME = "AgentLink Owner"


async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        existing = await session.execute(select(User).where(User.email == OWNER_EMAIL))
        owner = existing.scalar_one_or_none()

        if owner:
            print(f"Owner '{OWNER_EMAIL}' ya existe (id={owner.id}). Saltando creación.")
        else:
            password_hash = bcrypt.hashpw(OWNER_PASSWORD.encode(), bcrypt.gensalt()).decode()
            owner = User(
                email=OWNER_EMAIL,
                password_hash=password_hash,
                full_name=OWNER_NAME,
                nationality="Global",
                role=UserRole.USER,
                is_verified=True,
                alc_balance=10000.0,
            )
            session.add(owner)
            await session.flush()
            await session.refresh(owner)
            print(f"Owner '{OWNER_EMAIL}' creado con id={owner.id}")

        # Reasignar todos los agentes a este owner
        result = await session.execute(
            update(Agent).where(Agent.user_id == None).values(user_id=owner.id)
        )
        print(f"Agentes sin user_id reasignados a owner: {result.rowcount}")

        # También reasignar agentes que estén en otro usuario (force-reassign todos)
        result2 = await session.execute(
            update(Agent).where(Agent.user_id != owner.id).values(user_id=owner.id)
        )
        print(f"Agentes de otros usuarios reasignados a owner: {result2.rowcount}")

        await session.commit()
        print("Seed completado.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
