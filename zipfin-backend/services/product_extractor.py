import html
import ipaddress
import logging
import re
import threading
import time
from collections import deque
from urllib.parse import parse_qsl, urlencode, urlparse, urlunsplit

import requests
from fastapi import HTTPException, status

from core.config import settings
from models.schema import ExtractProductResponse

logger = logging.getLogger(__name__)

FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape"
FIRECRAWL_TIMEOUT_MS = 15000
FIRECRAWL_REQUEST_TIMEOUT_SECONDS = 20
FIRECRAWL_MAX_AGE_MS = 86400000
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 10
MAX_URL_LENGTH = 2048
TRACKING_QUERY_PARAMS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
    "si",
    "spm",
    "utm_campaign",
    "utm_content",
    "utm_id",
    "utm_medium",
    "utm_name",
    "utm_source",
    "utm_term",
}
BLOCKED_HOSTNAMES = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
}
KNOWN_BRANDS = {
    "nike": ("nike",),
    "zara": ("zara",),
    "h&m": ("hm", "h&m", "handm", "h-and-m"),
    "adidas": ("adidas",),
    "uniqlo": ("uniqlo",),
    "puma": ("puma",),
    "levi's": ("levis", "levi's", "levis"),
    "mango": ("mango",),
    "gucci": ("gucci",),
    "prada": ("prada",),
    "reebok": ("reebok",),
    "under armour": ("underarmour", "under-armour", "under armour"),
    "new balance": ("newbalance", "new-balance", "new balance"),
    "hollister": ("hollister",),
    "abercrombie": ("abercrombie", "abercrombiefitch"),
    "gap": ("gap",),
    "old navy": ("oldnavy", "old-navy", "old navy"),
    "banana republic": ("bananarepublic", "banana-republic", "banana republic"),
    "asos": ("asos",),
    "shein": ("shein",),
}
CATEGORY_KEYWORDS = {
    "t-shirt": ("t-shirt", "tshirt", "tee", "tees"),
    "shirt": ("shirt", "shirts", "button-down", "buttondown"),
    "hoodie": ("hoodie", "hoodies", "sweatshirt", "pullover"),
    "jacket": ("jacket", "jackets", "blazer", "coat", "outerwear"),
    "dress": ("dress", "dresses", "gown"),
    "jeans": ("jean", "jeans", "denim"),
    "pants": ("pants", "trousers", "joggers", "leggings", "chinos"),
    "shorts": ("shorts",),
    "skirt": ("skirt", "skirts"),
    "sweater": ("sweater", "sweaters", "knitwear", "cardigan"),
    "shoes": ("shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "sandals"),
    "bag": ("bag", "bags", "backpack", "tote", "purse"),
}
GENERIC_TOKENS = {
    "buy",
    "collection",
    "collections",
    "en",
    "fashion",
    "item",
    "items",
    "men",
    "new",
    "p",
    "page",
    "product",
    "products",
    "shop",
    "store",
    "us",
    "women",
    "www",
}

_product_cache: dict[str, ExtractProductResponse] = {}
_cache_lock = threading.Lock()
_rate_limit_state: dict[str, deque[float]] = {}
_rate_limit_lock = threading.Lock()


def extract_product_details(url: str, requester_id: str) -> ExtractProductResponse:
    resolved_url = _resolve_redirects(url)
    normalized_url = normalize_product_url(resolved_url)
    enforce_rate_limit(requester_id)

    cached = _get_cached_response(normalized_url)
    if cached is not None:
        logger.info("Product extraction cache hit for url=%s", normalized_url)
        return cached

    logger.info("Product extraction cache miss for url=%s", normalized_url)
    url_only_result = _extract_from_url(normalized_url)
    if url_only_result.brand:
        logger.info(
            "Product extraction skipped Firecrawl via URL brand fallback for url=%s brand=%s",
            normalized_url,
            url_only_result.brand,
        )
        _store_cached_response(normalized_url, url_only_result)
        return url_only_result

    firecrawl_result = _extract_with_firecrawl(normalized_url, url_only_result)
    _store_cached_response(normalized_url, firecrawl_result)
    return firecrawl_result


def normalize_product_url(url: str) -> str:
    candidate = url.strip()
    if not candidate:
        raise ValueError("A product URL is required.")
    if len(candidate) > MAX_URL_LENGTH:
        raise ValueError("The product URL is too long.")
    if any(character.isspace() for character in candidate):
        raise ValueError("The product URL must not contain whitespace.")
    if any(ord(character) < 32 for character in candidate):
        raise ValueError("The product URL contains invalid control characters.")

    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only HTTP and HTTPS product URLs are allowed.")
    if not parsed.hostname:
        raise ValueError("The product URL must include a valid hostname.")
    if parsed.username or parsed.password:
        raise ValueError("Embedded credentials are not allowed in product URLs.")

    hostname = parsed.hostname.lower().rstrip(".")
    _validate_hostname(hostname)

    filtered_query = sorted(
        (
            key,
            value,
        )
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_QUERY_PARAMS
    )
    netloc = hostname
    if parsed.port and not (
        (parsed.scheme == "http" and parsed.port == 80)
        or (parsed.scheme == "https" and parsed.port == 443)
    ):
        netloc = f"{hostname}:{parsed.port}"

    normalized_path = re.sub(r"/{2,}", "/", parsed.path or "/")
    normalized_query = urlencode(filtered_query, doseq=True)
    return urlunsplit(
        (
            parsed.scheme.lower(),
            netloc,
            normalized_path,
            normalized_query,
            "",
        )
    )


def enforce_rate_limit(requester_id: str) -> None:
    now = time.time()
    with _rate_limit_lock:
        bucket = _rate_limit_state.setdefault(requester_id, deque())
        while bucket and now - bucket[0] > RATE_LIMIT_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
            logger.warning(
                "Product extraction rate limit triggered for requester=%s",
                requester_id,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many extract-product requests. Please wait a minute and try again.",
                headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
            )
        bucket.append(now)


def _validate_hostname(hostname: str) -> None:
    if hostname in BLOCKED_HOSTNAMES:
        raise ValueError("Local or loopback URLs are not allowed.")
    if hostname.endswith(".local") or hostname.endswith(".internal"):
        raise ValueError("Internal hostnames are not allowed.")

    try:
        ip_address = ipaddress.ip_address(hostname)
    except ValueError:
        return

    if (
        ip_address.is_private
        or ip_address.is_loopback
        or ip_address.is_link_local
        or ip_address.is_multicast
        or ip_address.is_reserved
        or ip_address.is_unspecified
    ):
        raise ValueError("Private or internal network URLs are not allowed.")


def _get_cached_response(url: str) -> ExtractProductResponse | None:
    with _cache_lock:
        cached = _product_cache.get(url)
        if cached is None:
            return None
        return ExtractProductResponse.model_validate(cached.model_dump())


def _store_cached_response(url: str, response: ExtractProductResponse) -> None:
    with _cache_lock:
        _product_cache[url] = ExtractProductResponse.model_validate(response.model_dump())


def _extract_from_url(url: str) -> ExtractProductResponse:
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    path_tokens = _tokenize(f"{hostname} {parsed.path}")
    brand = _detect_brand(" ".join(path_tokens))
    category = _detect_category(" ".join(path_tokens))
    title = _title_from_path(parsed.path)
    return ExtractProductResponse(title=title, brand=brand, category=category)


def _extract_with_firecrawl(
    url: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    if not settings.FIRECRAWL_API_KEY:
        logger.warning(
            "FIRECRAWL_API_KEY is not configured; returning URL-derived extraction for url=%s",
            url,
        )
        return fallback_result

    logger.info("Calling Firecrawl for product extraction url=%s", url)
    try:
        response = requests.post(
            FIRECRAWL_SCRAPE_URL,
            headers={
                "Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "url": url,
                "formats": ["markdown"],
                "onlyMainContent": True,
                "maxAge": FIRECRAWL_MAX_AGE_MS,
                "timeout": FIRECRAWL_TIMEOUT_MS,
            },
            timeout=FIRECRAWL_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except Exception as exc:
        logger.error("Firecrawl request failed entirely for url=%s: %s", url, exc)
        print(f"Firecrawl completely failed: {exc}")
        return fallback_result

    try:
        payload = response.json()
    except ValueError as exc:
        logger.error("Firecrawl returned invalid JSON for url=%s", url)
        print(f"Firecrawl raw response was not JSON: {response.text[:500]}")
        return fallback_result

    data = payload.get("data") if isinstance(payload, dict) else None
    if not payload or not isinstance(payload, dict) or not payload.get("success") or not isinstance(data, dict):
        logger.error("Firecrawl returned an unsuccessful payload for url=%s", url)
        print(f"Firecrawl failed to parse page! Payload snippet: {str(payload)[:500]}")
        return fallback_result

    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    markdown = data.get("markdown") if isinstance(data.get("markdown"), str) else ""

    print("\n--- FIRECRAWL RAW MARKDOWN RESPONSE ---")
    print(markdown[:1000] if markdown else "No Markdown returned.")
    print("---------------------------------------\n")

    h1_match = re.search(r"^#\s+(.+)$", markdown, flags=re.MULTILINE)
    h1_title = h1_match.group(1).strip() if h1_match else ""

    title = _clean_title(
        _first_non_empty(
            metadata.get("ogTitle"),
            metadata.get("title"),
            h1_title,
            fallback_result.title,
        )
    )
    brand = _first_non_empty(
        _detect_brand(
            " ".join(
                value
                for value in (
                    metadata.get("ogSiteName"),
                    metadata.get("title"),
                    metadata.get("description"),
                    markdown[:1200],
                )
                if isinstance(value, str)
            )
        ),
        fallback_result.brand,
        _brand_from_site_name(metadata.get("ogSiteName")),
        _brand_from_domain(url)
    )
    category = _first_non_empty(
        _detect_category(
            " ".join(
                value
                for value in (
                    metadata.get("title"),
                    metadata.get("description"),
                    markdown[:1200],
                    fallback_result.category,
                )
                if isinstance(value, str)
            )
        ),
        fallback_result.category,
    )
    
    price = _extract_price(markdown)
    if not price or price == "N/A":
        if metadata.get("price"):
            price = str(metadata.get("price"))
        else:
            price = "N/A"
            
    image = _extract_image(metadata, markdown)
    if not image:
        image = "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&h=500&fit=crop"

    result = ExtractProductResponse(
        title=title,
        brand=brand,
        price=price,
        image=image,
        category=category,
    )
    print("EXTRACTED:", result.dict())
    return result


def _clean_title(value: str) -> str:
    title = html.unescape(value or "").strip()
    if not title:
        return ""
    # Remove HTML tags if any
    title = re.sub(r'<[^>]+>', '', title)
    # Remove SKUs or typical ref numbers up to the end of string
    title = re.sub(r'[-\|]\s*(SKU|Item|Ref|ID).*$', '', title, flags=re.IGNORECASE)
    # Aggressively remove any sequence of 5 or more continuous digits
    title = re.sub(r'\d{5,}', '', title)
    # Clean up leading or trailing punctuation/hyphens left behind
    title = re.sub(r'^[^a-zA-Z0-9]+', '', title)
    title = re.sub(r'[^a-zA-Z0-9]+$', '', title)
    # Collapse multiple spaces
    title = re.sub(r"\s+", " ", title).strip()
    return title[:200]

def _extract_price(text: str) -> str:
    # Matches $, £, €, ₹ followed by numbers, commas, and dots OR just \d+\.\d+
    match = re.search(r'([$£€₹]\s*\d+(?:[.,]\d+)*|\d+\.\d+)', text)
    if match:
        return match.group(1).strip()
    return "N/A"

def _extract_image(metadata: dict, markdown: str) -> str:
    if metadata.get("ogImage"):
        return str(metadata["ogImage"])
    if metadata.get("og:image"):
        return str(metadata["og:image"])
        
    img_match = re.search(r'!\[.*?\]\((.*?)\)', markdown)
    if img_match:
        return img_match.group(1).strip()
        
    img_tag_match = re.search(r'<img[^>]+src=["\'](.*?)["\']', markdown, re.IGNORECASE)
    if img_tag_match:
        return img_tag_match.group(1).strip()
    return ""


def _title_from_path(path: str) -> str:
    parts = [segment for segment in path.split("/") if segment]
    for part in reversed(parts):
        normalized = re.sub(r"[-_]+", " ", part).strip()
        if normalized and not normalized.isdigit():
            return _clean_title(normalized.title())
    return ""


def _detect_brand(text: str) -> str:
    haystack = _canonicalize_text(text)
    if not haystack:
        return ""

    for brand, aliases in KNOWN_BRANDS.items():
        for alias in aliases:
            pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"
            if re.search(pattern, haystack):
                return brand
    return ""


def _brand_from_site_name(site_name: object) -> str:
    if not isinstance(site_name, str):
        return ""
    normalized = _canonicalize_text(site_name)
    if not normalized:
        return ""
    return normalized.title()

def _brand_from_domain(url: str) -> str:
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    name = hostname.replace("www.", "").split(".")[0]
    
    if "shein" in name:
        return "SHEIN"
    if "hm" in name or "h-m" in name:
        return "H&M"
    if "zara" in name:
        return "ZARA"
    if "myntra" in name:
        return "MYNTRA"
        
    return name.upper() if name else ""

def _detect_category(text: str) -> str:
    haystack = _canonicalize_text(text)
    if not haystack:
        return ""

    for category, aliases in CATEGORY_KEYWORDS.items():
        for alias in aliases:
            pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"
            if re.search(pattern, haystack):
                return category
    return ""


def _tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.split(r"[^a-z0-9]+", _canonicalize_text(text))
        if token and token not in GENERIC_TOKENS
    ]


def _canonicalize_text(text: str) -> str:
    normalized = html.unescape(text or "").lower()
    normalized = normalized.replace("&", " and ")
    normalized = normalized.replace("'", "")
    return normalized


def _first_non_empty(*values: object) -> str:
    for value in values:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
    return ""

def _resolve_redirects(url: str) -> str:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    
    short_domains = {
        "onelink.me", "onelink.to", "bit.ly", "t.co", "goo.gl", 
        "ow.ly", "tinyurl.com", "is.gd", "buff.ly", "amzn.to"
    }
    
    is_short = hostname in short_domains or len(hostname) <= 7 or "onelink" in hostname
    
    if is_short:
        try:
            response = requests.head(url, allow_redirects=True, timeout=5)
            # Some servers require GET to follow logic
            if response.status_code in {405, 403}:
                response = requests.get(url, stream=True, allow_redirects=True, timeout=5)
                
            final_url = response.url
            if final_url and final_url != url:
                logger.info("Resolved redirect:\n  original_url=%s\n  final_url=%s", url, final_url)
                return final_url
        except Exception as e:
            logger.warning("Failed to resolve short URL %s: %s", url, e)
            
    return url
