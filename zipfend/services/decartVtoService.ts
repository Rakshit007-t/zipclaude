import { createDecartClient, models } from '@decartai/sdk';
import { authorizedFetch, getBackendBaseUrl } from './ziprightApi';

export interface DecartStatusResponse {
  enabled: boolean;
  model: string;
  max_session_seconds: number;
}

export interface DecartTokenResponse {
  client_token: string;
  model: string;
  expires_at: string | null;
  max_session_seconds: number;
  fps: number;
  width: number;
  height: number;
}

export interface DecartSessionCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionChange?: (state: string) => void;
  onError?: (error: Error) => void;
  onEnded?: () => void;
}

/**
 * Fetch Decart configuration status from ZipRIGHT backend.
 */
export async function getDecartStatus(): Promise<DecartStatusResponse> {
  try {
    const res = await fetch(`${getBackendBaseUrl()}/tryon-live/decart/status`);
    if (!res.ok) {
      return { enabled: false, model: 'lucy-vton-3.5', max_session_seconds: 60 };
    }
    return await res.json();
  } catch (err) {
    console.warn('Failed to load Decart status:', err);
    return { enabled: false, model: 'lucy-vton-3.5', max_session_seconds: 60 };
  }
}

/**
 * Request a short-lived Decart client token from the ZipRIGHT authenticated backend.
 * Permanent API key is NEVER exposed to the browser.
 */
export async function fetchDecartClientToken(requestedDuration?: number): Promise<DecartTokenResponse> {
  const payload = requestedDuration ? { requested_duration_seconds: requestedDuration } : {};
  const res = await authorizedFetch(`${getBackendBaseUrl()}/tryon-live/decart/token`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Please sign in to access AI Live Try-On.');
    }
    if (res.status === 409) {
      throw new Error('An active AI Live Try-On session is already running. Please close it first.');
    }
    if (res.status === 429) {
      throw new Error('Rate limit reached for AI Live Try-On. Please wait a minute before trying again.');
    }
    if (res.status === 503) {
      throw new Error(body?.message || 'AI Live Try-On is temporarily unavailable.');
    }
    throw new Error(body?.message || 'Failed to initialize AI Live Try-On session.');
  }

  return body as DecartTokenResponse;
}

/**
 * Notify backend that the active Decart session has completed or closed.
 */
export async function releaseDecartSession(): Promise<void> {
  try {
    await authorizedFetch(`${getBackendBaseUrl()}/tryon-live/decart/session/end`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (err) {
    console.warn('Failed to release Decart session on backend:', err);
  }
}

/**
 * Construct a deterministic, descriptive try-on prompt for Lucy VTON.
 * Follows Step 5 specifications without external LLM overhead.
 */
export function buildGarmentTryonPrompt(product: any): string {
  if (!product) {
    return 'Substitute the current top with the selected garment.';
  }

  const title = (product.title || product.name || '').trim();
  const color = (product.color || '').trim();
  const material = (product.material || '').trim();
  const fit = (product.fit || 'relaxed').trim();

  const descriptors = [color, material, title].filter(Boolean).join(' ');
  if (descriptors) {
    return `Substitute the current top with a ${descriptors} with a ${fit} fit.`;
  }

  return 'Substitute the current top with the selected garment.';
}

/**
 * Fetch and prepare a garment image as a Blob so it can be sent cleanly to Decart.
 */
export async function prepareGarmentBlob(imageUrl: string): Promise<Blob> {
  const res = await fetch(imageUrl, { mode: 'cors' });
  if (!res.ok) {
    throw new Error(`Failed to load garment image: ${res.statusText}`);
  }
  return await res.blob();
}

/**
 * Active Realtime Decart Session Controller.
 * Encapsulates the WebRTC lifecycle, remote stream handling, garment swaps, and cleanup.
 */
export class DecartRealtimeSession {
  private client: any = null;
  private realtimeClient: any = null;
  private cameraStream: MediaStream | null = null;
  private active = false;

  async start(
    cameraStream: MediaStream,
    tokenResponse: DecartTokenResponse,
    initialProduct: any,
    callbacks: DecartSessionCallbacks
  ): Promise<void> {
    this.cameraStream = cameraStream;

    // Initialize Decart client with the short-lived client token
    this.client = createDecartClient({ apiKey: tokenResponse.client_token });

    const modelName = (tokenResponse.model || 'lucy-vton-3.5') as any;
    const model = models.realtime(modelName);

    // Prepare initial prompt and garment image
    const initialPromptText = buildGarmentTryonPrompt(initialProduct);
    let initialImageBlob: Blob | string | undefined = undefined;

    if (initialProduct?.image) {
      try {
        initialImageBlob = await prepareGarmentBlob(initialProduct.image);
      } catch (err) {
        console.warn('Failed to pre-fetch garment blob, using image URL directly:', err);
        initialImageBlob = initialProduct.image;
      }
    }

    const initialState: any = {
      prompt: { text: initialPromptText, enhance: false },
    };
    if (initialImageBlob) {
      initialState.image = initialImageBlob;
    }

    try {
      this.realtimeClient = await this.client.realtime.connect(cameraStream, {
        model,
        onRemoteStream: (stream: MediaStream) => {
          callbacks.onRemoteStream(stream);
        },
        onConnectionChange: (state: any) => {
          if (callbacks.onConnectionChange) {
            callbacks.onConnectionChange(typeof state === 'string' ? state : JSON.stringify(state));
          }
        },
        initialState,
        mirror: 'auto',
      });

      this.active = true;

      if (this.realtimeClient.on) {
        this.realtimeClient.on('sessionEnded', () => {
          this.active = false;
          callbacks.onEnded?.();
        });
        this.realtimeClient.on('error', (err: any) => {
          console.error('Decart realtime session error:', err);
          callbacks.onError?.(new Error(err?.message || 'Decart realtime stream error'));
        });
      }
    } catch (err: any) {
      this.active = false;
      throw err;
    }
  }

  /**
   * Swap the reference garment dynamically without reconnecting the WebRTC stream.
   */
  async updateGarment(product: any): Promise<void> {
    if (!this.realtimeClient || !this.active) return;

    const promptText = buildGarmentTryonPrompt(product);
    let imageBlob: Blob | string | null = null;

    if (product?.image) {
      try {
        imageBlob = await prepareGarmentBlob(product.image);
      } catch (err) {
        console.warn('Failed to fetch garment image blob, fallback to URL:', err);
        imageBlob = product.image;
      }
    }

    try {
      if (this.realtimeClient.set) {
        await this.realtimeClient.set({
          prompt: { text: promptText, enhance: false },
          image: imageBlob,
        });
      } else if (this.realtimeClient.setImage) {
        await this.realtimeClient.setImage(imageBlob);
        if (this.realtimeClient.setPrompt) {
          await this.realtimeClient.setPrompt(promptText, { enhance: false });
        }
      }
    } catch (err) {
      console.warn('Decart dynamic garment swap warning:', err);
    }
  }

  /**
   * Disconnect the active WebRTC stream and free all resources.
   */
  disconnect(): void {
    if (this.realtimeClient) {
      try {
        this.realtimeClient.disconnect();
      } catch (err) {
        console.warn('Error disconnecting Decart realtime client:', err);
      }
      this.realtimeClient = null;
    }

    this.active = false;
    this.client = null;
    this.cameraStream = null;

    // Release session slot on backend
    releaseDecartSession();
  }

  isActive(): boolean {
    return this.active;
  }
}
