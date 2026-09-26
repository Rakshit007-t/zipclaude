import json
import os
import subprocess
import sys
from dotenv import load_dotenv

load_dotenv()

vapid_pub = os.getenv("VAPID_PUBLIC_KEY", "").strip()
vapid_priv = os.getenv("VAPID_PRIVATE_KEY", "").strip()
vapid_sub = os.getenv("VAPID_SUBJECT", "mailto:security@zipright.com").strip()

if not vapid_pub or not vapid_priv:
    print("ERROR: VAPID keys missing in .env")
    sys.exit(1)

endpoint = os.getenv("TEST_PUSH_ENDPOINT", "https://fcm.googleapis.com/fcm/send/placeholder")
key = os.getenv("TEST_PUSH_KEY", "placeholder-key")
auth = os.getenv("TEST_PUSH_AUTH", "placeholder-auth")

payload = json.dumps({
    "title": "ZipRIGHT Verification",
    "body": "Real Web Push notification verified end-to-end!",
    "url": "http://localhost:3000/#/welcome"
})

cmd = [
    "npx", "--yes", "web-push", "send-notification",
    f"--endpoint={endpoint}",
    f"--key={key}",
    f"--auth={auth}",
    f"--payload={payload}",
    f"--vapid-subject={vapid_sub}",
    f"--vapid-pubkey={vapid_pub}",
    f"--vapid-pvtkey={vapid_priv}"
]

print("Executing web-push delivery via npx...")
# Run without echoing private key to stdout/stderr
res = subprocess.run(cmd, capture_output=True, text=True, shell=True)
if res.returncode == 0:
    print("SUCCESS: Web push sent!")
    print(res.stdout)
else:
    # Filter output to never show private key
    clean_err = res.stderr.replace(vapid_priv, "[REDACTED]")
    clean_out = res.stdout.replace(vapid_priv, "[REDACTED]")
    print(f"FAILED (code {res.returncode}):")
    print(clean_out)
    print(clean_err)
