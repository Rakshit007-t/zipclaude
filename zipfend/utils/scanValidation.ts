/**
 * Central scan validation utility.
 * Used by every code path before measurements are shown or persisted.
 *
 * Checks:
 *  1. Measurements object exists and is non-null.
 *  2. All required keys are present as finite positive numbers.
 *  3. Values fall within anatomically plausible ranges (cm).
 */

export interface ScanValidationResult {
  isValid: boolean;
  message?: string;
}

const REQUIRED_KEYS = ['chest', 'waist', 'shoulders', 'arms', 'legs'] as const;

const SANITY_RANGES: Record<(typeof REQUIRED_KEYS)[number], [number, number]> = {
  chest:     [70, 140],
  waist:     [55, 130],
  shoulders: [30, 60],
  arms:      [40, 80],
  legs:      [60, 120],
};

export function isValidMeasurements(measurements: unknown): boolean {
  if (!measurements || typeof measurements !== 'object') {
    return false;
  }

  return REQUIRED_KEYS.every((key) => {
    const value = (measurements as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return false;
    }

    const [min, max] = SANITY_RANGES[key];
    return value > min && value < max;
  });
}

export function isValidScan(result: unknown): ScanValidationResult {
  if (!result || typeof result !== 'object') {
    return { isValid: false, message: 'No scan data received.' };
  }

  if ('isValid' in (result as Record<string, unknown>) && (result as Record<string, unknown>).isValid === false) {
    const message = (result as Record<string, unknown>).message;
    return {
      isValid: false,
      message: typeof message === 'string' && message.trim()
        ? message
        : 'Scan not reliable. Stand straight and try again.',
    };
  }

  const measurements = (result as any).measurements ?? result;

  if (!measurements || typeof measurements !== 'object') {
    return { isValid: false, message: 'No measurements in scan result.' };
  }

  if (!isValidMeasurements(measurements)) {
    for (const key of REQUIRED_KEYS) {
      const value = (measurements as Record<string, unknown>)[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return {
          isValid: false,
          message: `Missing or invalid measurement: ${key}`,
        };
      }

      const [min, max] = SANITY_RANGES[key];
      if (value <= min || value >= max) {
        return {
          isValid: false,
          message: `Measurement out of range: ${key} = ${value} cm (expected ${min}–${max} cm). Retake your scan.`,
        };
      }
    }
  }

  return { isValid: true };
}
