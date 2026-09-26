import json
import os
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Settings:
    # App & Auth Settings
    ENV: str = os.getenv("ENV", "development")
    AUTH_PROVIDER: str = os.getenv("AUTH_PROVIDER", "firebase").strip().lower()

    # Supabase (Adapter Ready)
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "").strip()
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "").strip()
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "").strip()

    # External APIs
    REPLICATE_API_TOKEN: str | None = os.getenv("REPLICATE_API_TOKEN")
    INSIGHTFACE_API_KEY: str | None = os.getenv("INSIGHTFACE_API_KEY")
    FIRECRAWL_API_KEY: str = os.getenv("FIRECRAWL_API_KEY", "").strip()

    # Safety Kill Switches & Cost Guards
    AI_EMERGENCY_KILL_SWITCH: bool = os.getenv("AI_EMERGENCY_KILL_SWITCH", "").strip().lower() in ("true", "1", "yes")
    VTO_EMERGENCY_KILL_SWITCH: bool = os.getenv("VTO_EMERGENCY_KILL_SWITCH", "").strip().lower() in ("true", "1", "yes")
    MAX_IMAGE_DIMENSION: int = int(os.getenv("MAX_IMAGE_DIMENSION", "4096").strip() or "4096")
    MAX_LIVE_SESSION_SECONDS: int = int(os.getenv("MAX_LIVE_SESSION_SECONDS", "1800").strip() or "1800")
    TRYON_JOB_TIMEOUT_SECONDS: int = int(os.getenv("TRYON_JOB_TIMEOUT_SECONDS", "180").strip() or "180")

    # Firebase
    FIREBASE_WEB_API_KEY: str = os.getenv("FIREBASE_WEB_API_KEY", "").strip()
    FIREBASE_STORAGE_BUCKET: str = os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()
    FIREBASE_CREDENTIALS_PATH: Path | None = (
        Path(os.getenv("FIREBASE_CREDENTIALS_PATH", "").strip())
        if os.getenv("FIREBASE_CREDENTIALS_PATH", "").strip()
        else (Path("serviceAccountKey.json") if Path("serviceAccountKey.json").is_file() else None)
    )
    FIREBASE_CREDENTIALS_JSON: str = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()
    FIREBASE_PROJECT_ID: str = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    FIREBASE_PRIVATE_KEY_ID: str = os.getenv("FIREBASE_PRIVATE_KEY_ID", "").strip()
    FIREBASE_PRIVATE_KEY: str = os.getenv("FIREBASE_PRIVATE_KEY", "")
    FIREBASE_CLIENT_EMAIL: str = os.getenv("FIREBASE_CLIENT_EMAIL", "").strip()
    FIREBASE_CLIENT_ID: str = os.getenv("FIREBASE_CLIENT_ID", "").strip()
    FIREBASE_CLIENT_X509_CERT_URL: str = os.getenv(
        "FIREBASE_CLIENT_X509_CERT_URL",
        "",
    ).strip()
    # Temporary control for operator-confirmed wallet credits. Replace this
    # endpoint guard with payment-provider verification when payments launch.
    WALLET_TOPUP_SECRET: str = os.getenv("WALLET_TOPUP_SECRET", "")
    # Gift payments remain unavailable until provider credentials and a signed
    # webhook flow are configured. Browser requests never verify payments.
    PAYMENT_PROVIDER: str = os.getenv("PAYMENT_PROVIDER", "").strip().lower()
    RAZORPAY_KEY_ID: str = os.getenv("RAZORPAY_KEY_ID", "")
    RAZORPAY_KEY_SECRET: str = os.getenv("RAZORPAY_KEY_SECRET", "")
    RAZORPAY_WEBHOOK_SECRET: str = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    FIREBASE_TOKEN_URI: str = os.getenv(
        "FIREBASE_TOKEN_URI",
        "https://oauth2.googleapis.com/token",
    ).strip()

    # Distributed State & Caching
    REDIS_HOST: str = os.getenv("REDIS_HOST", "").strip()
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "10000" if "redis.azure.net" in os.getenv("REDIS_HOST", "").lower() else "6379").strip() or "6379")
    REDIS_USERNAME: str = os.getenv("REDIS_USERNAME", "default").strip() or "default"
    REDIS_PASSWORD: str = os.getenv("REDIS_PASSWORD", "").strip("\r\n")
    REDIS_SSL: bool = (
        os.getenv("REDIS_SSL", "").strip().lower() in ("true", "1", "yes")
        or (bool(os.getenv("REDIS_HOST")) and ("redis.azure.net" in os.getenv("REDIS_HOST", "").lower() or os.getenv("REDIS_PORT") == "10000"))
    )
    REDIS_CLUSTER_MODE: bool = (
        os.getenv("REDIS_CLUSTER_MODE", "").strip().lower() in ("true", "1", "yes")
        or (bool(os.getenv("REDIS_HOST")) and "redis.azure.net" in os.getenv("REDIS_HOST", "").lower())
    )
    REDIS_URL: str = os.getenv("REDIS_URL", "").strip()
    REDIS_TIMEOUT_SECONDS: float = float(os.getenv("REDIS_TIMEOUT_SECONDS", "2.0"))

    # Sentry Monitoring (Phase 5B)
    SENTRY_DSN: str = os.getenv("SENTRY_DSN", "").strip()
    SENTRY_ENVIRONMENT: str = os.getenv("SENTRY_ENVIRONMENT", "").strip() or os.getenv("ENV", "development").strip()
    SENTRY_RELEASE: str = os.getenv("SENTRY_RELEASE", "").strip() or "zipright-backend@1.0.0"

    # Production Webhook & Admin Configuration
    BILLING_WEBHOOK_SECRET: str = os.getenv("BILLING_WEBHOOK_SECRET", "").strip()
    ADMIN_USER_IDS: list[str] = [uid.strip() for uid in os.getenv("ADMIN_USER_IDS", "").split(",") if uid.strip()]

    # Dual-Provider Architecture (Firebase vs Appwrite)
    DATABASE_PROVIDER: str = os.getenv("DATABASE_PROVIDER", "firebase").strip().lower()
    AUTH_PROVIDER: str = os.getenv("AUTH_PROVIDER", "firebase").strip().lower()
    STORAGE_PROVIDER: str = os.getenv("STORAGE_PROVIDER", "firebase").strip().lower()

    def validate_production_configuration(self) -> list[str]:
        """Validate all required secrets for production environment; returns list of missing secrets."""
        missing = []
        if self.ENV.lower() in ("production", "prod"):
            if not self.BILLING_WEBHOOK_SECRET:
                missing.append("BILLING_WEBHOOK_SECRET")
            if self.PAYMENT_PROVIDER == "razorpay" and not self.RAZORPAY_KEY_SECRET:
                missing.append("RAZORPAY_KEY_SECRET")
            if not self.SENTRY_DSN:
                missing.append("SENTRY_DSN")
            if not self.get_firebase_credentials_dict() and not (self.FIREBASE_CREDENTIALS_PATH and self.FIREBASE_CREDENTIALS_PATH.is_file()):
                missing.append("FIREBASE_CREDENTIALS")
        return missing

    def get_firebase_credentials_dict(self) -> dict[str, str] | None:
        if self.FIREBASE_CREDENTIALS_JSON:
            try:
                payload = json.loads(self.FIREBASE_CREDENTIALS_JSON)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    "FIREBASE_CREDENTIALS_JSON is not valid JSON."
                ) from exc

            if not isinstance(payload, dict):
                raise RuntimeError(
                    "FIREBASE_CREDENTIALS_JSON must decode to a JSON object."
                )

            return payload

        required_fields_present = all(
            [
                self.FIREBASE_PROJECT_ID,
                self.FIREBASE_PRIVATE_KEY,
                self.FIREBASE_CLIENT_EMAIL,
            ]
        )
        if not required_fields_present:
            return None

        credentials_dict = {
            "type": "service_account",
            "project_id": self.FIREBASE_PROJECT_ID,
            "private_key": self.FIREBASE_PRIVATE_KEY.replace("\\n", "\n"),
            "client_email": self.FIREBASE_CLIENT_EMAIL,
            "token_uri": self.FIREBASE_TOKEN_URI,
        }

        if self.FIREBASE_PRIVATE_KEY_ID:
            credentials_dict["private_key_id"] = self.FIREBASE_PRIVATE_KEY_ID
        if self.FIREBASE_CLIENT_ID:
            credentials_dict["client_id"] = self.FIREBASE_CLIENT_ID
        if self.FIREBASE_CLIENT_X509_CERT_URL:
            credentials_dict["client_x509_cert_url"] = self.FIREBASE_CLIENT_X509_CERT_URL

        return credentials_dict


settings = Settings()
