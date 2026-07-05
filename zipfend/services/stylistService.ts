import { getBackendBaseUrl } from './ziprightApi';

const API_BASE_URL = getBackendBaseUrl();

interface StylistResponse {
  reply: string;
}

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }) {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error?.name === 'AbortError') {
      throw new Error('Stylist request failed');
    }
    throw error;
  }
}

export async function getStylistResponse(message: string): Promise<StylistResponse> {
  const userMessage = message.trim();
  const response = await fetchWithTimeout(`${API_BASE_URL}/stylist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: userMessage }),
    timeout: 10000,
  });

  if (!response.ok) {
    throw new Error("Stylist request failed");
  }

  const payload = await response.json().catch(() => null);
  const reply = typeof payload?.reply === 'string'
    ? payload.reply
    : typeof payload?.data?.reply === 'string'
      ? payload.data.reply
      : '';

  if (!reply) {
    throw new Error("Stylist request failed");
  }

  return { reply };
}
