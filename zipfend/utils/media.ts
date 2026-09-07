/** Shrink a photo before upload — phone camera files are 5–10MB. */
export async function compressImage(file: File | Blob, maxDim = 1280, quality = 0.82): Promise<Blob> {
  const decoded = await decodeImage(file);

  try {
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
    if (scale === 1 && file.size < 900_000) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return file;

    // Keep the downsample visually lossless at the dimensions sent to the API.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    return await canvasToBlob(canvas, quality, file);
  } finally {
    decoded.release();
  }
}

/**
 * Encode an image for a JSON API without first materializing the original file
 * as a base64 string. This avoids holding both a multi-megabyte source data URL
 * and its decoded bitmap in the JS heap at once.
 */
export async function toImageDataUrl(file: File | Blob, maxDim = 1280, quality = 0.82): Promise<string> {
  const compressed = await compressImage(file, maxDim, quality);
  return blobToDataUrl(compressed);
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

async function decodeImage(file: File | Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Some Safari and HEIC paths do not support createImageBitmap. Fall back
      // to the browser image decoder while retaining the same output contract.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = 'async';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not decode the selected image.'));
      element.src = objectUrl;
    });

    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number, fallback: Blob): Promise<Blob> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob || fallback), 'image/jpeg', quality));
}

function blobToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not encode the selected image.'));
    reader.readAsDataURL(file);
  });
}

/** Data URL for draft persistence (small: 900px, q0.7 keeps localStorage happy). */
export async function toDraftDataUrl(file: File | Blob): Promise<string> {
  const blob = await compressImage(file, 900, 0.7);
  return blobToDataUrl(blob);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Compresses and encodes a profile photo directly to an optimized, lightweight
 * Data URL that is persisted into Firestore users/{uid} and local state instantly
 * without being blocked by cross-origin Storage bucket preflight errors.
 */
export async function uploadOrEncodeProfilePhoto(file: File | Blob): Promise<string> {
  const blob = await compressImage(file, 512, 0.85);
  return blobToDataUrl(blob);
}

/**
 * Compresses and encodes a banner photo directly to an optimized Data URL.
 */
export async function uploadOrEncodeBannerPhoto(file: File | Blob): Promise<string> {
  const blob = await compressImage(file, 1024, 0.80);
  return blobToDataUrl(blob);
}
