"""
Secure Injector & Verifier for Google OAuth and India SMS Credentials.

Reads secrets strictly from .env.appwrite.local or environment variables.
Never outputs secrets, passwords, or tokens in logs or stdout.
"""
from __future__ import annotations

import os
import sys
import json
import logging
import requests
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from appwrite_config import appwrite_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

ENV_LOCAL_PATH = Path(__file__).resolve().parent.parent / ".env.appwrite.local"
CONSOLE_ENDPOINT = os.environ.get("APPWRITE_ENDPOINT", "https://appwrite.zipright.in/v1")
ADMIN_EMAIL = "zipright2025@gmail.com"
PROJECT_ID = appwrite_settings.PROJECT_ID


def read_local_env() -> dict[str, str]:
    env = {}
    if ENV_LOCAL_PATH.exists():
        for line in ENV_LOCAL_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_admin_session() -> requests.Session:
    env = read_local_env()
    pwd = os.environ.get("APPWRITE_ADMIN_PASSWORD") or env.get("APPWRITE_ADMIN_PASSWORD")
    if not pwd:
        raise ValueError("APPWRITE_ADMIN_PASSWORD not found in environment or .env.appwrite.local")

    session = requests.Session()
    login_res = session.post(
        f"{CONSOLE_ENDPOINT}/account/sessions/email",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"email": ADMIN_EMAIL, "password": pwd}
    )
    if login_res.status_code not in (200, 201):
        raise RuntimeError(f"Appwrite console authentication failed: HTTP {login_res.status_code}")
    return session


def configure_google_oauth(client_id: str, client_secret: str) -> bool:
    session = get_admin_session()
    res = session.patch(
        f"{CONSOLE_ENDPOINT}/projects/{PROJECT_ID}/oauth2",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={
            "provider": "google",
            "appId": client_id,
            "secret": client_secret,
            "enabled": True
        }
    )
    if res.status_code in (200, 201):
        logger.info("Google OAuth 2.0 configuration updated on project '%s'.", PROJECT_ID)
        return True
    logger.error("Failed to update Google OAuth: HTTP %d - %s", res.status_code, res.text)
    return False


def verify_google_oauth_redirect() -> dict:
    url = f"{CONSOLE_ENDPOINT}/account/sessions/oauth2/google?project={PROJECT_ID}&success=http://localhost:3000/%23/welcome&failure=http://localhost:3000/%23/login"
    r = requests.get(url, allow_redirects=False)
    location = r.headers.get("Location", "")
    is_valid = r.status_code in (301, 302) and "accounts.google.com" in location
    return {
        "status_code": r.status_code,
        "redirects_to_google": is_valid,
        "has_client_id": "client_id=" in location
    }


def configure_sms_provider(provider_type: str, auth_key: str, sender_id: str, template_id: str = "") -> bool:
    session = get_admin_session()
    headers_api = {
        "X-Appwrite-Project": PROJECT_ID,
        "X-Appwrite-Key": appwrite_settings.API_KEY,
        "Content-Type": "application/json"
    }

    if provider_type.lower() == "msg91":
        # Check if provider exists
        payload = {
            "providerId": "msg91-live",
            "name": "MSG91 India DLT Route",
            "senderId": sender_id,
            "authKey": auth_key,
            "enabled": True
        }
        if template_id:
            payload["templateId"] = template_id

        res = session.post(f"{CONSOLE_ENDPOINT}/messaging/providers/msg91", headers=headers_api, json=payload)
        if res.status_code in (200, 201):
            logger.info("MSG91 SMS provider registered successfully.")
            return True
        logger.error("Failed to configure MSG91: HTTP %d - %s", res.status_code, res.text)
        return False
    elif provider_type.lower() == "twilio":
        payload = {
            "providerId": "twilio-live",
            "name": "Twilio Live SMS",
            "from": sender_id,
            "accountSid": auth_key.split(":")[0] if ":" in auth_key else auth_key,
            "authToken": auth_key.split(":")[1] if ":" in auth_key else "",
            "enabled": True
        }
        res = session.post(f"{CONSOLE_ENDPOINT}/messaging/providers/twilio", headers=headers_api, json=payload)
        return res.status_code in (200, 201)
    else:
        logger.error("Unsupported SMS provider type: %s", provider_type)
        return False


def send_test_sms_otp(phone_number: str) -> dict:
    """Sends OTP using Appwrite client API."""
    url = f"{CONSOLE_ENDPOINT}/account/tokens/phone"
    headers = {
        "X-Appwrite-Project": PROJECT_ID,
        "Content-Type": "application/json"
    }
    res = requests.post(url, headers=headers, json={"userId": "unique()", "phone": phone_number})
    if res.status_code in (200, 201):
        data = res.json()
        return {"success": True, "userId": data.get("userId"), "status": res.status_code}
    return {"success": False, "status": res.status_code, "error": res.text}


def verify_sms_otp(user_id: str, otp_secret: str) -> dict:
    """Verifies received OTP and creates session."""
    url = f"{CONSOLE_ENDPOINT}/account/sessions/phone"
    headers = {
        "X-Appwrite-Project": PROJECT_ID,
        "Content-Type": "application/json"
    }
    res = requests.post(url, headers=headers, json={"userId": user_id, "secret": otp_secret})
    if res.status_code in (200, 201):
        data = res.json()
        return {"success": True, "sessionId": data.get("$id"), "status": res.status_code}
    return {"success": False, "status": res.status_code, "error": res.text}


if __name__ == "__main__":
    env = read_local_env()
    print("--------------------------------------------------")
    print("Provider Credentials Check:")
    print("  Google Client ID present:", bool(env.get("GOOGLE_OAUTH_CLIENT_ID")))
    print("  Google Client Secret present:", bool(env.get("GOOGLE_OAUTH_CLIENT_SECRET")))
    print("  SMS Provider present:", bool(env.get("SMS_PROVIDER")))
    print("  SMS Auth Key present:", bool(env.get("SMS_AUTH_KEY")))
    print("  SMS Sender/Header ID present:", bool(env.get("SMS_SENDER_ID")))
    print("  SMS Template ID present:", bool(env.get("SMS_TEMPLATE_ID")))
    print("  Test Phone Number present:", bool(env.get("TEST_PHONE_NUMBER")))
    print("--------------------------------------------------")

    # If Google OAuth credentials exist in .env.appwrite.local, apply and verify
    if env.get("GOOGLE_OAUTH_CLIENT_ID") and env.get("GOOGLE_OAUTH_CLIENT_SECRET"):
        print("Configuring Google OAuth from .env.appwrite.local...")
        ok = configure_google_oauth(env["GOOGLE_OAUTH_CLIENT_ID"], env["GOOGLE_OAUTH_CLIENT_SECRET"])
        print("  Update result:", ok)
        check = verify_google_oauth_redirect()
        print("  Redirect check:", check)

    # If SMS credentials exist in .env.appwrite.local, apply and verify
    if env.get("SMS_PROVIDER") and env.get("SMS_AUTH_KEY") and env.get("SMS_SENDER_ID"):
        print("Configuring SMS Provider from .env.appwrite.local...")
        ok = configure_sms_provider(
            env["SMS_PROVIDER"],
            env["SMS_AUTH_KEY"],
            env["SMS_SENDER_ID"],
            env.get("SMS_TEMPLATE_ID", "")
        )
        print("  Update result:", ok)
