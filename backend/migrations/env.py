"""Entorno de Alembic — configuración async para PostgreSQL."""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import Base

# Importar todos los modelos para que Alembic los detecte en autogenerate
import app.models.agent  # noqa: F401
import app.models.room  # noqa: F401
import app.models.reputation  # noqa: F401

config = context.config
fileConfig(config.config_file_name)

# La URL se toma desde la variable de entorno si está disponible
database_url = os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Ejecuta migraciones en modo offline (sin conexión activa)."""
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Ejecuta migraciones en modo online (con conexión async)."""
    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        await conn.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
