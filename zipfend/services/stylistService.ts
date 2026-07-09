import { authorizedFetch, getBackendBaseUrl } from './ziprightApi';

const API_BASE_URL = getBackendBaseUrl();

// The stylist runs on a local LLM: the first request after idle loads the
// model into VRAM, which can take ~15-30s before tokens flow.
const STYLIST_TIMEOUT_MS = 60000;

interface StylistResponse {
  reply: string;
}

export async function getStylistResponse(message: string): Promise<StylistResponse> {
  const userMessage = message.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STYLIST_TIMEOUT_MS);

  let response: Response;
  try {
    // Authorized so the stylist can use the shopper's Fit Profile as context.
    response = await authorizedFetch(`${API_BASE_URL}/stylist`, {
      method: 'POST',
      body: JSON.stringify({ message: userMessage }),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('The stylist is taking too long — please try again.');
    }
    // Auth being unavailable must never block styling advice — retry plain.
    response = await fetch(`${API_BASE_URL}/stylist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

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
