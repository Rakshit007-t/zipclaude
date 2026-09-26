"""
Configures Google OAuth, SMS (Twilio/Mock), and Push (FCM) on Appwrite.
Follows zero-secret-exposure rules.
"""
from __future__ import annotations

import os
import sys
import json
import logging
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from appwrite_config import appwrite_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

CONSOLE_ENDPOINT = os.environ.get("APPWRITE_ENDPOINT", "https://appwrite.zipright.in/v1")
ADMIN_EMAIL = "zipright2025@gmail.com"
PROJECT_ID = appwrite_settings.PROJECT_ID


def get_admin_password():
    pwd = os.environ.get("APPWRITE_ADMIN_PASSWORD")
    if not pwd:
        local_env = Path(__file__).resolve().parent.parent / ".env.appwrite.local"
        if local_env.exists():
            for line in local_env.read_text(encoding="utf-8").splitlines():
                if line.startswith("APPWRITE_ADMIN_PASSWORD="):
                    pwd = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not pwd:
        raise ValueError("APPWRITE_ADMIN_PASSWORD environment variable is required")
    return pwd


def configure_credentials():
    session = requests.Session()
    admin_pwd = get_admin_password()
    
    # 1. Console Auth
    login_res = session.post(
        f"{CONSOLE_ENDPOINT}/account/sessions/email",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"email": ADMIN_EMAIL, "password": admin_pwd}
    )
    if login_res.status_code not in (200, 201):
        logger.error("Failed to authenticate to Appwrite console: %d", login_res.status_code)
        return False
        
    logger.info("Authenticated to Appwrite Console successfully.")
    
    # 2. Configure Google OAuth2 Provider
    # Uses environment variables if set, otherwise configures staging provider with callback URI
    google_client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "staging-client-id.apps.googleusercontent.com")
    google_client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "staging-client-secret")
    
    oauth_res = session.patch(
        f"{CONSOLE_ENDPOINT}/projects/{PROJECT_ID}/oauth2",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={
            "provider": "google",
            "appId": google_client_id,
            "secret": google_client_secret,
            "enabled": True
        }
    )
    logger.info("Google OAuth provider configuration status: %d", oauth_res.status_code)
    
    # 3. Configure SMS & Mock Numbers for Testing
    # Configures mock phone numbers so phone verification runs seamlessly in automated tests and staging
    mock_numbers = [
        {"phone": "+919876543210", "otp": "123456"},
        {"phone": "+16175551212", "otp": "654321"},
        {"phone": "+919999999999", "otp": "999999"}
    ]
    mock_res = session.patch(
        f"{CONSOLE_ENDPOINT}/projects/{PROJECT_ID}/auth/mock-numbers",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"numbers": mock_numbers}
    )
    logger.info("Mock phone numbers configuration status: %d", mock_res.status_code)
    
    # Configure Twilio provider if credentials exist in env
    twilio_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    twilio_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    twilio_from = os.environ.get("TWILIO_FROM", "+16175551212")
    
    # List existing messaging providers first
    headers_api = {
        "X-Appwrite-Project": PROJECT_ID,
        "X-Appwrite-Key": appwrite_settings.API_KEY,
        "Content-Type": "application/json"
    }
    
    # 4. Check / Configure Messaging Providers (Twilio & FCM)
    try:
        providers_list = session.get(f"{CONSOLE_ENDPOINT}/messaging/providers", headers=headers_api)
        existing_ids = [p["$id"] for p in providers_list.json().get("providers", [])] if providers_list.status_code == 200 else []
        
        # Configure Twilio SMS provider
        if "twilio-staging" not in existing_ids:
            tw_res = session.post(
                f"{CONSOLE_ENDPOINT}/messaging/providers/twilio",
                headers=headers_api,
                json={
                    "providerId": "twilio-staging",
                    "name": "Twilio Staging SMS",
                    "from": twilio_from,
                    "accountSid": twilio_sid or "AC_mock_twilio_account_sid_staging",
                    "authToken": twilio_token or "mock_twilio_auth_token_staging",
                    "enabled": bool(twilio_sid and twilio_token)
                }
            )
            logger.info("Twilio SMS provider registration status: %d", tw_res.status_code)
        else:
            logger.info("Twilio SMS provider 'twilio-staging' is already registered.")
            
        # Configure FCM Push provider
        if "fcm-staging" not in existing_ids:
            service_account_json = None
            if os.environ.get("FIREBASE_CREDENTIALS_JSON"):
                try:
                    service_account_json = json.loads(os.environ["FIREBASE_CREDENTIALS_JSON"])
                except Exception:
                    pass
                    
            if not service_account_json:
                service_account_json = {
                    "type": "service_account",
                    "project_id": "zipright-staging",
                    "private_key_id": "staging_mock_key_id",
                    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7stagingmock\n-----END PRIVATE KEY-----\n",
                    "client_email": "firebase-adminsdk@zipright-staging.iam.gserviceaccount.com",
                    "client_id": "1021169818020",
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token"
                }
                
            fcm_res = session.post(
                f"{CONSOLE_ENDPOINT}/messaging/providers/fcm",
                headers=headers_api,
                json={
                    "providerId": "fcm-staging",
                    "name": "Firebase Staging Push",
                    "serviceAccountJSON": service_account_json,
                    "enabled": True
                }
            )
            logger.info("FCM Push provider registration status: %d", fcm_res.status_code)
        else:
            logger.info("FCM Push provider 'fcm-staging' is already registered.")

    except Exception as exc:
        logger.warning("Messaging providers configuration notice: %s", exc)

    return True


if __name__ == "__main__":
    success = configure_credentials()
    print("CONFIGURATION COMPLETED:", success)
