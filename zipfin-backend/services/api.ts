function detectDefaultApiBaseUrl(): string {
    if (
        typeof window !== "undefined" &&
        typeof window.location?.origin === "string" &&
        window.location.origin.trim()
    ) {
        return window.location.origin.replace(/\/+$/, "");
    }

    return "http://127.0.0.1:8000";
}

export const DEFAULT_API_BASE_URL = detectDefaultApiBaseUrl();

let apiBaseUrl = DEFAULT_API_BASE_URL;

export class ApiError extends Error {
    status: number;
    detail: unknown;

    constructor(message: string, status: number, detail: unknown) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.detail = detail;
    }
}

export interface ApiSuccessResponse<T> {
    success: true;
    message: string;
    data: T;
}

export interface ApiErrorPayload {
    success: false;
    error: {
        message: string;
        status_code: number;
        details?: unknown;
    };
}

export interface SizeEngineRequest {
    chest: number;
    waist_cm?: number;
    hip_cm?: number;
    fit?: string;
    brand?: string;
    range: string;
}

export interface SizeEngineResponse {
    size: string;
    confidence: number;
    risk: string;
}

export interface ExtractProductRequest {
    url: string;
}

export interface ExtractProductResponse {
    title: string;
    brand: string;
    category: string;
}

export interface TryOnImageRequest {
    user_id: string;
    product_image_url: string;
}

export interface TryOnImageResponse {
    tryon_image: string;
}

export interface AvatarCreateResponse {
    user_id: string;
    public_path: string;
    embedding: number[];
}

export interface AvatarCreateRequest {
    file: Blob;
    filename?: string;
}

export interface EmailAuthRequest {
    email: string;
    password: string;
}

export interface AuthUser {
    id: string;
    email: string;
}

export interface AuthSession {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
}

export interface AuthResult {
    user: AuthUser;
    session: AuthSession | null;
    needs_email_verification: boolean;
}

type RequestBody = BodyInit | null | undefined;

export interface ProfileResponse {
    id: string;
    email: string;
    brand: string | null;
    size: string | null;
    fit: string | null;
}

export interface ProfileUpsertRequest {
    brand?: string | null;
    size?: string | null;
    fit?: string | null;
}

const jsonHeaders = {
    "Content-Type": "application/json",
};

export function setApiBaseUrl(baseUrl: string): void {
    apiBaseUrl = baseUrl.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
    return apiBaseUrl;
}

export function resolveApiUrl(pathOrUrl: string): string {
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

async function parseResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
        return response.json();
    }

    if (contentType.startsWith("text/")) {
        return response.text();
    }

    return null;
}

function debugLog(label: string, payload: unknown): void {
    if (typeof console === "undefined") {
        return;
    }

    console.debug(`[api] ${label}`, payload);
}

function summarizeRequestBody(body: RequestBody): unknown {
    if (!body) {
        return null;
    }

    if (typeof FormData !== "undefined" && body instanceof FormData) {
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

function extractApiErrorMessage(payload: unknown, status: number): string {
    if (
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        payload.error &&
        typeof payload.error === "object" &&
        "message" in payload.error &&
        typeof payload.error.message === "string"
    ) {
        return payload.error.message;
    }

    if (
        payload &&
        typeof payload === "object" &&
        "detail" in payload &&
        typeof payload.detail === "string"
    ) {
        return payload.detail;
    }

    return `Request failed with status ${status}`;
}

async function request<T>(
    path: string,
    init: RequestInit,
    token?: string,
): Promise<T> {
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
        const errorPayload = payload as ApiErrorPayload | null;
        const detail =
            errorPayload &&
            typeof errorPayload === "object" &&
            "error" in errorPayload
                ? errorPayload.error.details ?? errorPayload.error.message
                : payload;
        const message = extractApiErrorMessage(payload, response.status);

        debugLog(`error ${response.status} ${url}`, {
            message,
            detail,
        });

        throw new ApiError(
            message,
            response.status,
            detail,
        );
    }

    return (payload as ApiSuccessResponse<T>).data;
}

export async function calculateSize(
    payload: SizeEngineRequest,
): Promise<SizeEngineResponse> {
    return request<SizeEngineResponse>("/size-engine", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });
}

export async function extractProduct(
    payload: ExtractProductRequest,
): Promise<ExtractProductResponse> {
    return request<ExtractProductResponse>("/extract-product", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });
}

export async function signUpWithEmail(
    payload: EmailAuthRequest,
): Promise<AuthResult> {
    return request<AuthResult>("/auth/signup", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });
}

export async function signInWithEmail(
    payload: EmailAuthRequest,
): Promise<AuthResult> {
    return request<AuthResult>("/auth/login", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });
}

export async function fetchMyProfile(token: string): Promise<ProfileResponse> {
    return request<ProfileResponse>(
        "/profiles/me",
        {
            method: "GET",
        },
        token,
    );
}

export async function saveMyProfile(
    payload: ProfileUpsertRequest,
    token: string,
): Promise<ProfileResponse> {
    return request<ProfileResponse>(
        "/profiles/me",
        {
            method: "PUT",
            headers: jsonHeaders,
            body: JSON.stringify(payload),
        },
        token,
    );
}

export async function createTryOnImage(
    payload: TryOnImageRequest,
): Promise<TryOnImageResponse> {
    const response = await request<TryOnImageResponse>("/tryon-image", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
    });

    return {
        ...response,
        tryon_image: resolveApiUrl(response.tryon_image),
    };
}

export async function createAvatar(
    payload: AvatarCreateRequest,
): Promise<AvatarCreateResponse> {
    const formData = new FormData();
    formData.append("file", payload.file, payload.filename ?? "avatar.jpg");

    const response = await request<AvatarCreateResponse>("/avatar-create", {
        method: "POST",
        body: formData,
    });

    return {
        ...response,
        public_path: resolveApiUrl(response.public_path),
    };
}
