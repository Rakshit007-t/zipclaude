"""
Appwrite Console & API Key Automated Provisioner
Securely configures organization, project, and server-side API key.
Stores the secret only in the local .env file. Never prints secrets or passwords.
"""
import os
import sys
import requests
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from appwrite_config import get_effective_appwrite_target, get_appwrite_client

ADMIN_EMAIL = "zipright2025@gmail.com"
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

ADMIN_PASSWORD = None
ORG_NAME = "ZipRight"
PROJECT_ID = "zipright-staging"
PROJECT_NAME = "zipright-staging"
KEY_NAME = "ZipRIGHT Staging Secret"

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

def main():
    endpoint, host_hdr = get_effective_appwrite_target()
    session = requests.Session()
    if host_hdr:
        session.verify = False
    base_headers = {"X-Appwrite-Project": "console"}
    if host_hdr:
        base_headers["Host"] = host_hdr

    admin_pwd = get_admin_password()
    
    # 1. Login to console
    login_headers = {**base_headers, "Content-Type": "application/json"}
    login_res = session.post(
        f"{endpoint}/account/sessions/email",
        headers=login_headers,
        json={"email": ADMIN_EMAIL, "password": admin_pwd}
    )
    if login_res.status_code not in (200, 201):
        print(f"FAILED: Console login failed with status {login_res.status_code}: {login_res.text}")
        sys.exit(1)
        
    # 2. Check / create team (Organization)
    teams_res = session.get(
        f"{endpoint}/teams",
        headers=base_headers
    )
    if teams_res.status_code != 200:
        print(f"FAILED: Fetching teams failed with status {teams_res.status_code}")
        sys.exit(1)
        
    teams = teams_res.json().get("teams", [])
    target_team = next((t for t in teams if t.get("name") == ORG_NAME), None)
    if not target_team:
        create_team_res = session.post(
            f"{endpoint}/teams",
            headers={**base_headers, "Content-Type": "application/json"},
            json={"teamId": "unique()", "name": ORG_NAME}
        )
        if create_team_res.status_code not in (200, 201):
            print(f"FAILED: Creating organization failed: {create_team_res.status_code}")
            sys.exit(1)
        target_team = create_team_res.json()
        
    team_id = target_team["$id"]
    org_headers = {**base_headers, "X-Appwrite-Organization": team_id}
    
    # 3. Check / create project
    projects_res = session.get(
        f"{endpoint}/projects",
        headers=org_headers
    )
    projects = projects_res.json().get("projects", []) if projects_res.status_code == 200 else []
    target_project = next((p for p in projects if p.get("$id") == PROJECT_ID), None)
    
    if not target_project:
        create_proj_res = session.post(
            f"{endpoint}/projects",
            headers={**org_headers, "Content-Type": "application/json"},
            json={"projectId": PROJECT_ID, "name": PROJECT_NAME, "teamId": team_id}
        )
        if create_proj_res.status_code not in (200, 201):
            print(f"FAILED: Creating project failed: {create_proj_res.status_code}")
            sys.exit(1)
            
    # 4. Check existing keys and create API key
    keys_res = session.get(
        f"{endpoint}/projects/{PROJECT_ID}/keys",
        headers=org_headers
    )
    existing_keys = keys_res.json().get("keys", []) if keys_res.status_code == 200 else []
    for k in existing_keys:
        if k.get("name") == KEY_NAME:
            # Delete old key to ensure we have the fresh secret token
            session.delete(
                f"{endpoint}/projects/{PROJECT_ID}/keys/{k['$id']}",
                headers=org_headers
            )
            
    # All server-side scopes valid in Appwrite 1.6.0
    scopes = [
        "sessions.write", "users.read", "users.write",
        "teams.read", "teams.write",
        "databases.read", "databases.write",
        "collections.read", "collections.write",
        "attributes.read", "attributes.write",
        "indexes.read", "indexes.write",
        "documents.read", "documents.write",
        "files.read", "files.write",
        "buckets.read", "buckets.write",
        "functions.read", "functions.write",
        "execution.read", "execution.write",
        "locale.read", "avatars.read", "health.read",
        "providers.read", "providers.write",
        "messages.read", "messages.write",
        "topics.read", "topics.write",
        "subscribers.read", "subscribers.write",
        "targets.read", "targets.write",
        "rules.read", "rules.write",
        "migrations.read", "migrations.write",
        "vcs.read", "vcs.write", "assistant.read"
    ]
    
    create_key_res = session.post(
        f"{endpoint}/projects/{PROJECT_ID}/keys",
        headers={**org_headers, "Content-Type": "application/json"},
        json={
            "keyId": "unique()",
            "name": KEY_NAME,
            "scopes": scopes,
            "expire": None
        }
    )
    if create_key_res.status_code not in (200, 201):
        print(f"FAILED: Creating API key failed with status {create_key_res.status_code}: {create_key_res.text}")
        sys.exit(1)
        
    key_doc = create_key_res.json()
    secret = key_doc.get("secret")
    if not secret:
        print("FAILED: No secret returned in key document")
        sys.exit(1)
        
    # 5. Store secret in zipfin-backend/.env securely
    env_lines = []
    if ENV_FILE.exists():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            env_lines = f.readlines()
            
    managed_keys = {
        "APPWRITE_ENDPOINT": "https://appwrite.zipright.in/v1",
        "APPWRITE_PROJECT_ID": PROJECT_ID,
        "APPWRITE_API_KEY": secret,
        "APPWRITE_DATABASE_ID": "zipright-staging-db",
        "APPWRITE_BUCKET_PUBLIC": "zipright-public",
        "APPWRITE_BUCKET_COMMUNITY": "zipright-community",
        "APPWRITE_BUCKET_PRIVATE": "zipright-private",
        "DATABASE_PROVIDER": "appwrite",
        "AUTH_PROVIDER": "appwrite",
        "STORAGE_PROVIDER": "appwrite"
    }
    
    new_lines = []
    seen = set()
    for line in env_lines:
        line_clean = line.strip()
        if "=" in line_clean and not line_clean.startswith("#"):
            k = line_clean.split("=", 1)[0].strip()
            if k in managed_keys:
                new_lines.append(f"{k}={managed_keys[k]}\n")
                seen.add(k)
                continue
        new_lines.append(line)
        
    for k, v in managed_keys.items():
        if k not in seen:
            new_lines.append(f"{k}={v}\n")
            
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
        
    # 6. Verify SDK connectivity using the new API key
    from appwrite.services.databases import Databases
    
    client = get_appwrite_client(api_key=secret)
    db_service = Databases(client)
    db_list = db_service.list()
    
    print("--------------------------------------------------")
    print("Appwrite Console Setup: SUCCESS")
    print(f"Organization: {ORG_NAME} (ID: {team_id})")
    print(f"Project: {PROJECT_ID}")
    print(f"API Key: {KEY_NAME} (Granted scopes: {len(scopes)})")
    print(f"Secret Stored: {ENV_FILE}")
    total_dbs = getattr(db_list, 'total', len(getattr(db_list, 'databases', [])))
    print(f"Live SDK Verification: PASSED (Databases available: {total_dbs})")
    print("--------------------------------------------------")

if __name__ == "__main__":
    main()
