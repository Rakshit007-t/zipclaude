import html
import ipaddress
import json
import logging
import re
import threading
import time
from collections import deque
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlparse, urlunsplit
import concurrent.futures
import signal

from bs4 import BeautifulSoup
import hashlib
from fastapi import HTTPException, status

from services.http_client import safe_http_get, is_safe_ip
from models.schema import ExtractProductResponse

logger = logging.getLogger(__name__)

RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 10
MAX_URL_LENGTH = 2048
HTTP_CONNECT_TIMEOUT_SECONDS = 5
HTTP_READ_TIMEOUT_SECONDS = 20
PLAYWRIGHT_NAVIGATION_TIMEOUT_MS = 15000
PLAYWRIGHT_FALLBACK_WAIT_MS = 1200
PLAYWRIGHT_POST_SCROLL_WAIT_MS = 750
PLAYWRIGHT_HUMAN_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
DEFAULT_NOT_FOUND = ""
DEFAULT_TITLE = ""
DEFAULT_PRICE = ""
DEFAULT_BRAND = ""
DEFAULT_CATEGORY = ""
DEFAULT_IMAGE = ""
DEFAULT_MVP_CATEGORY = "topwear"
PRODUCT_IMAGE_PLACEHOLDER = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='420' "
    "viewBox='0 0 320 420'%3E%3Crect width='320' height='420' fill='%231a1a1a'/%3E"
    "%3Cpath d='M105 95h110l45 55-35 35-25-24v164h-80V161l-25 24-35-35z' "
    "fill='%23c9a06c'/%3E%3C/svg%3E"
)
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
REDIRECT_QUERY_PARAMS = {
    "af_dp",
    "af_web_dp",
    "deep_link_value",
    "redirect",
    "redirect_uri",
    "redirect_url",
    "target",
    "to",
    "u",
    "url",
}
SHORT_REDIRECT_DOMAINS = {
    "onelink.me",
    "onelink.to",
    "bit.ly",
    "t.co",
    "goo.gl",
    "ow.ly",
    "tinyurl.com",
    "is.gd",
    "buff.ly",
    "amzn.to",
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
STANDARD_MYNTRA_TSHIRT_BODY_CHART = {
    "S": 34.0 * 2.54,
    "M": 36.0 * 2.54,
    "L": 38.0 * 2.54,
    "XL": 40.0 * 2.54,
    "XXL": 42.0 * 2.54,
}
STANDARD_MYNTRA_BODY_CHART_BRANDS = {"aarumple"}
ALPHA_SIZE_ORDER = {
    "XXS": 0,
    "XS": 1,
    "S": 2,
    "M": 3,
    "L": 4,
    "XL": 5,
    "XXL": 6,
    "2XL": 6,
    "XXXL": 7,
    "3XL": 7,
    "4XL": 8,
    "5XL": 9,
}
REGIONAL_SIZE_PREFIXES = {"UK", "US", "EU"}
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
PRICE_PATTERNS = (
    re.compile(r"(₹\s?[\d,]+(?:\.\d{2})?)"),
    re.compile(r"(Rs\.?\s?[\d,]+(?:\.\d{2})?)", re.IGNORECASE),
    re.compile(r"(\d+\.\d{2})"),
)

_product_cache: dict[str, tuple[float, ExtractProductResponse]] = {}
CACHE_TTL_SECONDS = 3600
_cache_lock = threading.Lock()
_rate_limit_state: dict[str, deque[float]] = {}
_rate_limit_lock = threading.Lock()
_rate_limit_last_cleanup = 0.0
_RATE_LIMIT_CLEANUP_INTERVAL = 300
_RATE_LIMIT_KEY_MAX_AGE = 600
_active_fetches: dict[str, threading.Event] = {}
_active_fetches_lock = threading.Lock()
_last_cleanup_time = 0.0

# Persistent Playwright Instance
_PLAYWRIGHT = None
_BROWSER = None
_BROWSER_LOCK = threading.Lock()

def _get_browser():
    global _PLAYWRIGHT, _BROWSER
    with _BROWSER_LOCK:
        if _BROWSER is None:
            from playwright.sync_api import sync_playwright
            _PLAYWRIGHT = sync_playwright().start()
            _BROWSER = _PLAYWRIGHT.chromium.launch(headless=True)
            
            # Shutdown handler — only safe to register from the main thread
            def shutdown(signum, frame):
                global _BROWSER, _PLAYWRIGHT
                logger.info("Closing Playwright browser...")
                if _BROWSER:
                    try:
                        _BROWSER.close()
                    except Exception:
                        pass
                if _PLAYWRIGHT:
                    try:
                        _PLAYWRIGHT.stop()
                    except Exception:
                        pass
            
            import threading as _threading
            if _threading.current_thread() is _threading.main_thread():
                signal.signal(signal.SIGTERM, shutdown)
                signal.signal(signal.SIGINT, shutdown)
            else:
                logger.debug("Skipping signal handler registration (not main thread)")
            
        return _BROWSER

def _get_page_and_context():
    browser = _get_browser()
    context = browser.new_context(
        user_agent=PLAYWRIGHT_HUMAN_USER_AGENT,
        viewport={"width": 1280, "height": 800},
        locale="en-IN",
    )
    page = context.new_page()
    return page, context

def _get_url_hash(url: str) -> str:
    return hashlib.sha256(url.encode('utf-8')).hexdigest()


def extract_product_details(url: str, requester_id: str) -> ExtractProductResponse:
    url = str(url)
    resolved_url = _resolve_redirects(url)
    normalized_url = normalize_product_url(resolved_url)
    # Rate limiting is handled at the route layer (routes/product.py).
    # Inner enforce_rate_limit removed to avoid duplicate, stricter limits.

    url_hash = _get_url_hash(normalized_url)

    cached_fast = _get_cached_response(normalized_url)
    if cached_fast is not None:
        logger.info("Product extraction cache hit for url=%s", normalized_url)
        return cached_fast

    with _active_fetches_lock:
        if url_hash in _active_fetches:
            event = _active_fetches[url_hash]
            is_new = False
        else:
            event = threading.Event()
            _active_fetches[url_hash] = event
            is_new = True

    if not is_new:
        logger.info("Duplicate fetch requested for url=%s, waiting...", normalized_url)
        event.wait(timeout=5.8)
        cached2 = _get_cached_response(normalized_url)
        if cached2 is not None:
            return cached2
        # If still None after wait, return a proper error to avoid returning incomplete data
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The extraction is still in progress by another request. Please try again in a moment."
        )

    try:
        return _extract_product_details_internal(normalized_url)
    finally:
        if is_new:
            with _active_fetches_lock:
                if url_hash in _active_fetches:
                    _active_fetches[url_hash].set()
                    del _active_fetches[url_hash]

