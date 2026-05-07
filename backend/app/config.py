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
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 24

    # App
    app_name: str = "AgentLink"
    debug: bool = False
    api_version: str = "v1"

    # Seguridad
    max_messages_per_minute: int = 60
    # Anthropic
    anthropic_api_key: str = ""
    # GitHub OAuth
    github_client_id: str = ""
    github_client_secret: str = ""
    # Fernet key for encrypting github_access_token — generate with: Fernet.generate_key().decode()
    github_token_encryption_key: str = "ZmDfcTF7_60GrrY167zsiPd_GbNOCKhm3K35q4E3bnY="
    # Frontend URL for OAuth redirects
    frontend_url: str = "http://192.168.0.108:3001"
    # GitHub REST API base URL
    github_api_url: str = "https://api.github.com"
    # Server-side ed25519 signing key (base64) — used to sign human-proposed polls
    # Generate with: python3 -c "import nacl.signing, base64; k=nacl.signing.SigningKey.generate(); print(base64.b64encode(bytes(k)).decode())"
    server_signing_key: str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="


settings = Settings()
