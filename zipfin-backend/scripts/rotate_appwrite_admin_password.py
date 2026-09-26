"""
Rotate Appwrite Console Admin Password and clean up hardcoded secrets.
Follows zero-secret-exposure rules: never prints old or new password.
"""
from __future__ import annotations

import os
import sys
import secrets
import string
import logging
from pathlib import Path
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

CONSOLE_ENDPOINT = os.environ.get("APPWRITE_ENDPOINT", "https://appwrite.zipright.in/v1")
ADMIN_EMAIL = os.environ.get("APPWRITE_ADMIN_EMAIL", "zipright2025@gmail.com")


def generate_secure_password(length: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*-_=+"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in pwd)
                and any(c.isupper() for c in pwd)
                and any(c.isdigit() for c in pwd)
                and any(c in "!@#$%^&*-_=+" for c in pwd)):
            return pwd


def rotate_admin_password():
    session = requests.Session()

    # Look for current password in environment or known fallback
    env_path = Path(__file__).resolve().parent.parent / ".env.appwrite.local"
    current_password = os.environ.get("APPWRITE_ADMIN_PASSWORD")
    if not current_password and env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("APPWRITE_ADMIN_PASSWORD="):
                current_password = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

    if not current_password:
        raise ValueError("APPWRITE_ADMIN_PASSWORD environment variable or local config is required for rotation")

    # 1. Login to console
    login_res = session.post(
        f"{CONSOLE_ENDPOINT}/account/sessions/email",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"email": ADMIN_EMAIL, "password": current_password},
        timeout=10,
    )

    if login_res.status_code not in (200, 201):
        # Try if already rotated
        logger.info("Current password did not authenticate (code %d). Checking if already rotated...", login_res.status_code)
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("APPWRITE_ADMIN_PASSWORD="):
                    alt_pwd = line.split("=", 1)[1].strip().strip('"').strip("'")
                    alt_res = session.post(
                        f"{CONSOLE_ENDPOINT}/account/sessions/email",
                        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
                        json={"email": ADMIN_EMAIL, "password": alt_pwd},
                        timeout=10,
                    )
                    if alt_res.status_code in (200, 201):
                        logger.info("Admin password already rotated and working with secure local configuration.")
                        return True
        logger.error("Unable to authenticate to console for rotation.")
        return False

    logger.info("Authenticated to Appwrite Console session successfully.")

    # 2. Generate new cryptographically secure password
    new_password = generate_secure_password(32)

    # 3. Update password in Appwrite
    update_res = session.patch(
        f"{CONSOLE_ENDPOINT}/account/password",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"password": new_password, "oldPassword": current_password},
        timeout=10,
    )

    if update_res.status_code not in (200, 201):
        logger.error("Password rotation failed: HTTP %d", update_res.status_code)
        return False

    logger.info("Admin password rotated successfully in Appwrite.")

    # 4. Save new password securely in local git-ignored env file (.env.appwrite.local)
    lines = []
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if not line.startswith("APPWRITE_ADMIN_PASSWORD="):
                lines.append(line)
    lines.append(f'APPWRITE_ADMIN_PASSWORD="{new_password}"')
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logger.info("Updated secure local credential store at %s", env_path.name)

    # 5. Verify authentication with new password
    verify_session = requests.Session()
    verify_res = verify_session.post(
        f"{CONSOLE_ENDPOINT}/account/sessions/email",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"email": ADMIN_EMAIL, "password": new_password},
        timeout=10,
    )
    if verify_res.status_code in (200, 201):
        logger.info("Verification of new rotated password: SUCCESS (HTTP %d)", verify_res.status_code)
    else:
        logger.error("Verification of new rotated password FAILED: HTTP %d", verify_res.status_code)
        return False

    # 6. Verify old password is completely INVALID
    old_verify_session = requests.Session()
    old_verify_res = old_verify_session.post(
        f"{CONSOLE_ENDPOINT}/account/sessions/email",
        headers={"X-Appwrite-Project": "console", "Content-Type": "application/json"},
        json={"email": ADMIN_EMAIL, "password": current_password},
        timeout=10,
    )
    if old_verify_res.status_code in (400, 401):
        logger.info("Verification of old password invalidation: SUCCESS (HTTP %d - Invalid credentials)", old_verify_res.status_code)
    else:
        logger.error("Verification of old password invalidation FAILED: HTTP %d", old_verify_res.status_code)
        return False

    # Clean up test sessions
    try:
        session.delete(f"{CONSOLE_ENDPOINT}/account/sessions/current", headers={"X-Appwrite-Project": "console"})
        verify_session.delete(f"{CONSOLE_ENDPOINT}/account/sessions/current", headers={"X-Appwrite-Project": "console"})
    except Exception:
        pass

    return True


if __name__ == "__main__":
    success = rotate_admin_password()
    print("ROTATION_RESULT:", "SUCCESS" if success else "FAILED")