def _extract_product_details_internal(normalized_url: str) -> ExtractProductResponse:

    if "myntra.com" in normalized_url:
        logger.info("Myntra extraction path for url=%s", normalized_url)
        html_data: dict[str, str] = {}
        dom_forced: BeautifulSoup | None = None
        fallback_body_text = ""

        # Use the same timeout-wrapped Playwright path as all other sites
        try:
            final_url, dom_forced, body_text = fetch_page_with_playwright(normalized_url)
        except Exception as exc:
            logger.warning("Myntra Playwright extraction failed for url=%s: %s", normalized_url, exc)
            dom_forced = None
            body_text = ""

        # Extract structured data from the DOM if Playwright succeeded
        if dom_forced is not None:
            metadata = _extract_meta_content(dom_forced)
            jsonld = _extract_jsonld_fields(dom_forced)

            html_data["title"] = _first_non_empty(
                _first_text_by_selectors(dom_forced, ["h1.pdp-name", "h1.pdp-title", "h1"]),
                jsonld.get("title", ""),
                metadata.get("og:title", ""),
            )
            html_data["brand"] = _first_non_empty(
                _first_text_by_selectors(dom_forced, ["h1.pdp-title", '[class*="brand"]']),
                jsonld.get("brand", ""),
            )
            html_data["price"] = _first_non_empty(
                _joined_text_by_selectors(dom_forced, ["span.pdp-price strong", ".pdp-price strong", ".pdp-discount-container"]),
                jsonld.get("currency_price", ""),
                jsonld.get("price", ""),
                metadata.get("product:price:amount", ""),
            )
            forced_images = extract_images(dom_forced)
            html_data["img"] = forced_images[0] if forced_images and not _is_not_found(forced_images[0]) else _first_non_empty(
                jsonld.get("image", ""),
                metadata.get("og:image", ""),
            )

        clean_title = html_data.get("title", "").replace("Buy", "").split("|")[0].strip()
        clean_title = re.sub(r"\s*-\s*Tshirts?\s+for\s+\w+\s*$", "", clean_title, flags=re.IGNORECASE).strip()
        clean_price = extract_price(html_data.get("price", ""))
        if _is_not_found(clean_price):
            numeric_price = re.search(r"\d[\d,]*", html_data.get("price", ""))
            if numeric_price:
                clean_price = f"₹{numeric_price.group(0)}"

        raw_image = html_data.get("img", "").strip()
        clean_image = _normalize_image_url(normalized_url, raw_image) if raw_image else DEFAULT_IMAGE
        if _is_not_found(clean_image) or _is_ignored_image(clean_image):
            clean_image = PRODUCT_IMAGE_PLACEHOLDER

        raw_brand = html_data.get("brand", "").strip()
        clean_brand = re.sub(r"\s*\|\s*Myntra\b.*$", "", raw_brand, flags=re.IGNORECASE).strip()
        if not clean_brand or _canonicalize_text(clean_brand) in {"myntra", "not found"}:
            path_parts = [segment for segment in urlparse(normalized_url).path.split("/") if segment]
            if len(path_parts) >= 2:
                clean_brand = path_parts[1].replace("-", " ").title()
        if not clean_brand:
            clean_brand = _brand_from_domain(normalized_url) or "Myntra"

        if not clean_title:
            fallback_path = re.sub(r"/buy/?$", "", urlparse(normalized_url).path, flags=re.IGNORECASE)
            clean_title = _title_from_path(fallback_path) or DEFAULT_TITLE
        if clean_title.strip().lower() == "buy":
            clean_title = DEFAULT_TITLE

        clean_category = _first_non_empty(
            _detect_category(f"{clean_title} {urlparse(normalized_url).path} {body_text[:1200]}"),
            "shirt",
        )
        fit_hint = _extract_fit_hint(f"{clean_title} {body_text}")
        size_chart = _extract_upper_body_size_chart(body_text)

        if _is_not_found(clean_price) or clean_image == PRODUCT_IMAGE_PLACEHOLDER:
            try:
                response = safe_http_get(
                    normalized_url,
                    headers=_build_request_headers(),
                    timeout=(HTTP_CONNECT_TIMEOUT_SECONDS, HTTP_READ_TIMEOUT_SECONDS),
                )
                text = response._content.decode('utf-8', errors='ignore') if hasattr(response, '_content') else ""
                soup = BeautifulSoup(text, "html.parser")
                fallback_body_text = soup.get_text(" ", strip=True)
                metadata = _extract_meta_content(soup)
                jsonld = _extract_jsonld_fields(soup)

                if _is_not_found(clean_brand):
                    clean_brand = _first_non_empty(jsonld.get("brand", ""), clean_brand)

                if _is_not_found(clean_price):
                    jsonld_price = _first_non_empty(
                        jsonld.get("currency_price", ""),
                        jsonld.get("price", ""),
                        metadata.get("product:price:amount", ""),
                        metadata.get("description", ""),
                        metadata.get("og:description", ""),
                    )
                    clean_price = extract_price(jsonld_price)
                    if _is_not_found(clean_price):
                        rupee_price = re.search(r"₹\s?\d[\d,]*", jsonld_price)
                        if rupee_price:
                            clean_price = rupee_price.group(0)
                        else:
                            rs_price = re.search(r"Rs\.?\s*([0-9,]+)", jsonld_price, flags=re.IGNORECASE)
                            if rs_price:
                                clean_price = f"₹{rs_price.group(1)}"
                            else:
                                plain_digits = re.search(r"\b\d[\d,]*\b", jsonld_price)
                                if plain_digits:
                                    clean_price = f"₹{plain_digits.group(0)}"

                if _is_not_found(clean_image):
                    image_candidate = _first_non_empty(
                        jsonld.get("image", ""),
                        metadata.get("og:image", ""),
                        metadata.get("twitter:image", ""),
                    )
                    normalized_candidate = _normalize_image_url(normalized_url, image_candidate)
                    if normalized_candidate and not _is_ignored_image(normalized_candidate):
                        clean_image = normalized_candidate
                if not size_chart:
                    size_chart = _extract_upper_body_size_chart(fallback_body_text)
                if not fit_hint:
                    fit_hint = _extract_fit_hint(f"{clean_title} {fallback_body_text}")
            except Exception as exc:
                logger.debug("Myntra metadata fallback failed for url=%s: %s", normalized_url, exc)

        if not size_chart:
            size_chart = _fallback_myntra_body_chart(clean_brand, clean_title, clean_category)
        available_sizes = _extract_available_sizes(
            dom_forced,
            f"{body_text} {fallback_body_text}",
            size_chart,
        )

        myntra_result = ExtractProductResponse(
            title=clean_title or DEFAULT_TITLE,
            brand=clean_brand or DEFAULT_BRAND,
            price=clean_price or DEFAULT_PRICE,
            image=clean_image or PRODUCT_IMAGE_PLACEHOLDER,
            category=clean_category,
            fit_hint=fit_hint or None,
            size_chart=size_chart or None,
            available_sizes=available_sizes or None,
            size_format=_detect_size_format(available_sizes),
        )
        _store_cached_response(normalized_url, myntra_result)
        return myntra_result

    cached = _get_cached_response(normalized_url)
    if cached is not None:
        logger.info("Product extraction cache hit for url=%s", normalized_url)
        return cached

    fallback_result = _finalize_extracted_response(
        _extract_from_url(normalized_url),
        page_url=normalized_url,
    )
    try:
        final_url, dom, body_text = fetch_page_with_playwright(normalized_url)
        if final_url and final_url != normalized_url:
            try:
                normalized_final_url = normalize_product_url(final_url)
                if normalized_final_url != normalized_url:
                    cached_final = _get_cached_response(normalized_final_url)
                    if cached_final is not None:
                        logger.info("Product extraction cache hit after redirect for url=%s", normalized_final_url)
                        return cached_final
                    fallback_result = _merge_results(
                        _finalize_extracted_response(
                            _extract_from_url(normalized_final_url),
                            page_url=normalized_final_url,
                        ),
                        fallback_result,
                    )
                    normalized_url = normalized_final_url
            except ValueError as exc:
                logger.warning("Redirect resolved to an invalid URL %s: %s", final_url, exc)

        logger.debug("Text length: %d", len(body_text))
        logger.debug("Images found: %d", len(extract_images(dom)))

        extracted_result = _extract_with_site_router(
            normalized_url,
            dom,
            body_text,
            fallback_result,
        )
        _store_cached_response(normalized_url, extracted_result)
        return extracted_result
    except Exception as exc:
        logger.exception("Product extraction failed for url=%s", normalized_url)
        _store_cached_response(normalized_url, fallback_result)
        return fallback_result


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
    """Inner rate limiter — disabled. Route-level limiter is authoritative."""
    # Kept as a no-op to avoid breaking callers; cleanup stale keys only.
    now = time.time()
    with _rate_limit_lock:
        global _rate_limit_last_cleanup
        if now - _rate_limit_last_cleanup > _RATE_LIMIT_CLEANUP_INTERVAL:
            _rate_limit_last_cleanup = now
            stale = [
                k for k, b in _rate_limit_state.items()
                if not b or now - b[-1] > _RATE_LIMIT_KEY_MAX_AGE
            ]
            for k in stale:
                del _rate_limit_state[k]


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
    url_hash = _get_url_hash(url)
    with _cache_lock:
        cached = _product_cache.get(url_hash)
        if cached is None:
            return None
        expires_at, payload = cached
        if time.time() > expires_at:
            del _product_cache[url_hash]
            return None
        return ExtractProductResponse.model_validate(payload.model_dump())


