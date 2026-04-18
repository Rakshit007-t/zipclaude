const DEFAULT_API_BASE_URL = (
    typeof window !== "undefined" &&
    typeof window.location?.origin === "string" &&
    window.location.origin.trim()
        ? window.location.origin
        : "http://127.0.0.1:8000"
).replace(/\/+$/, "");

let apiBaseUrl = DEFAULT_API_BASE_URL;

class ApiError extends Error {
    constructor(message, status, detail) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.detail = detail;
    }
}

const jsonHeaders = {
    "Content-Type": "application/json",
};

function setApiBaseUrl(baseUrl) {
    apiBaseUrl = baseUrl.replace(/\/+$/, "");
}

function getApiBaseUrl() {
    return apiBaseUrl;
}

function resolveApiUrl(pathOrUrl) {
    if (!pathOrUrl) {
        return pathOrUrl;
    }

    if (
        /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(pathOrUrl) ||
        pathOrUrl.startsWith("data:") ||
        pathOrUrl.startsWith("blob:")
    ) {
        return pathOrUrl;
    }

    const normalizedPath = pathOrUrl.startsWith("/")
        ? pathOrUrl
        : `/${pathOrUrl}`;

    return `${apiBaseUrl}${normalizedPath}`;
}

async function parseResponse(response) {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
        return response.json();
    }

    if (contentType.startsWith("text/")) {
        return response.text();
    }

    return null;
}

function debugLog(label, payload) {
    console.debug(`[api] ${label}`, payload);
}

function summarizeRequestBody(body) {
    if (!body) {
        return null;
    }

    if (body instanceof FormData) {
        return {
            type: "FormData",
            fields: Array.from(body.keys()),
        };
    }

    if (typeof body === "string") {
        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    }

    return { type: typeof body };
}

function extractApiErrorMessage(payload, status) {
    if (
        payload &&
        typeof payload === "object" &&
        payload.error &&
        typeof payload.error.message === "string"
    ) {
        return payload.error.message;
    }

    if (
        payload &&
        typeof payload === "object" &&
        typeof payload.detail === "string"
    ) {
        return payload.detail;
    }

    return `Request failed with status ${status}`;
}

async function request(path, init, token) {
    const headers = new Headers(init.headers ?? {});
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    const url = `${apiBaseUrl}${path}`;
    debugLog(`request ${init.method ?? "GET"} ${url}`, {
        headers: Object.fromEntries(headers.entries()),
        body: summarizeRequestBody(init.body),
    });

    const response = await fetch(url, {
        ...init,
        headers,
    });
    const payload = await parseResponse(response);
    debugLog(`response ${response.status} ${url}`, payload);

    if (!response.ok) {
        const detail =
            payload &&
            typeof payload === "object" &&
            payload.error &&
            typeof payload.error === "object"
                ? payload.error.details ?? payload.error.message
                : payload;
        const message = extractApiErrorMessage(payload, response.status);
        debugLog(`error ${response.status} ${url}`, { message, detail });
        throw new ApiError(message, response.status, detail);
    }

    return payload.data;
}

async function calculateSize(payload) {
    return request("/size-engine", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });
}

async function extractProduct(payload) {
    return request("/extract-product", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });
}

async function createTryOnImage(payload) {
    const response = await request("/tryon-image", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });

    return {
        ...response,
        tryon_image: resolveApiUrl(response.tryon_image),
    };
}

async function createAvatar(payload) {
    const formData = new FormData();
    formData.append("file", payload.file, payload.filename ?? "avatar.jpg");

    const response = await request("/avatar-create", {
        method: "POST",
        body: formData,
    });

    return {
        ...response,
        public_path: resolveApiUrl(response.public_path),
    };
}

export {
    ApiError,
    DEFAULT_API_BASE_URL,
    calculateSize,
    createAvatar,
    createTryOnImage,
    extractProduct,
    getApiBaseUrl,
    resolveApiUrl,
    setApiBaseUrl,
};
