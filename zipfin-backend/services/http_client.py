import ipaddress
import logging
import socket
from typing import Mapping
from urllib.parse import urlparse, urlunparse, urljoin
import time

import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB

class SecurityError(Exception):
    pass

class FetchError(Exception):
    pass

def is_safe_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
        # Robust check for private, loopback, link-local, etc.
        return not (
            ip.is_private or 
            ip.is_loopback or 
            ip.is_link_local or 
            ip.is_multicast or 
            ip.is_reserved or 
            ip.is_unspecified
        )
    except ValueError:
        return False

def validate_hostname_safety(hostname: str) -> str:
    """Resolve hostname once and return the validated IP.
    
    Raises SecurityError if the IP is unsafe, FetchError if DNS fails.
    """
    try:
        ip = socket.gethostbyname(hostname)
        if not is_safe_ip(ip):
            raise SecurityError(f"Hostname {hostname} resolves to unsafe IP {ip}")
        return ip
    except socket.gaierror as e:
        raise FetchError(f"DNS resolution failed for {hostname}: {e}")

def _build_ip_url(original_url: str, resolved_ip: str) -> tuple[str, str]:
    """Replace the hostname in the URL with the resolved IP to prevent DNS rebinding.
    
    Returns (ip_url, original_hostname) so the caller can set the Host header.
    """
    parsed = urlparse(original_url)
    original_hostname = parsed.hostname or ""
    # Rebuild netloc with the resolved IP (preserving port if any)
    if parsed.port and not (
        (parsed.scheme == "http" and parsed.port == 80)
        or (parsed.scheme == "https" and parsed.port == 443)
    ):
        new_netloc = f"{resolved_ip}:{parsed.port}"
    else:
        new_netloc = resolved_ip
    ip_url = urlunparse((
        parsed.scheme,
        new_netloc,
        parsed.path,
        parsed.params,
        parsed.query,
        parsed.fragment,
    ))
    return ip_url, original_hostname

def safe_http_get(url: str, headers: Mapping[str, str], timeout: tuple[float, float], retries: int = 1) -> requests.Response:
    current_url = url
    max_redirects = 5

    for attempt in range(retries + 1):
        try:
            for _ in range(max_redirects):
                parsed = urlparse(current_url)
                hostname = parsed.hostname
                if not hostname:
                    raise FetchError("Invalid URL: missing hostname")
                
                if hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
                    raise SecurityError("Localhost is blocked")
                
                # Resolve DNS once and validate the IP for the current URL
                resolved_ip = validate_hostname_safety(hostname)

                # Build a URL that connects directly to the resolved IP (prevents DNS rebinding)
                ip_url, original_hostname = _build_ip_url(current_url, resolved_ip)
                
                # Merge headers with Host header pointing to the original hostname
                merged_headers = dict(headers)
                merged_headers["Host"] = original_hostname

                # Disable automatic redirects
                with requests.get(ip_url, headers=merged_headers, timeout=timeout, allow_redirects=False, stream=True, verify=True) as response:
                    # Manually handle redirects
                    if response.is_redirect:
                        location = response.headers.get("Location")
                        if not location:
                            raise FetchError("Redirect without Location header")
                        current_url = urljoin(current_url, location)
                        continue

                    response.raise_for_status()

                    content_type = response.headers.get("Content-Type", "").lower()
                    if "html" not in content_type and "xml" not in content_type:
                        raise FetchError(f"Invalid Content-Type: {content_type}. Only HTML and XML are allowed.")

                    content_length = response.headers.get("Content-Length")
                    if content_length and int(content_length) > MAX_FILE_SIZE_BYTES:
                        raise FetchError(f"Response too large: {content_length} bytes")

                    chunks = []
                    bytes_downloaded = 0
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            bytes_downloaded += len(chunk)
                            if bytes_downloaded > MAX_FILE_SIZE_BYTES:
                                raise FetchError("Response exceeded max size limit during stream")
                            chunks.append(chunk)

                    # Overwrite response properties so it acts like a normal non-streamed response
                    final_content = b"".join(chunks)
                    response._content = final_content
                    response._content_consumed = True
                    # Preserve the final URL
                    response.url = current_url
                    return response
            raise FetchError("Too many redirects")
        except requests.exceptions.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(0.5)

    raise FetchError(f"Failed to fetch {url} after {retries} retries: {last_exc}")
