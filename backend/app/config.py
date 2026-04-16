"""Configuración central de AgentLink — lee todas las variables desde entorno."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Base de datos
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/agentlink"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT
    jwt_secret_key: str = "CHANGE_ME_IN_PRODUCTION"
    jwt_algorithm: str = "RS256"
    jwt_expiry_hours: int = 24

    # App
    app_name: str = "AgentLink"
    debug: bool = False
    api_version: str = "v1"

    # Seguridad
    max_messages_per_minute: int = 60


settings = Settings()
