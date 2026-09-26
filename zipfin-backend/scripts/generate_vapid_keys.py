"""
Secure VAPID Key Pair Generator and Configurator for Web Push.

Generates standard RFC 8292 NIST P-256 EC VAPID keys, stores them securely
in local environment files without exposing the private key in console or logs.
"""
from __future__ import annotations

import base64
import os
import sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

def urlsafe_b64encode_no_padding(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

def generate_and_configure_vapid():
    backend_dir = Path(__file__).resolve().parent.parent
    root_dir = backend_dir.parent
    frontend_dir = root_dir / "zipfend"

    # Generate EC private key using NIST P-256
    private_key = ec.generate_private_key(ec.SECP256R1())

    # Raw 32-byte private key scalar
    private_numbers = private_key.private_numbers()
    private_raw = private_numbers.private_value.to_bytes(32, byteorder="big")
    private_b64 = urlsafe_b64encode_no_padding(private_raw)

    # Raw 65-byte uncompressed public key point (0x04 || X || Y)
    public_key = private_key.public_key()
    public_raw = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    public_b64 = urlsafe_b64encode_no_padding(public_raw)

    subject = "mailto:security@zipright.in"

    # Update zipfin-backend/.env
    backend_env = backend_dir / ".env"
    existing_lines = backend_env.read_text(encoding="utf-8").splitlines() if backend_env.exists() else []
    filtered = [l for l in existing_lines if not any(l.startswith(k) for k in ("VAPID_PUBLIC_KEY=", "VAPID_PRIVATE_KEY=", "VAPID_SUBJECT="))]
    filtered.append(f"VAPID_PUBLIC_KEY={public_b64}")
    filtered.append(f"VAPID_PRIVATE_KEY={private_b64}")
    filtered.append(f"VAPID_SUBJECT={subject}")
    backend_env.write_text("\n".join(filtered) + "\n", encoding="utf-8")

    # Update zipfend/.env
    frontend_env = frontend_dir / ".env"
    if frontend_env.exists():
        f_lines = frontend_env.read_text(encoding="utf-8").splitlines()
        f_filtered = [l for l in f_lines if not l.startswith("VITE_VAPID_PUBLIC_KEY=")]
        f_filtered.append(f"VITE_VAPID_PUBLIC_KEY={public_b64}")
        frontend_env.write_text("\n".join(f_filtered) + "\n", encoding="utf-8")

    print("[SUCCESS] Production VAPID key pair generated and configured securely.")
    print(f"[INFO] VAPID Subject: {subject}")
    print(f"[INFO] VAPID Public Key Length: {len(public_b64)} chars (NIST P-256 standard format)")
    print("[INFO] Private key stored securely in environment files; never displayed.")

if __name__ == "__main__":
    generate_and_configure_vapid()
