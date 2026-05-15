"""Seed script — creates system accounts and 8 demo agents.

Idempotent: skips any record that already exists.
Run: cd ~/Agentlink/backend && venv/bin/python seed.py
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.models.agent import Agent, HumanOwner
from app.models.user import User, UserRole
from app.services.identity import generate_keypair

# ── Config ────────────────────────────────────────────────────────────────────

ADMIN_EMAIL = "admin@agentlink.ai"
OWNER_EMAIL = "owner@agentlink.ai"
PASSWORD = "agentlink2026"

DEMO_AGENTS = [
    {
        "slug": "nexus-7",
        "name": "Nexus-7",
        "description": "Software engineer specializing in backend systems, APIs, and clean architecture.",
        "skills": ["Python", "FastAPI", "System Design", "Code Review", "Debugging"],
        "framework": "LangChain",
        "session_fee": 5.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.7,
        "reputation_relational": 4.3,
    },
    {
        "slug": "aria-ml",
        "name": "Aria-ML",
        "description": "Data scientist focused on ML pipelines, statistical analysis, and model evaluation.",
        "skills": ["Machine Learning", "PyTorch", "Statistics", "Data Analysis", "Model Optimization"],
        "framework": "PyTorch",
        "session_fee": 6.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.8,
        "reputation_relational": 4.2,
    },
    {
        "slug": "forge-alpha",
        "name": "Forge-Alpha",
        "description": "DevOps engineer focused on infrastructure automation, CI/CD, and system reliability.",
        "skills": ["Terraform", "Docker", "Kubernetes", "CI/CD", "Cloud Infrastructure"],
        "framework": "Terraform",
        "session_fee": 5.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.5,
        "reputation_relational": 4.4,
    },
    {
        "slug": "scribe-pro",
        "name": "Scribe-Pro",
        "description": "Technical writer and communicator specializing in documentation, content strategy, and clear synthesis.",
        "skills": ["Technical Writing", "Documentation", "Content Strategy", "Editing", "Communication"],
        "framework": "LangChain",
        "session_fee": 3.0,
        "cost_per_message": 1.0,
        "reputation_technical": 4.2,
        "reputation_relational": 4.7,
    },
    {
        "slug": "quant-z",
        "name": "Quant-Z",
        "description": "Financial analyst specializing in quantitative modeling, risk assessment, and investment analysis.",
        "skills": ["Financial Modeling", "Risk Analysis", "Python", "Statistics", "Portfolio Management"],
        "framework": "Pandas/NumPy",
        "session_fee": 7.0,
        "cost_per_message": 4.0,
        "reputation_technical": 4.6,
        "reputation_relational": 4.1,
    },
    {
        "slug": "vortex-ui",
        "name": "Vortex-UI",
        "description": "UI/UX designer combining design thinking with accessibility-first, user-centered solutions.",
        "skills": ["UI Design", "UX Research", "Figma", "Accessibility", "Design Systems"],
        "framework": "React/Figma",
        "session_fee": 4.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.4,
        "reputation_relational": 4.8,
    },
    {
        "slug": "sigma-qa",
        "name": "Sigma-QA",
        "description": "QA specialist focused on test coverage, edge-case discovery, and acceptance criteria validation.",
        "skills": ["Test Automation", "Pytest", "Selenium", "Quality Assurance", "Edge Case Analysis"],
        "framework": "Pytest/Selenium",
        "session_fee": 4.0,
        "cost_per_message": 1.0,
        "reputation_technical": 4.5,
        "reputation_relational": 4.3,
    },
    {
        "slug": "vector-x",
        "name": "Vector-X",
        "description": "Cybersecurity specialist focused on threat modeling, vulnerability assessment, and defense-in-depth.",
        "skills": ["Penetration Testing", "Threat Modeling", "OWASP", "Security Auditing", "Cryptography"],
        "framework": "OWASP",
        "session_fee": 8.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.7,
        "reputation_relational": 4.0,
    },
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


# ── Seed ──────────────────────────────────────────────────────────────────────

async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        # ── 1. Admin user ──────────────────────────────────────────────────
        existing = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        if existing.scalar_one_or_none():
            print(f"[skip] admin user '{ADMIN_EMAIL}' already exists")
        else:
            admin = User(
                email=ADMIN_EMAIL,
                password_hash=_hash(PASSWORD),
                full_name="AgentLink Admin",
                nationality="Global",
                role=UserRole.SUPERADMIN,
                is_verified=True,
            )
            db.add(admin)
            await db.flush()
            print(f"[ok]   created admin '{ADMIN_EMAIL}'")

        # ── 2. Owner user ──────────────────────────────────────────────────
        existing = await db.execute(select(User).where(User.email == OWNER_EMAIL))
        owner_user = existing.scalar_one_or_none()
        if owner_user:
            print(f"[skip] owner user '{OWNER_EMAIL}' already exists (id={owner_user.id})")
        else:
            owner_user = User(
                email=OWNER_EMAIL,
                password_hash=_hash(PASSWORD),
                full_name="AgentLink Owner",
                nationality="Global",
                role=UserRole.USER,
                is_verified=True,
                alc_balance=10000.0,
            )
            db.add(owner_user)
            await db.flush()
            await db.refresh(owner_user)
            print(f"[ok]   created owner '{OWNER_EMAIL}' (id={owner_user.id}, balance=10000 ALC)")

        # ── 3. HumanOwner record ───────────────────────────────────────────
        existing = await db.execute(
            select(HumanOwner).where(HumanOwner.email == OWNER_EMAIL)
        )
        human_owner = existing.scalar_one_or_none()
        if human_owner:
            print(f"[skip] human_owner '{OWNER_EMAIL}' already exists (id={human_owner.owner_id})")
        else:
            human_owner = HumanOwner(
                email=OWNER_EMAIL,
                verified=True,
            )
            db.add(human_owner)
            await db.flush()
            await db.refresh(human_owner)
            print(f"[ok]   created human_owner '{OWNER_EMAIL}' (id={human_owner.owner_id})")

        # ── 4. Demo agents ─────────────────────────────────────────────────
        for spec in DEMO_AGENTS:
            existing = await db.execute(
                select(Agent).where(Agent.name == spec["name"])
            )
            if existing.scalar_one_or_none():
                print(f"[skip] agent '{spec['name']}' already exists")
                continue

            kp = generate_keypair()
            agent = Agent(
                human_owner_id=human_owner.owner_id,
                user_id=owner_user.id,
                name=spec["name"],
                description=spec["description"],
                skills=spec["skills"],
                framework=spec["framework"],
                public_key=kp.public_key_b64,
                session_fee=spec["session_fee"],
                cost_per_message=spec["cost_per_message"],
                reputation_technical=spec["reputation_technical"],
                reputation_relational=spec["reputation_relational"],
                is_active=True,
            )
            db.add(agent)
            await db.flush()
            print(f"[ok]   created agent '{spec['name']}' (slug: {spec['slug']}, fee={spec['session_fee']} ALC)")

        await db.commit()
        print("\nSeed complete.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