def _store_cached_response(url: str, response: ExtractProductResponse) -> None:
    # Keep successful retailer results warm, but do not preserve an incomplete
    # fallback that would prevent the next request from trying again.
    if not _is_complete_extraction(response):
        return

    global _last_cleanup_time
    url_hash = _get_url_hash(url)
    with _cache_lock:
        now_time = time.time()
        
        # Periodic cleanup (every 60s) OR if cache grows too large
        should_cleanup = (now_time - _last_cleanup_time > 60) or (len(_product_cache) > 1000)
        
        if should_cleanup:
            _last_cleanup_time = now_time
            # 1. Remove expired entries
            expired_keys = [k for k, v in _product_cache.items() if now_time > v[0]]
            for k in expired_keys:
                del _product_cache[k]
                
            # 2. Hard limit: If still > 1000, trim oldest entries
            if len(_product_cache) > 1000:
                # Sort by expiration time (which is roughly insertion time + TTL)
                sorted_keys = sorted(_product_cache.keys(), key=lambda k: _product_cache[k][0])
                # Remove enough to get back under 800 (leave some breathing room)
                for k in sorted_keys[:len(_product_cache) - 800]:
                    del _product_cache[k]

        expires_at = now_time + CACHE_TTL_SECONDS
        _product_cache[url_hash] = (expires_at, ExtractProductResponse.model_validate(response.model_dump()))


def _is_complete_extraction(response: ExtractProductResponse) -> bool:
    return bool(
        clean_title(response.title)
        and str(response.brand or '').strip()
        and str(response.category or '').strip()
        and str(response.image or '').strip()
    )


def _extract_from_url(url: str) -> ExtractProductResponse:
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    path_tokens = _tokenize(f"{hostname} {parsed.path}")
    brand = _first_non_empty(_detect_brand(" ".join(path_tokens)), _brand_from_domain(url))
    category = _detect_category(" ".join(path_tokens))
    title = _title_from_path(parsed.path)
    return ExtractProductResponse(title=title, brand=brand, category=category)


def _merge_results(
    primary: ExtractProductResponse,
    secondary: ExtractProductResponse,
) -> ExtractProductResponse:
    return ExtractProductResponse(
        title=_first_non_empty(primary.title, secondary.title),
        image=_first_non_empty(primary.image, secondary.image),
        price=_first_non_empty(primary.price, secondary.price),
        brand=_first_non_empty(primary.brand, secondary.brand),
        category=_first_non_empty(primary.category, secondary.category),
        fit_hint=_first_non_empty(primary.fit_hint, secondary.fit_hint) or None,
        size_chart=primary.size_chart or secondary.size_chart,
        available_sizes=primary.available_sizes or secondary.available_sizes,
        size_format=primary.size_format or secondary.size_format,
    )


