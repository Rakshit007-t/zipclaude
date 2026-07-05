import json
import os
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class Settings:
    # App Settings
    ENV: str = os.getenv("ENV", "development")

    # External APIs
    REPLICATE_API_TOKEN: str | None = os.getenv("REPLICATE_API_TOKEN")
    INSIGHTFACE_API_KEY: str | None = os.getenv("INSIGHTFACE_API_KEY")
    FIRECRAWL_API_KEY: str = os.getenv("FIRECRAWL_API_KEY", "").strip()

    # Firebase
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
    FIREBASE_TOKEN_URI: str = os.getenv(
        "FIREBASE_TOKEN_URI",
        "https://oauth2.googleapis.com/token",
    ).strip()

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
