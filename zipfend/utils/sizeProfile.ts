import type {
  UserBaseSize,
  UserFitPreference,
  UserMeasurements,
  UserProfile,
} from '../contexts/UserProfileContext';

export type SizeEngineBaseSize = UserBaseSize;
export type SizeEngineFitPreference = UserFitPreference;

export interface SizeEngineProfileInput {
  height: number;
  baseSize?: SizeEngineBaseSize;
  fitPreference?: SizeEngineFitPreference;
  measurements?: Partial<UserMeasurements> | null;
}

export interface SizeEngineProfile {
  base_size: SizeEngineBaseSize;
  fit_preference: SizeEngineFitPreference;
  chest?: number;
  waist?: number;
  shoulders?: number;
  hips?: number;
  legs?: number;
  bust?: number;
}

const SIZE_SCALE: SizeEngineBaseSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function clampPositive(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeMeasurements(
  measurements?: Partial<UserMeasurements> | null,
): UserMeasurements {
  if (!measurements) {
    return {};
  }

  return Object.entries(measurements).reduce<UserMeasurements>((next, [key, value]) => {
    const numericValue = clampPositive(value);
    if (!numericValue) {
      return next;
    }

    next[key as keyof UserMeasurements] = numericValue;
    return next;
  }, {});
}

function adjustSize(baseSize: SizeEngineBaseSize, adjustment: number): SizeEngineBaseSize {
  const currentIndex = SIZE_SCALE.indexOf(baseSize);
  const safeIndex = currentIndex === -1 ? SIZE_SCALE.indexOf('M') : currentIndex;
  const nextIndex = Math.max(0, Math.min(SIZE_SCALE.length - 1, safeIndex + adjustment));
  return SIZE_SCALE[nextIndex];
}

export function hasBodyMeasurements(
  measurements?: Partial<UserMeasurements> | null,
): measurements is Partial<UserMeasurements> {
  if (!measurements) {
    return false;
  }

  return Object.values(measurements).some((value) => clampPositive(value) > 0);
}

export function hasCoreMeasurements(
  measurements?: Partial<UserMeasurements> | null,
): measurements is Partial<UserMeasurements> {
  if (!measurements) {
    return false;
  }

  const normalized = normalizeMeasurements(measurements);
  return Boolean(
    clampPositive(normalized.chest ?? normalized.bust) &&
    clampPositive(normalized.waist),
  );
}

export function buildMeasurementsForSizing(
  measurements?: Partial<UserMeasurements> | null,
): UserMeasurements | null {
  if (!hasCoreMeasurements(measurements)) {
    return null;
  }

  return normalizeMeasurements(measurements);
}

export function estimateBaseSizeFromBodyMetrics(
  height: number,
  measurements?: Partial<UserMeasurements> | null,
  preferredBaseSize?: SizeEngineBaseSize,
): SizeEngineBaseSize | null {
  const safeHeight = clampPositive(height);
  const sizingMeasurements = normalizeMeasurements(measurements);
  const chest = clampPositive(sizingMeasurements.chest ?? sizingMeasurements.bust);
  const waist = clampPositive(sizingMeasurements.waist);

  if (!chest || !waist) {
    return preferredBaseSize || null;
  }

  const anchor = Math.max(chest, waist + 8);

  let baseSize: SizeEngineBaseSize = 'XXL';
  const thresholds: Array<[number, SizeEngineBaseSize]> = [
    [88, 'XS'],
    [96, 'S'],
    [104, 'M'],
    [112, 'L'],
    [120, 'XL'],
  ];

  for (const [limit, size] of thresholds) {
    if (anchor <= limit) {
      baseSize = size;
      break;
    }
  }

  if (safeHeight >= 188 && ['XS', 'S', 'M'].includes(baseSize)) {
    return adjustSize(baseSize, 1);
  }

  if (safeHeight > 0 && safeHeight <= 160 && ['M', 'L', 'XL', 'XXL'].includes(baseSize) && chest <= 96) {
    return adjustSize(baseSize, -1);
  }

  return baseSize;
}

export function buildSizeEngineProfileFromBodyMetrics(
  input: SizeEngineProfileInput,
): SizeEngineProfile | null {
  // GUARD: Require actual body measurements (chest + waist at minimum).
  // Without real measurements we cannot produce a trustworthy recommendation.
  if (!hasCoreMeasurements(input.measurements)) {
    return null;
  }

  const baseSize = estimateBaseSizeFromBodyMetrics(
    input.height,
    input.measurements,
    input.baseSize,
  );
  if (!baseSize) {
    return null;
  }

  const normalizedMeasurements = normalizeMeasurements(input.measurements);

  return {
    base_size: baseSize,
    fit_preference: input.fitPreference || 'regular',
    chest: clampPositive(normalizedMeasurements.chest ?? normalizedMeasurements.bust) || undefined,
    waist: clampPositive(normalizedMeasurements.waist) || undefined,
    shoulders: clampPositive(normalizedMeasurements.shoulders) || undefined,
    hips: clampPositive(normalizedMeasurements.hips) || undefined,
    legs: clampPositive(normalizedMeasurements.legs) || undefined,
    bust: clampPositive(normalizedMeasurements.bust) || undefined,
  };
}

export function buildSizeEngineProfileFromUserProfile(
  userProfile: Partial<UserProfile> | null | undefined,
): SizeEngineProfile | null {
  return buildSizeEngineProfileFromBodyMetrics({
    height: clampPositive(userProfile?.height),
    baseSize: userProfile?.baseSize,
    fitPreference: userProfile?.fitPreference,
    measurements: userProfile?.measurements,
  });
}