def _extract_with_site_router(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    lowered_url = url.lower()

    if "myntra" in lowered_url:
        return _run_site_extractor("myntra", myntra_extractor, url, dom, body_text, fallback_result)
    elif "ajio" in lowered_url:
        return _run_site_extractor("ajio", ajio_extractor, url, dom, body_text, fallback_result)
    elif "amazon" in lowered_url:
        return _run_site_extractor("amazon", amazon_extractor, url, dom, body_text, fallback_result)
    elif "flipkart" in lowered_url:
        return _run_site_extractor("flipkart", flipkart_extractor, url, dom, body_text, fallback_result)
    else:
        return mvp_fallback_extractor(url, dom, body_text, fallback_result)


def _run_site_extractor(
    site_name: str,
    extractor_fn,
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    try:
        site_result = extractor_fn(url, dom, body_text, fallback_result)
        if _is_result_sparse(site_result):
            logger.debug("%s extractor sparse result; using generic fallback", site_name)
            return generic_extractor(url, dom, body_text, fallback_result)
        return site_result
    except Exception as exc:
        logger.warning("%s extractor failed for url=%s: %s. Falling back to generic.", site_name, url, exc)
        return generic_extractor(url, dom, body_text, fallback_result)


def _is_result_sparse(result: ExtractProductResponse) -> bool:
    important_fields = (result.title, result.price, result.image)
    return all(_is_not_found(value) for value in important_fields)


def _is_not_found(value: str) -> bool:
    return not value or value.strip().lower() == DEFAULT_NOT_FOUND.lower()


def generic_extractor(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    metadata = extract_metadata(dom)
    images = extract_images(dom)
    title = clean_title(
        _first_non_empty(
            metadata.get("document_title", ""),
            metadata.get("og_title", ""),
            fallback_result.title,
        )
    )
    price = extract_price(body_text)
    image = _normalize_image_url(url, images[0]) if images else ""
    image = _first_non_empty(image, fallback_result.image, DEFAULT_NOT_FOUND)
    brand = _first_non_empty(
        _detect_brand(
            " ".join(
                (
                    title,
                    metadata.get("site_name", ""),
                    metadata.get("description", ""),
                    metadata.get("brand", ""),
                    body_text[:1200],
                )
            )
        ),
        metadata.get("brand", ""),
        fallback_result.brand,
    )
    category = _first_non_empty(
        _detect_category(
            " ".join(
                (
                    title,
                    metadata.get("description", ""),
                    metadata.get("category", ""),
                    body_text[:1200],
                )
            )
        ),
        metadata.get("category", ""),
        fallback_result.category,
        DEFAULT_CATEGORY,
    )
    size_chart = _extract_upper_body_size_chart(body_text) or None
    available_sizes = _extract_available_sizes(dom, body_text, size_chart)
    return _finalize_extracted_response(
        ExtractProductResponse(
            title=title,
            price=price,
            image=image,
            brand=brand,
            category=category,
            fit_hint=_extract_fit_hint(f"{title} {body_text}"),
            size_chart=size_chart,
            available_sizes=available_sizes or None,
            size_format=_detect_size_format(available_sizes),
        ),
        page_url=url,
        fallback=fallback_result,
    )


def mvp_fallback_extractor(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    logger.debug("Extraction fallback used for: %s", url)
    metadata = _extract_meta_content(dom)
    title = clean_title(
        _first_non_empty(
            _node_text(dom.title),
            metadata.get("og:title", ""),
            fallback_result.title,
        )
    )
    image = _normalize_image_url(
        url,
        _first_non_empty(
            metadata.get("og:image", ""),
            fallback_result.image,
            _first_image_src(dom),
        ),
    )
    brand = _first_non_empty(
        _detect_brand(f"{title} {body_text[:400]}"),
        fallback_result.brand,
    )
    size_chart = _extract_upper_body_size_chart(body_text) or None
    available_sizes = _extract_available_sizes(dom, body_text, size_chart)

    return _finalize_extracted_response(
        ExtractProductResponse(
            title=title,
            brand=brand,
            image=image or None,
            category="",
            fit_hint=_extract_fit_hint(f"{title} {body_text}") or None,
            size_chart=size_chart,
            available_sizes=available_sizes or None,
            size_format=_detect_size_format(available_sizes),
        ),
        page_url=url,
        fallback=fallback_result,
    )


def myntra_extractor(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    return _site_specific_extractor(
        site_name="myntra",
        url=url,
        dom=dom,
        body_text=body_text,
        fallback_result=fallback_result,
        title_selectors=["h1.pdp-title", "h1.pdp-name", "h1"],
        price_selectors=["span.pdp-price strong", ".pdp-price strong", ".pdp-discount-container"],
        image_selectors=["div.image-grid-image img", "img[src*='assets.myntassets.com']", "main img"],
    )


def ajio_extractor(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    return _site_specific_extractor(
        site_name="ajio",
        url=url,
        dom=dom,
        body_text=body_text,
        fallback_result=fallback_result,
        title_selectors=["h1.prod-name", ".prod-name", "h1"],
        price_selectors=[".prod-sp", ".price .amount", ".prod-price"],
        image_selectors=[".image-view img", ".prod-image img", "img[src*='ajiocdn']"],
    )


def amazon_extractor(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    return _site_specific_extractor(
        site_name="amazon",
        url=url,
        dom=dom,
        body_text=body_text,
        fallback_result=fallback_result,
        title_selectors=["#productTitle", "#title span", "h1 span", "h1"],
        price_selectors=[
            "#corePrice_feature_div .a-price .a-offscreen",
            "#priceblock_ourprice",
            "#priceblock_dealprice",
            "#price_inside_buybox",
        ],
        image_selectors=["#landingImage", "#imgTagWrapperId img", "img[src*='images-amazon']"],
    )


def flipkart_extractor(
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
) -> ExtractProductResponse:
    return _site_specific_extractor(
        site_name="flipkart",
        url=url,
        dom=dom,
        body_text=body_text,
        fallback_result=fallback_result,
        title_selectors=["span.B_NuCI", "h1.yhB1nd span", "h1"],
        price_selectors=["div.Nx9bqj", "._30jeq3", "._16Jk6d"],
        image_selectors=["img._396cs4", "._2r_T1I img", ".CXW8mj img", "img[src*='rukminim']"],
    )


def _site_specific_extractor(
    site_name: str,
    url: str,
    dom: BeautifulSoup,
    body_text: str,
    fallback_result: ExtractProductResponse,
    title_selectors: list[str],
    price_selectors: list[str],
    image_selectors: list[str],
) -> ExtractProductResponse:
    generic_result = generic_extractor(url, dom, body_text, fallback_result)
    site_title = clean_title(
        _first_non_empty(
            _first_text_by_selectors(dom, title_selectors),
            generic_result.title,
        )
    )
    site_price = extract_price(
        _first_non_empty(
            _joined_text_by_selectors(dom, price_selectors),
            body_text,
            generic_result.price,
        )
    )
    site_image = _first_non_empty(
        _normalize_image_url(url, _largest_image_by_selectors(dom, image_selectors)),
        generic_result.image,
        DEFAULT_NOT_FOUND,
    )
    site_brand = _first_non_empty(
        _detect_brand(site_title),
        site_name,
        generic_result.brand,
        DEFAULT_BRAND,
    )
    site_category = _first_non_empty(
        _detect_category(f"{site_title} {body_text[:1200]}"),
        generic_result.category,
        DEFAULT_CATEGORY,
    )
    size_chart = _extract_upper_body_size_chart(body_text) or generic_result.size_chart
    available_sizes = _extract_available_sizes(dom, body_text, size_chart) or generic_result.available_sizes or []
    return _finalize_extracted_response(
        ExtractProductResponse(
            title=site_title,
            price=site_price,
            image=site_image,
            brand=site_brand,
            category=site_category,
            fit_hint=_extract_fit_hint(f"{site_title} {body_text}") or generic_result.fit_hint or None,
            size_chart=size_chart,
            available_sizes=available_sizes or None,
            size_format=_detect_size_format(available_sizes) or generic_result.size_format,
        ),
        page_url=url,
        fallback=generic_result,
    )


def _first_text_by_selectors(dom: BeautifulSoup, selectors: list[str]) -> str:
    for selector in selectors:
        node = dom.select_one(selector)
        if node is None:
            continue
        text = node.get_text(" ", strip=True)
        if text:
            return text
    return ""


def _joined_text_by_selectors(dom: BeautifulSoup, selectors: list[str]) -> str:
    text_parts: list[str] = []
    for selector in selectors:
        for node in dom.select(selector):
            text = node.get_text(" ", strip=True)
            if text:
                text_parts.append(text)
    return " ".join(text_parts)


def _largest_image_by_selectors(dom: BeautifulSoup, selectors: list[str]) -> str:
    best_image = ""
    best_area = -1
    seen_images: set[str] = set()

    for selector in selectors:
        for node in dom.select(selector):
            source = _extract_image_source(node)
            if not source or source in seen_images or _is_ignored_image(source):
                continue
            seen_images.add(source)
            area = _image_area(node)
            if area > best_area:
                best_area = area
                best_image = source

    return best_image


PLAYWRIGHT_SEMAPHORE = threading.Semaphore(3)

def fetch_page_with_playwright(url: str) -> tuple[str, BeautifulSoup, str]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_fetch_page_with_playwright_internal, url)
        try:
            return future.result(timeout=18.0)
        except concurrent.futures.TimeoutError:
            logger.warning("Playwright timeout (18s) exceeded for url=%s. Falling back to requests.", url)
            return _fetch_page_with_requests_fallback(url)
        except Exception as exc:
            logger.warning("Playwright thread execution failed for url=%s: %s", url, exc)
            return _fetch_page_with_requests_fallback(url)

def _fetch_page_with_playwright_internal(url: str) -> tuple[str, BeautifulSoup, str]:
    if not PLAYWRIGHT_SEMAPHORE.acquire(blocking=False):
        logger.warning("Playwright concurrency limit reached. Falling back to requests for %s", url)
        return _fetch_page_with_requests_fallback(url)
    
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        logger.warning("Playwright unavailable for url=%s: %s. Falling back to requests.", url, exc)
        PLAYWRIGHT_SEMAPHORE.release()
        return _fetch_page_with_requests_fallback(url)

    browser = None
    context = None
    page = None
    try:
        browser = _get_browser()
        context = browser.new_context(
            user_agent=PLAYWRIGHT_HUMAN_USER_AGENT,
            viewport={"width": 1280, "height": 800},
            locale="en-IN",
        )
        page = context.new_page()

        def validate_route(route):
            request = route.request
            if request.resource_type in ("document", "fetch", "xhr"):
                try:
                    import socket
                    from urllib.parse import urlparse
                    parsed = urlparse(request.url)
                    hostname = parsed.hostname
                    if hostname:
                        if hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
                            route.abort("accessdenied")
                            return
                        ip = socket.gethostbyname(hostname)
                        if not is_safe_ip(ip):
                            route.abort("accessdenied")
                            return
                except Exception:
                    route.abort("accessdenied")
                    return
            route.continue_()

        page.route("**/*", validate_route)

        page.add_init_script(
            """
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            """
        )
        page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
        )
        page.wait_for_timeout(PLAYWRIGHT_FALLBACK_WAIT_MS)
        try:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(PLAYWRIGHT_POST_SCROLL_WAIT_MS)
        except Exception as exc:
            logger.debug("Playwright scroll step failed for url=%s: %s", url, exc)

        final_url = page.url or url
        html_body = page.content()
        dom, fallback_text = _build_dom_and_text(html_body)
        body_text = _extract_body_inner_text(page, fallback_text)
        logger.debug("DOM loaded for url=%s", url)
        return final_url, dom, body_text
    except Exception as exc:
        logger.warning("Playwright fetch failed for url=%s: %s. Falling back to requests.", url, exc)
        return _fetch_page_with_requests_fallback(url)
    finally:
        if page is not None:
            try:
                page.close()
            except Exception:
                pass
        if context is not None:
            try:
                context.close()
            except Exception:
                pass
        PLAYWRIGHT_SEMAPHORE.release()


def _fetch_page_with_requests_fallback(url: str) -> tuple[str, BeautifulSoup, str]:
    final_url = url
    html_body = ""
    try:
        response = safe_http_get(
            url,
            headers=_build_request_headers(),
            timeout=(HTTP_CONNECT_TIMEOUT_SECONDS, HTTP_READ_TIMEOUT_SECONDS),
        )
        final_url = response.url or url
        html_body = response._content.decode('utf-8', errors='ignore') if hasattr(response, '_content') else ""
    except Exception as exc:
        logger.error("Requests fallback failed for url=%s: %s", url, exc)
    dom, body_text = _build_dom_and_text(html_body)
    logger.debug("DOM loaded (requests fallback) for url=%s", url)
    return final_url, dom, body_text


def _build_dom_and_text(html_body: str) -> tuple[BeautifulSoup, str]:
    html_content = html_body if isinstance(html_body, str) and html_body.strip() else "<html><body></body></html>"
    dom = BeautifulSoup(html_content, "html.parser")
    body_text = dom.get_text(" ", strip=True)
    normalized_text = re.sub(r"\s+", " ", body_text).strip()
    return dom, normalized_text or DEFAULT_PRICE


def _extract_body_inner_text(page: object, fallback_text: str) -> str:
    if page is None:
        return fallback_text or DEFAULT_NOT_FOUND
    try:
        raw_body_text = page.evaluate(
            """
            () => {
              if (!document || !document.body || typeof document.body.innerText !== "string") {
                return "";
              }
              return document.body.innerText;
            }
            """
        )
    except Exception as exc:
        logger.warning("Failed to read document.body.innerText: %s", exc)
        raw_body_text = ""

    if not isinstance(raw_body_text, str):
        return fallback_text or DEFAULT_NOT_FOUND

    normalized_text = re.sub(r"\s+", " ", raw_body_text).strip()
    return normalized_text or fallback_text or DEFAULT_NOT_FOUND


def extract_metadata(dom: BeautifulSoup) -> dict[str, str]:
    try:
        metadata = _extract_meta_content(dom)
        jsonld = _extract_jsonld_fields(dom)
    except Exception as exc:
        logger.warning("Metadata extraction failed: %s", exc)

        metadata = {}
        jsonld = {
            "title": "",
            "image": "",
            "brand": "",
            "category": "",
            "price": "",
            "currency_price": "",
        }

    return {
        "document_title": _first_non_empty(_node_text(dom.title), DEFAULT_TITLE),
        "og_title": _first_non_empty(metadata.get("og:title"), _first_heading_text(dom), DEFAULT_TITLE),
        "description": _first_non_empty(metadata.get("description"), metadata.get("og:description"), DEFAULT_NOT_FOUND),
        "site_name": _first_non_empty(metadata.get("og:site_name"), DEFAULT_BRAND),
        "brand": _first_non_empty(
            jsonld.get("brand"),
            _brand_from_site_name(metadata.get("og:site_name")),
            DEFAULT_BRAND,
        ),
        "category": _first_non_empty(jsonld.get("category"), DEFAULT_CATEGORY),
    }


def extract_price(dom_text: str) -> str:
    haystack = re.sub(r"\s+", " ", html.unescape(dom_text or "")).strip()
    if not haystack:
        return DEFAULT_NOT_FOUND

    candidates: list[tuple[int, str]] = []
    for pattern in PRICE_PATTERNS:
        for match in pattern.finditer(haystack):
            value = match.group(1).strip(" ,;:-")
            normalized = re.sub(r"\s+", " ", value).strip()
            if normalized:
                candidates.append((match.start(), normalized))

    if not candidates:
        return DEFAULT_NOT_FOUND
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def extract_images(dom: BeautifulSoup) -> list[str]:
    images: list[str] = []

    # PRIORITY 1: JSON-LD product image.
    jsonld_fields = _extract_jsonld_fields(dom)
    jsonld_image = jsonld_fields.get("image", "")
    if isinstance(jsonld_image, str):
        cleaned_jsonld_image = html.unescape(jsonld_image).strip()
        if is_valid_product_image(cleaned_jsonld_image):
            images.append(cleaned_jsonld_image)

    # PRIORITY 2: Myntra-like product images from <img> tags.
    myntra_candidates: list[tuple[int, int, str]] = []
    fallback_candidates: list[tuple[int, int, str]] = []
    for tag in dom.find_all("img"):
        source = _extract_image_source(tag)
        if not is_valid_product_image(source):
            continue
        area = _image_area(tag)
        resolution_score = _image_resolution_score(source)
        fallback_candidates.append((area, resolution_score, source))
        if _is_myntra_product_image(source):
            myntra_candidates.append((area, resolution_score, source))

    if myntra_candidates:
        myntra_candidates.sort(key=lambda item: (item[1], item[0]), reverse=True)
        images.extend(source for _, _, source in myntra_candidates)

    # FALLBACK: first valid image with the largest available size score.
    fallback_candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    images.extend(source for _, _, source in fallback_candidates)

    metadata = _extract_meta_content(dom)
    og_image = metadata.get("og:image")
    if isinstance(og_image, str):
        cleaned_og_image = html.unescape(og_image).strip()
        if is_valid_product_image(cleaned_og_image):
            images.append(cleaned_og_image)

    deduped_images: list[str] = []
    seen: set[str] = set()
    for image in images:
        if image in seen:
            continue
        seen.add(image)
        deduped_images.append(image)

    final_image = deduped_images[0] if deduped_images else DEFAULT_NOT_FOUND
    logger.debug("Final image selected: %s", final_image)
    return deduped_images or [DEFAULT_NOT_FOUND]


def _extract_image_source(tag: object) -> str:
    if tag is None or not hasattr(tag, "get"):
        return ""
    for attribute in ("src", "data-src", "data-original", "srcset"):
        raw_value = tag.get(attribute)
        if not isinstance(raw_value, str):
            continue
        source = raw_value.split(",")[0].strip().split(" ")[0]
        if source and not source.startswith("data:"):
            return source
    return ""


def _image_area(tag: object) -> int:
    if tag is None or not hasattr(tag, "get"):
        return 0
    width = _safe_positive_int(tag.get("width"))
    height = _safe_positive_int(tag.get("height"))
    if width and height:
        return width * height
    return 0


def _safe_positive_int(value: object) -> int:
    if isinstance(value, str):
        cleaned = re.sub(r"[^0-9]", "", value)
        if cleaned.isdigit():
            numeric = int(cleaned)
            return numeric if numeric > 0 else 0
    if isinstance(value, int) and value > 0:
        return value
    return 0


def is_valid_product_image(url: str) -> bool:
    bad_keywords = ["logo", "icon", "sprite", "banner", "placeholder"]
    candidate = url.strip() if isinstance(url, str) else ""
    if not candidate or candidate.startswith("data:"):
        return False
    return not any(keyword in candidate.lower() for keyword in bad_keywords)


def _is_myntra_product_image(image_url: str) -> bool:
    normalized = _canonicalize_text(image_url)
    if "/assets/images/" not in normalized:
        return False
    return bool(re.search(r"/assets/images/\d{4,}/", normalized))


def _image_resolution_score(image_url: str) -> int:
    normalized = _canonicalize_text(image_url)
    score = 0
    if "h_1440" in normalized:
        score += 1_000_000
    if "w_1080" in normalized:
        score += 1_000_000
    if _is_myntra_product_image(image_url):
        score += 250_000

    for dimension_match in re.finditer(r"(?:h|w)_(\d{2,4})", normalized):
        score += int(dimension_match.group(1))
    return score


def _is_ignored_image(image_url: str) -> bool:
    if not is_valid_product_image(image_url):
        return True
    normalized = _canonicalize_text(image_url)
    ignored_tokens = ("icon", "logo", "favicon", "sprite", "placeholder", "avatar")
    return any(token in normalized for token in ignored_tokens)


def clean_title(title: str) -> str:
    normalized_title = html.unescape(title or "").strip()
    if not normalized_title:
        return DEFAULT_TITLE
    normalized_title = re.sub(r"<[^>]+>", " ", normalized_title)
    normalized_title = re.sub(r"\.html?\b", " ", normalized_title, flags=re.IGNORECASE)
    normalized_title = re.sub(r"\b(?:p|prod|product)[-_ ]?\d{5,}\b", " ", normalized_title, flags=re.IGNORECASE)
    normalized_title = re.sub(r"\b\d{6,}\b", " ", normalized_title)
    normalized_title = re.sub(
        r"\s*[-|]\s*(buy|shop|official site)\b.*$",
        "",
        normalized_title,
        flags=re.IGNORECASE,
    )
    normalized_title = re.sub(
        r"\s*[-|]\s*(sku|item|ref|id|pid)\s*[:#]?[a-z0-9-]+\s*$",
        "",
        normalized_title,
        flags=re.IGNORECASE,
    )
    normalized_title = re.sub(r"[_]+", " ", normalized_title)
    normalized_title = re.sub(r"\s+", " ", normalized_title).strip()
    return normalized_title[:220] if normalized_title else DEFAULT_TITLE


def _finalize_extracted_response(
    response: ExtractProductResponse,
    page_url: str,
    fallback: ExtractProductResponse | None = None,
) -> ExtractProductResponse:
    fallback_value = fallback or ExtractProductResponse()
    
    image_candidate = _first_non_empty(response.image, fallback_value.image)
    normalized_image = _normalize_image_url(page_url, image_candidate) if image_candidate else None
    
    title = clean_title(_first_non_empty(response.title, fallback_value.title))
    price_val = extract_price(_first_non_empty(response.price, fallback_value.price))

    brand = _first_non_empty(response.brand, fallback_value.brand)
    category = _first_non_empty(response.category, fallback_value.category)
    fit_hint = _first_non_empty(response.fit_hint, fallback_value.fit_hint)
    size_chart = response.size_chart or fallback_value.size_chart
    available_sizes = _merge_available_sizes(
        response.available_sizes,
        fallback_value.available_sizes,
        size_chart.keys() if isinstance(size_chart, dict) else None,
    )
    size_format = response.size_format or fallback_value.size_format or _detect_size_format(available_sizes)
    
    missing_fields = []
    if not title: missing_fields.append("title")
    if not brand: missing_fields.append("brand")
    if not price_val: missing_fields.append("price")
    if not normalized_image: missing_fields.append("image")
    
    confidence = 1.0
    if missing_fields:
        confidence -= 0.2 * len(missing_fields)
        
    confidence = max(0.0, min(1.0, confidence))
    
    error_code = None
    error_msg = None
    if missing_fields:
        error_code = "partial_extraction"
        error_msg = f"Missing fields: {', '.join(missing_fields)}"

    return ExtractProductResponse(
        title=title,
        price=price_val if price_val else None,
        image=normalized_image if normalized_image else None,
        brand=brand if brand else "",
        category=category if category else "",
        url=page_url,
        confidence=confidence,
        fit_hint=fit_hint or None,
        size_chart=size_chart or None,
        available_sizes=available_sizes or None,
        size_format=size_format or None,
        error_code=error_code,
        error_message=error_msg
    )

def _ensure_non_empty(value: str) -> str:
    cleaned = value.strip() if isinstance(value, str) else ""
    return cleaned or DEFAULT_NOT_FOUND


def _clean_title(value: str) -> str:
    return clean_title(value)

def _extract_price(text: str) -> str:
    return extract_price(text)


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
        return "Shein"
    if "hm" in name or "h-m" in name:
        return "H&M"
    if "zara" in name:
        return "Zara"
    if "myntra" in name:
        return "Myntra"
    if "ajio" in name:
        return "Ajio"
        
    return name.replace("-", " ").strip()

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


def _extract_fit_hint(text: str) -> str:
    haystack = _canonicalize_text(text)
    for label in ("compression", "tight", "skinny", "baggy", "boxy", "oversized", "relaxed", "regular", "slim"):
        if re.search(rf"(?<![a-z0-9]){label}\s+fit(?![a-z0-9])", haystack):
            if label in {"compression", "tight", "skinny"}:
                return "slim"
            return "loose" if label in {"baggy", "oversized"} else label
    return ""


def _extract_available_sizes(
    dom: BeautifulSoup | None,
    body_text: str,
    size_chart: dict[str, float] | None = None,
) -> list[str]:
    candidates: list[str] = []

    if isinstance(size_chart, dict):
        candidates.extend(str(size) for size in size_chart.keys())

    if dom is not None:
        candidates.extend(_extract_dom_size_candidates(dom))
        candidates.extend(_extract_script_size_candidates(dom))

    candidates.extend(_extract_contextual_size_candidates(body_text))
    return _merge_available_sizes(candidates)


def _extract_dom_size_candidates(dom: BeautifulSoup) -> list[str]:
    candidates: list[str] = []
    selector = (
        "button, option, select, [role='button'], "
        "[data-size], [aria-label*='size' i], [class*='size' i], [id*='size' i]"
    )
    for node in dom.select(selector):
        context = _node_size_context(node)
        text = _node_text(node)
        allow_single_alpha = _context_mentions_size(context) or _text_looks_like_size_control(text)
        if allow_single_alpha:
            candidates.extend(_extract_size_tokens(text, allow_single_alpha=True))

        for attr_name in ("data-size", "data-value", "aria-label", "title", "value", "data-variant"):
            if not hasattr(node, "get"):
                continue
            raw_attr = node.get(attr_name)
            if isinstance(raw_attr, str):
                attr_context = f"{context} {attr_name}"
                candidates.extend(
                    _extract_size_tokens(
                        raw_attr,
                        allow_single_alpha=_context_mentions_size(attr_context),
                    )
                )
    return candidates


def _extract_script_size_candidates(dom: BeautifulSoup) -> list[str]:
    candidates: list[str] = []
    for script in dom.find_all("script"):
        raw_script = script.string if isinstance(script.string, str) else script.get_text()
        if not isinstance(raw_script, str) or not raw_script.strip():
            continue

        script_text = raw_script[:250_000]
        for match in re.finditer(
            r"(?is)(?:availableSizes|available_sizes|sizeOptions|sizes|sizeMap|size_chart)\s*[:=]\s*(\[[^\]]{1,1200}\]|\{[^\}]{1,2000}\})",
            script_text,
        ):
            candidates.extend(_extract_size_tokens(match.group(1), allow_single_alpha=True))

        for match in re.finditer(
            r'(?is)"(?:size|label|displaySize|sizeLabel|value)"\s*:\s*"([^"]{1,40})"',
            script_text,
        ):
            start = max(0, match.start() - 120)
            end = min(len(script_text), match.end() + 120)
            if _context_mentions_size(script_text[start:end]):
                candidates.extend(_extract_size_tokens(match.group(1), allow_single_alpha=True))
    return candidates


def _extract_contextual_size_candidates(text: str) -> list[str]:
    haystack = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
    if not haystack:
        return []

    candidates: list[str] = []
    for match in re.finditer(
        r"(?i)(?:available\s+sizes?|select\s+size|choose\s+size|sizes?\s+available|waist\s+sizes?)\s*[:\-]?\s*([A-Za-z0-9,+/.\-\s]{1,120})",
        haystack,
    ):
        segment = match.group(1)
        segment = re.split(
            r"(?i)\b(?:size\s+guide|delivery|add\s+to\s+bag|add\s+to\s+cart|price|discount|color|colour)\b",
            segment,
            maxsplit=1,
        )[0]
        candidates.extend(_extract_size_tokens(segment, allow_single_alpha=True))

    return candidates


def _node_size_context(node: object) -> str:
    pieces: list[str] = []
    current = node
    for _ in range(2):
        if current is None or not hasattr(current, "get"):
            break
        for attr_name in ("class", "id", "aria-label", "data-testid", "data-test", "name"):
            raw_value = current.get(attr_name)
            if isinstance(raw_value, list):
                pieces.extend(str(item) for item in raw_value)
            elif isinstance(raw_value, str):
                pieces.append(raw_value)
        current = getattr(current, "parent", None)
    return " ".join(pieces)


def _context_mentions_size(context: str) -> bool:
    return bool(re.search(r"(?i)\b(size|waist|variant|stock|inventory)\b", context or ""))


def _text_looks_like_size_control(text: str) -> bool:
    cleaned = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
    if not cleaned or len(cleaned) > 18:
        return False
    return bool(_normalize_available_size_label(cleaned))


def _extract_size_tokens(text: str, *, allow_single_alpha: bool) -> list[str]:
    if not isinstance(text, str):
        return []

    cleaned = re.sub(r"[\[\]\{\}\"']", " ", html.unescape(text))
    tokens: list[str] = []
    regional_tokens = [
        match.group(0)
        for match in re.finditer(r"\b(?:UK|US|EU)\s*[-:]?\s*\d{1,3}(?:\.\d)?\b", cleaned, flags=re.IGNORECASE)
    ]
    tokens.extend(regional_tokens)
    tokens.extend(match.group(0) for match in re.finditer(r"\b(?:FREE\s+SIZE|ONE\s+SIZE|OSFA)\b", cleaned, flags=re.IGNORECASE))
    tokens.extend(match.group(0) for match in re.finditer(r"\b(?:XXS|XS|XL|XXL|XXXL|[2-5]XL)\b", cleaned, flags=re.IGNORECASE))

    if allow_single_alpha:
        tokens.extend(match.group(0) for match in re.finditer(r"\b(?:S|M|L)\b", cleaned, flags=re.IGNORECASE))
        if not regional_tokens:
            tokens.extend(match.group(0) for match in re.finditer(r"\b(?:[2-5][0-9]|6[0-2]|8|10|12|14|16|18|20|22)\b", cleaned))

    return tokens


def _merge_available_sizes(*groups: object) -> list[str]:
    merged: dict[str, str] = {}
    for group in groups:
        if group is None:
            continue
        if isinstance(group, str):
            iterable = [group]
        else:
            try:
                iterable = list(group)
            except TypeError:
                iterable = [group]

        for raw_label in iterable:
            label = _normalize_available_size_label(raw_label)
            if not label:
                continue
            key = re.sub(r"\s+", "", label).upper()
            merged.setdefault(key, label)

    return sorted(merged.values(), key=_size_sort_key)


def _normalize_available_size_label(label: object) -> str:
    value = re.sub(r"\s+", " ", str(label or "")).strip()
    value = re.sub(r"(?i)^size\s+", "", value)
    value = value.strip(":-|/ ")
    if not value:
        return ""

    upper = value.upper().replace(".", "")
    if upper in {"FREE SIZE", "ONESIZE", "ONE SIZE", "OSFA"}:
        return "One Size"

    regional = re.match(r"^(UK|US|EU)\s*[-:]?\s*(\d{1,3}(?:\.\d)?)$", upper)
    if regional:
        return f"{regional.group(1)} {regional.group(2)}"

    alpha = upper.replace(" ", "")
    if alpha in ALPHA_SIZE_ORDER:
        return alpha

    numeric = re.match(r"^\d{1,3}(?:\.\d)?$", upper)
    if numeric:
        try:
            numeric_value = float(upper)
        except ValueError:
            return ""
        if 2 <= numeric_value <= 62:
            return upper[:-2] if upper.endswith(".0") else upper

    return ""


def _detect_size_format(sizes: list[str] | None) -> str:
    labels = [label for label in (sizes or []) if label]
    if not labels:
        return ""
    normalized = [label.upper() for label in labels]
    if all(label == "ONE SIZE" or label == "ONE SIZE".replace(" ", "") for label in normalized):
        return "one-size"
    if all(re.match(r"^(UK|US|EU)\s+\d", label) for label in normalized):
        return "regional"
    if all(re.match(r"^\d", label) for label in normalized):
        return "numeric"
    if all(label.replace(" ", "") in ALPHA_SIZE_ORDER or label == "ONE SIZE" for label in normalized):
        return "alpha"
    return "mixed"


def _size_sort_key(label: str) -> tuple[int, float, str]:
    normalized = str(label or "").upper().strip()
    compact = normalized.replace(" ", "")
    if compact in ALPHA_SIZE_ORDER:
        return (0, ALPHA_SIZE_ORDER[compact], normalized)
    regional = re.match(r"^(UK|US|EU)\s+(\d{1,3}(?:\.\d)?)$", normalized)
    if regional:
        prefix_order = {"UK": 0, "US": 1, "EU": 2}.get(regional.group(1), 9)
        return (1 + prefix_order, float(regional.group(2)), normalized)
    if re.match(r"^\d", normalized):
        try:
            return (5, float(normalized), normalized)
        except ValueError:
            pass
    if normalized in {"ONE SIZE", "ONESIZE"}:
        return (9, 0, normalized)
    return (10, 0, normalized)


def _extract_upper_body_size_chart(text: str) -> dict[str, float]:
    haystack = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
    if not haystack:
        return {}

    size_pattern = r"(XXL|XL|L|M|S|XS)"
    measurement_pattern = (
        rf"(?<![A-Za-z]){size_pattern}(?![A-Za-z])"
        r"(?:\s+Hide)?\s+"
        r"Body\s+Measurement\s*:\s*To\s+Fit\s+Chest\s*-\s*"
        r"([0-9]+(?:\.[0-9]+)?)\s*(in|inch|inches|cm|cms|centimeters?)"
    )
    chart: dict[str, float] = {}
    for match in re.finditer(measurement_pattern, haystack, flags=re.IGNORECASE):
        size = _normalize_size_label(match.group(1))
        value = _measurement_to_cm(match.group(2), match.group(3))
        if size and value:
            chart[size] = value

    if chart:
        return chart

    single_size_match = re.search(
        r"(?:wearing|wears)\s+(?:a\s+)?size\s+(XXL|XL|L|M|S|XS)",
        haystack,
        flags=re.IGNORECASE,
    )
    single_chest_match = re.search(
        r"Body\s+Measurement\s*:\s*To\s+Fit\s+Chest\s*-\s*"
        r"([0-9]+(?:\.[0-9]+)?)\s*(in|inch|inches|cm|cms|centimeters?)",
        haystack,
        flags=re.IGNORECASE,
    )
    if single_size_match and single_chest_match:
        size = _normalize_size_label(single_size_match.group(1))
        value = _measurement_to_cm(single_chest_match.group(1), single_chest_match.group(2))
        return {size: value} if size and value else {}

    return {}


def _fallback_myntra_body_chart(brand: str, title: str, category: str) -> dict[str, float]:
    text = _canonicalize_text(f"{brand} {title} {category}")
    if "tshirt" not in text and "t shirt" not in text and "t-shirt" not in text and "shirt" not in text:
        return {}
    brand_key = _canonicalize_text(brand).strip()
    if brand_key not in STANDARD_MYNTRA_BODY_CHART_BRANDS:
        return {}
    return {size: round(value, 2) for size, value in STANDARD_MYNTRA_TSHIRT_BODY_CHART.items()}


def _normalize_size_label(size: str) -> str:
    normalized = str(size or "").strip().upper()
    return normalized if normalized in {"XS", "S", "M", "L", "XL", "XXL"} else ""


def _measurement_to_cm(value: str, unit: str) -> float | None:
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None
    if numeric_value <= 0:
        return None
    normalized_unit = _canonicalize_text(unit)
    if normalized_unit.startswith("in"):
        numeric_value *= 2.54
    return round(numeric_value, 2)


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

def _build_request_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/123.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    }


def _extract_meta_content(soup: BeautifulSoup) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = tag.get("property") or tag.get("name") or tag.get("itemprop")
        value = tag.get("content")
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        normalized_key = key.strip().lower()
        normalized_value = value.strip()
        if normalized_key and normalized_value and normalized_key not in metadata:
            metadata[normalized_key] = normalized_value
    return metadata


def _node_text(node: object) -> str:
    if node is None:
        return ""
    if hasattr(node, "get_text"):
        try:
            return str(node.get_text(" ", strip=True))
        except Exception:
            return ""
    return ""


def _first_heading_text(soup: BeautifulSoup) -> str:
    heading = soup.find(["h1", "h2"])
    return _node_text(heading)


def _first_image_src(soup: BeautifulSoup) -> str:
    for tag in soup.find_all(["img", "source"]):
        for attribute in ("src", "data-src", "data-original", "srcset"):
            value = tag.get(attribute)
            if not isinstance(value, str):
                continue
            candidate = value.split(",")[0].strip().split(" ")[0]
            if not candidate or candidate.startswith("data:"):
                continue
            return candidate
    return ""


def _normalize_image_url(page_url: str, image_url: str) -> str:
    candidate = html.unescape(image_url or "").strip()
    if not candidate or candidate.startswith("data:"):
        return ""
    if candidate.startswith("//"):
        parsed = urlparse(page_url)
        return f"{parsed.scheme}:{candidate}"
    return urljoin(page_url, candidate)


def _extract_jsonld_fields(soup: BeautifulSoup) -> dict[str, str]:
    extracted = {
        "title": "",
        "image": "",
        "brand": "",
        "category": "",
        "price": "",
        "currency_price": "",
    }
    scripts = soup.find_all("script", attrs={"type": re.compile(r"application/ld\+json", flags=re.IGNORECASE)})
    for script in scripts:
        raw_payload = script.string if isinstance(script.string, str) else script.get_text()
        if not isinstance(raw_payload, str) or not raw_payload.strip():
            continue
        for payload in _parse_jsonld(raw_payload):
            for node in _iter_jsonld_nodes(payload):
                _collect_jsonld_node(node, extracted)
    return extracted


def _parse_jsonld(raw_payload: str) -> list[object]:
    payload = raw_payload.strip()
    if not payload:
        return []
    try:
        return [json.loads(payload)]
    except json.JSONDecodeError:
        cleaned = re.sub(r"[\u0000-\u001f]+", " ", payload)
        try:
            return [json.loads(cleaned)]
        except json.JSONDecodeError:
            return []


def _iter_jsonld_nodes(payload: object):
    if isinstance(payload, list):
        for item in payload:
            yield from _iter_jsonld_nodes(item)
        return
    if not isinstance(payload, dict):
        return
    yield payload
    graph = payload.get("@graph")
    if isinstance(graph, (list, dict)):
        yield from _iter_jsonld_nodes(graph)


def _collect_jsonld_node(node: dict[str, object], extracted: dict[str, str]) -> None:
    if not extracted["title"]:
        extracted["title"] = _jsonld_as_text(node.get("name"))
    if not extracted["image"]:
        extracted["image"] = _jsonld_image(node.get("image"))
    if not extracted["category"]:
        extracted["category"] = _jsonld_as_text(node.get("category")) or _jsonld_as_text(node.get("itemCategory"))
    if not extracted["brand"]:
        extracted["brand"] = _jsonld_brand(node.get("brand"))

    offers = node.get("offers")
    if offers is not None and not extracted["price"]:
        price, currency_price = _jsonld_offer_price(offers)
        extracted["price"] = price
        extracted["currency_price"] = currency_price

    if not extracted["price"]:
        direct_price = _jsonld_as_text(node.get("price"))
        if direct_price:
            extracted["price"] = direct_price


def _jsonld_offer_price(offers: object) -> tuple[str, str]:
    candidates = offers if isinstance(offers, list) else [offers]
    for offer in candidates:
        if not isinstance(offer, dict):
            continue
        price = _jsonld_as_text(offer.get("price"))
        currency = _jsonld_as_text(offer.get("priceCurrency")).upper()
        if price and currency:
            return price, f"{currency} {price}"
        if price:
            return price, price
    return "", ""


def _jsonld_brand(brand: object) -> str:
    if isinstance(brand, str):
        return brand.strip()
    if isinstance(brand, dict):
        return _jsonld_as_text(brand.get("name"))
    if isinstance(brand, list):
        for item in brand:
            resolved = _jsonld_brand(item)
            if resolved:
                return resolved
    return ""


def _jsonld_image(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                return item.strip()
            if isinstance(item, dict):
                candidate = _jsonld_as_text(item.get("url")) or _jsonld_as_text(item.get("contentUrl"))
                if candidate:
                    return candidate
    if isinstance(value, dict):
        return _jsonld_as_text(value.get("url")) or _jsonld_as_text(value.get("contentUrl"))
    return ""


def _jsonld_as_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    return ""


def _resolve_redirects(url: str) -> str:
    candidate = _unwrap_embedded_redirects(url)
    parsed = urlparse(candidate)
    hostname = (parsed.hostname or "").lower()
    needs_resolution = (
        hostname in SHORT_REDIRECT_DOMAINS
        or "onelink" in hostname
        or any(key.lower() in REDIRECT_QUERY_PARAMS for key, _ in parse_qsl(parsed.query, keep_blank_values=True))
    )
    if not needs_resolution:
        return candidate

    try:
        response = safe_http_get(
            candidate,
            headers=_build_request_headers(),
            timeout=(HTTP_CONNECT_TIMEOUT_SECONDS, HTTP_READ_TIMEOUT_SECONDS),
        )
        final_url = response.url or candidate
        if hasattr(response, 'close'):
            response.close()
        unwrapped_final_url = _unwrap_embedded_redirects(final_url)
        if unwrapped_final_url != url:
            logger.info("Resolved redirect original_url=%s final_url=%s", url, unwrapped_final_url)
        return unwrapped_final_url
    except Exception as exc:
        logger.warning("Failed to resolve redirect URL=%s: %s", url, exc)
        return candidate


def _unwrap_embedded_redirects(url: str) -> str:
    current_url = url.strip()
    seen_urls = {current_url}
    for _ in range(4):
        target = _extract_embedded_redirect_target(current_url)
        if not target or target in seen_urls:
            break
        seen_urls.add(target)
        current_url = target
    return current_url


def _extract_embedded_redirect_target(url: str) -> str:
    parsed = urlparse(url)
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key.lower() not in REDIRECT_QUERY_PARAMS:
            continue
        decoded = unquote(value).strip()
        if decoded.startswith("http://") or decoded.startswith("https://"):
            return decoded
    fragment = unquote(parsed.fragment).strip()
    if fragment.startswith("http://") or fragment.startswith("https://"):
        return fragment
    return ""
