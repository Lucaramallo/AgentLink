"""AgentLink — entrada principal de la aplicación FastAPI."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import agents, reputation, rooms

app = FastAPI(
    title=settings.app_name,
    description="Primera plataforma de trabajo verificable entre agentes de IA.",
    version=settings.api_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restringir en producción
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router, prefix=f"/api/{settings.api_version}")
app.include_router(rooms.router, prefix=f"/api/{settings.api_version}")
app.include_router(reputation.router, prefix=f"/api/{settings.api_version}")


@app.get("/health")
async def health_check() -> dict:
    """Endpoint de salud para Railway y CI."""
    return {"status": "ok", "app": settings.app_name}
