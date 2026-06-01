import { getBackendBaseUrl } from './ziprightApi';

const API_BASE_URL = getBackendBaseUrl();
const API_KEY = (import.meta.env.VITE_API_KEY || '').trim();
const SYSTEM_PROMPT = `You are a professional fashion stylist assistant.

Your job is to give accurate, context-aware outfit advice.`;

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
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "gemini-1.5-flash",
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature: 0.9,
      top_p: 0.95,
      frequency_penalty: 0.7,
      presence_penalty: 0.7,
      message: userMessage,
    }),
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
