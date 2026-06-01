type FitPreference = 'slim' | 'regular' | 'relaxed' | 'loose' | 'baggy';

type SizeKind = 'alpha' | 'numeric' | 'regional' | 'one-size' | 'unknown';
type JacketSubtype = 'HEAVY_JACKET' | 'LIGHT_JACKET';
type GarmentFamily =
  | 'T_SHIRT'
  | 'SHIRT'
  | 'POLO'
  | 'HOODIE'
  | 'SWEATSHIRT'
  | 'JACKET'
  | 'BLAZER'
  | 'COAT'
  | 'KURTA'
  | 'DRESS'
  | 'JEANS'
  | 'TROUSERS'
  | 'SHORTS'
  | 'SKIRT'
  | 'LEGGINGS'
  | 'UNKNOWN';

interface SizeOption {
  label: string;
  key: string;
  kind: SizeKind;
  alphaIndex?: number;
  numericValue?: number;
  prefix?: string;
}

interface EngineResultLike {
  size?: string;
  confidence?: number;
  reason?: string;
  risk?: string;
}

interface ProfileLike {
  baseSize?: string;
  fitPreference?: FitPreference | string;
  measurements?: {
    chest?: number;
    bust?: number;
    waist?: number;
    shoulders?: number;
    hips?: number;
    legs?: number;
  } | null;
}

interface ProductLike {
  title?: string;
  subtitle?: string;
  description?: string;
  brand?: string;
  category?: string;
  type?: string;
  tags?: unknown;
  metadata?: unknown;
  product_metadata?: unknown;
  confidence?: number;
  fit_hint?: string | null;
  size_chart?: Record<string, unknown> | null;
  sizeChart?: Record<string, unknown> | null;
  available_sizes?: unknown;
  availableSizes?: unknown;
  size_format?: string | null;
  [key: string]: unknown;
}

export interface ProductSizingDecision {
  size: string;
  alternativeSize: string;
  confidence: number;
  reason: string;
  availableSizes: string[];
  sizeFormat: string;
  sizeDirection: 'size-down' | 'true-to-size' | 'size-up';
  mappedFromEngine: string;
}

const ALPHA_INDEX: Record<string, number> = {
  XXS: 0,
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
  '2XL': 6,
  XXXL: 7,
  '3XL': 7,
  '4XL': 8,
  '5XL': 9,
};

const EXPLICIT_SIZE_KEYS = new Set([
  'available_sizes',
  'availablesizes',
  'sizes',
  'size',
  'sizeoptions',
  'size_options',
  'sizechart',
  'size_chart',
  'variants',
  'options',
  'stock',
  'inventory',
]);

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function compactKey(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function chartValueCm(value: unknown): number | undefined {
  const parsed = numberFrom(value);
  if (!parsed) return undefined;
  const centimeters = parsed < 70 ? parsed * 2.54 : parsed;
  return centimeters > 0 && centimeters <= 220 ? centimeters : undefined;
}

export function normalizeProductSizeChart(sizeChart: unknown): Record<string, number> | undefined {
  if (!sizeChart || typeof sizeChart !== 'object') return undefined;

  const normalized = Object.entries(sizeChart as Record<string, unknown>).reduce<Record<string, number>>((next, [size, value]) => {
    const option = normalizeSizeOption(size);
    const numericValue = chartValueCm(value);
    if (option && numericValue) {
      next[option.label] = numericValue;
    }
    return next;
  }, {});

  return Object.keys(normalized).length ? normalized : undefined;
}

function getProductSizeChartInput(product: ProductLike): unknown {
  return product.size_chart ?? product.sizeChart;
}

export function extractAvailableProductSizes(product: ProductLike | null | undefined): string[] {
  if (!product || typeof product !== 'object') return [];

  const candidates: unknown[] = [];
  const chart = normalizeProductSizeChart(getProductSizeChartInput(product));
  if (chart) {
    candidates.push(...Object.keys(chart));
  }

  collectSizeCandidates(product, candidates, [], 0);
  return normalizeSizeOptions(candidates).map(option => option.label);
}

export function refineProductRecommendation({
  product,
  engineResult,
  profile,
}: {
  product: ProductLike;
  engineResult: EngineResultLike;
  profile: ProfileLike;
}): ProductSizingDecision {
  const availableOptions = normalizeSizeOptions(extractAvailableProductSizes(product));
  const availableSizes = availableOptions.map(option => option.label);
  const sizeFormat = detectSizeFormat(availableOptions) || asText(product.size_format) || 'unknown';
  const productFit = detectProductFit(product);
  const fitPreference = normalizeFitPreference(profile.fitPreference);
  const chart = normalizeProductSizeChart(getProductSizeChartInput(product));
  const engineSize = String(engineResult.size || profile.baseSize || '').trim();
  const engineOption = normalizeSizeOption(engineSize);
  const garmentFamily = detectGarmentFamily(product);
  const category = detectProductCategory(product);
  const measurementAnchor = getMeasurementAnchor(profile, category);
  const engineHandledProductFit = /adjusted for .*product fit/i.test(String(engineResult.reason || ''));
  const oneSizeProduct = availableOptions.length > 0 && availableOptions.every(option => option.kind === 'one-size');
  const conflictResolution = resolveRuleConflict({
    family: garmentFamily.family,
    productFit,
  });

  const ruleDecision = getGarmentFamilyRule({
    family: garmentFamily.family,
    product,
    productFit,
    fitPreference,
    engineHandledProductFit,
    oneSizeProduct,
    conflictResolution,
  });

  const mapping = mapToAvailableSize({
    availableOptions,
    engineOption,
    engineSize,
    baseSize: profile.baseSize,
    chart,
    measurementAnchor,
    category,
    totalBias: ruleDecision.totalBias,
    fitPreference,
    productFit: ruleDecision.mappingProductFit,
  });

  const finalSize = mapping.size || engineSize || availableSizes[0] || '';
  const alternativeSize = finalSize && engineSize && finalSize !== engineSize ? engineSize : '';
  const confidence = calculateConfidence({
    baseConfidence: normalizeEngineConfidence(engineResult.confidence),
    product,
    profile,
    availableOptions,
    chart,
    garmentFamily: garmentFamily.family,
    productFit,
    mappingQuality: mapping.quality,
    sizeFormat,
    engineSize,
    finalSize,
    oneSizeProduct,
  });
  const direction = getSizeDirection(mapping.engineRank, mapping.finalRank);
  const reason = buildRecommendationReason({
    finalSize,
    engineSize,
    availableSizes,
    garmentFamily: garmentFamily.family,
    productFit,
    fitPreference,
    category,
    mappingQuality: mapping.quality,
    measurementAnchor,
    hasChart: Boolean(chart),
    oneSizeProduct,
    ruleReason: ruleDecision.reason,
  });

  return {
    size: finalSize,
    alternativeSize,
    confidence,
    reason,
    availableSizes,
    sizeFormat,
    sizeDirection: direction,
    mappedFromEngine: engineSize,
  };
}

function collectSizeCandidates(value: unknown, candidates: unknown[], path: string[], depth: number) {
  if (depth > 5 || value == null) return;

  const sizeContext = path.some(part => isSizeKey(part));
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' || typeof item === 'number') {
        if (sizeContext) candidates.push(item);
        continue;
      }

      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (isUnavailableVariant(record)) continue;
        for (const key of ['size', 'label', 'value', 'name', 'displaySize', 'sizeLabel']) {
          if (key in record && (sizeContext || key.toLowerCase().includes('size'))) {
            candidates.push(record[key]);
          }
        }
        collectSizeCandidates(item, candidates, path, depth + 1);
      }
    }
    return;
  }

  if (typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (isSizeKey(key)) {
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        candidates.push(...Object.keys(child));
      } else {
        candidates.push(child);
      }
    }
    collectSizeCandidates(child, candidates, nextPath, depth + 1);
  }
}

function isSizeKey(key: string) {
  const normalized = compactKey(key);
  return EXPLICIT_SIZE_KEYS.has(normalized) || normalized.includes('size');
}

function isUnavailableVariant(record: Record<string, unknown>) {
  const availability = record.available ?? record.inStock ?? record.isAvailable ?? record.stock;
  if (availability === false) return true;
  if (typeof availability === 'string') {
    const normalized = availability.toLowerCase();
    return normalized.includes('out of stock') || normalized.includes('sold out') || normalized === 'false';
  }
  if (typeof availability === 'number') return availability <= 0;
  return false;
}

function normalizeSizeOptions(values: unknown[]): SizeOption[] {
  const byKey = new Map<string, SizeOption>();
  for (const value of values) {
    const option = typeof value === 'object' && value && 'label' in value
      ? normalizeSizeOption((value as SizeOption).label)
      : normalizeSizeOption(value);
    if (!option || byKey.has(option.key)) continue;
    byKey.set(option.key, option);
  }
  const options = [...byKey.values()];
  const regionalNumbers = new Set(
    options
      .filter(option => option.kind === 'regional' && option.numericValue !== undefined)
      .map(option => option.numericValue),
  );

  return options
    .filter(option => !(option.kind === 'numeric' && regionalNumbers.has(option.numericValue)))
    .sort(compareSizeOptions);
}

function normalizeSizeOption(raw: unknown): SizeOption | null {
  const cleaned = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^size\s+/i, '')
    .trim()
    .replace(/^[:\-|/]+|[:\-|/]+$/g, '');
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase().replace(/\./g, '');
  if (['ONE SIZE', 'ONESIZE', 'FREE SIZE', 'OSFA'].includes(upper)) {
    return { label: 'One Size', key: 'ONE_SIZE', kind: 'one-size' };
  }

  const regional = upper.match(/^(UK|US|EU)\s*[-:]?\s*(\d{1,3}(?:\.\d)?)$/);
  if (regional) {
    const label = `${regional[1]} ${regional[2]}`;
    return {
      label,
      key: label.replace(/\s+/g, '_'),
      kind: 'regional',
      prefix: regional[1],
      numericValue: Number(regional[2]),
    };
  }

  const compact = upper.replace(/\s+/g, '');
  if (compact in ALPHA_INDEX) {
    return {
      label: compact,
      key: compact,
      kind: 'alpha',
      alphaIndex: ALPHA_INDEX[compact],
    };
  }

  if (/^\d{1,3}(?:\.\d)?$/.test(upper)) {
    const value = Number(upper);
    if (Number.isFinite(value) && value >= 2 && value <= 62) {
      const label = upper.endsWith('.0') ? upper.slice(0, -2) : upper;
      return {
        label,
        key: `N_${label}`,
        kind: 'numeric',
        numericValue: value,
      };
    }
  }

  return null;
}

function compareSizeOptions(a: SizeOption, b: SizeOption) {
  const kindOrder: Record<SizeKind, number> = {
    alpha: 0,
    regional: 1,
    numeric: 2,
    'one-size': 3,
    unknown: 4,
  };
  if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
  return getOptionRank(a) - getOptionRank(b);
}

function detectSizeFormat(options: SizeOption[]) {
  if (!options.length) return '';
  const kinds = new Set(options.map(option => option.kind));
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.has('regional')) return 'regional';
  return 'mixed';
}

function detectProductFit(product: ProductLike) {
  const text = getProductSearchText(product);

  if (/\b(compression|tight fit|bodycon|skinny fit|muscle fit)\b/.test(text)) return 'compression';
  if (/\b(slim fit|tailored fit|skinny)\b/.test(text) || /\bslim\b/.test(text)) return 'slim';
  if (/\b(oversized|oversize)\b/.test(text)) return 'oversized';
  if (/\bboxy\b/.test(text)) return 'boxy';
  if (/\bbaggy\b/.test(text)) return 'baggy';
  if (/\b(relaxed fit|loose fit|roomy|relaxed)\b/.test(text) || ['loose', 'relaxed'].includes(String(product.fit_hint || '').toLowerCase())) return 'relaxed';
  if (/\b(regular fit|classic fit|standard fit)\b/.test(text)) return 'regular';
  return 'unknown';
}

function getProductSearchText(product: ProductLike) {
  return [
    product.fit_hint,
    product.title,
    product.subtitle,
    product.description,
    product.category,
    product.type,
    metadataToText(product.tags),
    metadataToText(product.metadata),
    metadataToText(product.product_metadata),
  ].map(value => String(value || '').toLowerCase()).join(' ');
}

function metadataToText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(metadataToText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(metadataToText)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function getProductFitStep(productFit: string) {
  if (['oversized', 'boxy', 'baggy'].includes(productFit)) return -1;
  if (productFit === 'relaxed') return 0;
  if (['slim', 'compression'].includes(productFit)) return 1;
  return 0;
}

function normalizeFitPreference(value: unknown): FitPreference {
  const fit = String(value || '').toLowerCase();
  if (fit === 'slim') return 'slim';
  if (fit === 'relaxed') return 'relaxed';
  if (fit === 'loose' || fit === 'baggy') return 'loose';
  return 'regular';
}

function getPreferenceStep(fitPreference: FitPreference) {
  if (fitPreference === 'slim') return -0.25;
  if (fitPreference === 'relaxed') return 0.25;
  if (fitPreference === 'loose' || fitPreference === 'baggy') return 0.5;
  return 0;
}

function detectGarmentFamily(product: ProductLike): { family: GarmentFamily; confidence: number } {
  const text = getProductSearchText(product);
  const titleText = String(product.title || '').toLowerCase();

  if (/\b(polo|polo shirt|collared tee)\b/.test(text)) return { family: 'POLO', confidence: 94 };
  if (/\b(t-shirt|tshirt|tee|graphic tee|crew neck tee|v-neck tee)\b/.test(text)) return { family: 'T_SHIRT', confidence: 94 };
  if (/\b(hoodie|hooded sweatshirt|hooded pullover|zip hoodie)\b/.test(text)) return { family: 'HOODIE', confidence: 94 };
  if (/\b(sweatshirt|sweat shirt|crewneck sweatshirt|fleece pullover)\b/.test(text)) return { family: 'SWEATSHIRT', confidence: 92 };
  if (/\b(blazer|sport coat|suit jacket)\b/.test(text)) return { family: 'BLAZER', confidence: 94 };
  if (/\b(overcoat|trench coat|pea coat|topcoat|winter coat)\b/.test(text) || /\bcoat\b/.test(titleText)) return { family: 'COAT', confidence: 92 };
  if (/\b(jacket|puffer|bomber|windbreaker|parka|shacket|outerwear)\b/.test(text)) return { family: 'JACKET', confidence: 90 };
  if (/\b(kurta|kurti|anarkali)\b/.test(text)) return { family: 'KURTA', confidence: 94 };
  if (/\b(dress|gown|midi dress|mini dress|maxi dress|bodycon dress|slip dress|shirt dress)\b/.test(text)) return { family: 'DRESS', confidence: 92 };
  if (/\b(jeans|denim jeans|skinny jeans|straight jeans|bootcut jeans)\b/.test(text)) return { family: 'JEANS', confidence: 94 };
  if (/\b(shorts|bermuda|cargo shorts|denim shorts)\b/.test(text)) return { family: 'SHORTS', confidence: 94 };
  if (/\b(leggings|tights|yoga pants|active tights)\b/.test(text)) return { family: 'LEGGINGS', confidence: 90 };
  if (/\b(skirt|mini skirt|midi skirt|maxi skirt|pencil skirt)\b/.test(text)) return { family: 'SKIRT', confidence: 94 };
  if (/\b(trousers|pants|chinos|slacks|cargo pants|joggers|track pants)\b/.test(text)) return { family: 'TROUSERS', confidence: 88 };
  if (/\b(shirt|formal shirt|casual shirt|button down|button-down|button up|button-up|oxford)\b/.test(text)) return { family: 'SHIRT', confidence: 88 };

  return { family: 'UNKNOWN', confidence: 0 };
}

function detectJacketSubtype(product: ProductLike): JacketSubtype {
  const text = getProductSearchText(product);
  if (/\b(windbreaker|harrington|moto|biker|denim jacket|shacket|cropped jacket|utility jacket|lightweight jacket)\b/.test(text)) {
    return 'LIGHT_JACKET';
  }
  if (/\b(puffer|parka|winter|insulated|down|cold weather|heavy outerwear)\b/.test(text)) {
    return 'HEAVY_JACKET';
  }
  return 'LIGHT_JACKET';
}

function detectProductCategory(product: ProductLike) {
  const family = detectGarmentFamily(product).family;
  if (['JEANS', 'TROUSERS', 'SHORTS', 'SKIRT', 'LEGGINGS'].includes(family)) return 'bottom';
  if (family !== 'UNKNOWN') return 'top';
  return 'unknown';
}

function getMeasurementAnchor(profile: ProfileLike, category: string) {
  const measurements = profile.measurements || {};
  if (category === 'bottom') {
    const waist = numberFrom(measurements.waist);
    return waist ? { name: 'waist', cm: waist, inches: waist / 2.54 } : null;
  }

  const chest = numberFrom(measurements.chest ?? measurements.bust);
  if (chest) return { name: 'chest', cm: chest, inches: chest / 2.54 };
  return null;
}

function mapToAvailableSize({
  availableOptions,
  engineOption,
  engineSize,
  baseSize,
  chart,
  measurementAnchor,
  category,
  totalBias,
  fitPreference,
  productFit,
}: {
  availableOptions: SizeOption[];
  engineOption: SizeOption | null;
  engineSize: string;
  baseSize?: string;
  chart?: Record<string, number>;
  measurementAnchor: { name: string; cm: number; inches: number } | null;
  category: string;
  totalBias: number;
  fitPreference: FitPreference;
  productFit: string;
}) {
  if (!availableOptions.length) {
    return {
      size: engineSize,
      quality: 'no-availability',
      engineRank: engineOption ? getOptionRank(engineOption) : undefined,
      finalRank: engineOption ? getOptionRank(engineOption) : undefined,
    };
  }

  if (availableOptions.length === 1) {
    const only = availableOptions[0];
    return {
      size: only.label,
      quality: optionMatches(only, engineOption) ? 'exact' : 'single-available',
      engineRank: engineOption ? getOptionRank(engineOption) : undefined,
      finalRank: getOptionRank(only),
    };
  }

  const chartPick = chart && measurementAnchor ? pickChartSize(chart, measurementAnchor.cm) : undefined;
  const chartOption = normalizeSizeOption(chartPick);
  const alphaOptions = availableOptions.filter(option => option.kind === 'alpha' && option.alphaIndex !== undefined);
  if (chartOption?.kind === 'alpha' && chartOption.alphaIndex !== undefined && alphaOptions.length) {
    const chosen = chooseByRank(alphaOptions, chartOption.alphaIndex + totalBias, totalBias, 'alpha');
    return {
      size: chosen.label,
      quality: optionMatches(chosen, chartOption) ? 'chart' : 'nearest',
      engineRank: engineOption ? getOptionRank(engineOption) : undefined,
      finalRank: getOptionRank(chosen),
    };
  }

  const numericOptions = availableOptions.filter(option => ['numeric', 'regional'].includes(option.kind) && option.numericValue !== undefined);
  if (chartOption && ['numeric', 'regional'].includes(chartOption.kind) && chartOption.numericValue !== undefined && numericOptions.length) {
    const numericBias = getNumericTieBias(fitPreference, productFit);
    const chosen = chooseByRank(numericOptions, chartOption.numericValue + totalBias, numericBias || totalBias, 'numeric');
    return {
      size: chosen.label,
      quality: optionMatches(chosen, chartOption) ? 'chart' : 'nearest',
      engineRank: engineOption ? getOptionRank(engineOption) : undefined,
      finalRank: getOptionRank(chosen),
    };
  }

  const exact = availableOptions.find(option => optionMatches(option, engineOption));
  const hasProductAdjustment = Math.abs(totalBias) >= 0.75 || Math.abs(getProductFitStep(productFit)) >= 0.75;
  if (exact && !hasProductAdjustment) {
    return {
      size: exact.label,
      quality: 'exact',
      engineRank: engineOption ? getOptionRank(engineOption) : undefined,
      finalRank: getOptionRank(exact),
    };
  }

  const alphaTarget = getAlphaTarget(engineOption, baseSize, chart, measurementAnchor);
  if (alphaTarget !== undefined && alphaOptions.length) {
    const chosen = chooseByRank(alphaOptions, alphaTarget + totalBias, totalBias, 'alpha');
    return {
      size: chosen.label,
      quality: exact ? 'fit-adjusted' : 'nearest',
      engineRank: engineOption?.kind === 'alpha' ? getOptionRank(engineOption) : alphaTarget,
      finalRank: getOptionRank(chosen),
    };
  }

  const numericTarget = getNumericTarget(engineOption, chart, measurementAnchor, category);
  if (numericTarget !== undefined && numericOptions.length) {
    const numericBias = getNumericTieBias(fitPreference, productFit);
    const chosen = chooseByRank(numericOptions, numericTarget + totalBias, numericBias || totalBias, 'numeric');
    return {
      size: chosen.label,
      quality: optionMatches(chosen, engineOption) ? 'exact' : 'nearest',
      engineRank: engineOption && ['numeric', 'regional'].includes(engineOption.kind) ? getOptionRank(engineOption) : numericTarget,
      finalRank: getOptionRank(chosen),
    };
  }

  const fallback = exact || availableOptions[0];
  return {
    size: fallback.label,
    quality: exact ? 'exact' : 'fallback-available',
    engineRank: engineOption ? getOptionRank(engineOption) : undefined,
    finalRank: getOptionRank(fallback),
  };
}

function optionMatches(option: SizeOption, other: SizeOption | null) {
  return Boolean(other && option.key === other.key);
}

function getAlphaTarget(
  engineOption: SizeOption | null,
  baseSize?: string,
  chart?: Record<string, number>,
  measurementAnchor?: { cm: number } | null,
) {
  if (engineOption?.kind === 'alpha' && engineOption.alphaIndex !== undefined) return engineOption.alphaIndex;

  const baseOption = normalizeSizeOption(baseSize);
  if (baseOption?.kind === 'alpha' && baseOption.alphaIndex !== undefined) return baseOption.alphaIndex;

  if (chart && measurementAnchor) {
    const chartPick = pickChartSize(chart, measurementAnchor.cm);
    const chartOption = normalizeSizeOption(chartPick);
    if (chartOption?.kind === 'alpha' && chartOption.alphaIndex !== undefined) return chartOption.alphaIndex;
  }

  return undefined;
}

function getNumericTarget(
  engineOption: SizeOption | null,
  chart: Record<string, number> | undefined,
  measurementAnchor: { cm: number; inches: number } | null,
  category: string,
) {
  if (engineOption && ['numeric', 'regional'].includes(engineOption.kind) && engineOption.numericValue !== undefined) {
    return engineOption.numericValue;
  }

  if (chart && measurementAnchor) {
    const chartPick = pickChartSize(chart, measurementAnchor.cm);
    const chartOption = normalizeSizeOption(chartPick);
    if (chartOption && ['numeric', 'regional'].includes(chartOption.kind) && chartOption.numericValue !== undefined) {
      return chartOption.numericValue;
    }
  }

  if (category === 'bottom' && measurementAnchor) {
    return measurementAnchor.inches;
  }

  return undefined;
}

function pickChartSize(chart: Record<string, number>, measurementCm: number) {
  const entries = Object.entries(chart)
    .map(([label, value]) => ({ label, value: numberFrom(value) }))
    .filter((entry): entry is { label: string; value: number } => Boolean(entry.value))
    .sort((a, b) => a.value - b.value);
  const matched = entries.find(entry => measurementCm <= entry.value + 1);
  return (matched || entries[entries.length - 1])?.label;
}

function chooseByRank(options: SizeOption[], targetRank: number, bias: number, mode: 'alpha' | 'numeric') {
  const ranked = [...options].sort((a, b) => {
    const diff = Math.abs(getOptionRank(a) - targetRank) - Math.abs(getOptionRank(b) - targetRank);
    if (Math.abs(diff) > 0.001) return diff;
    if (bias > 0) return getOptionRank(b) - getOptionRank(a);
    if (bias < 0) return getOptionRank(a) - getOptionRank(b);
    return getOptionRank(a) - getOptionRank(b);
  });

  if (mode === 'numeric' && ranked.length > 1) {
    return ranked[0];
  }
  return ranked[0];
}

function getNumericTieBias(fitPreference: FitPreference, productFit: string) {
  let bias = 0;
  if (fitPreference === 'slim') bias -= 1;
  if (fitPreference === 'relaxed' || fitPreference === 'loose') bias += 1;
  if (['slim', 'compression'].includes(productFit)) bias += 1;
  if (['oversized', 'boxy', 'baggy'].includes(productFit)) bias -= 0.5;
  return bias;
}

function getOptionRank(option: SizeOption) {
  if (option.kind === 'alpha') return option.alphaIndex ?? 0;
  if (option.kind === 'numeric' || option.kind === 'regional') return option.numericValue ?? 0;
  return 0;
}

function resolveRuleConflict({
  family,
  productFit,
}: {
  family: GarmentFamily;
  productFit: string;
}) {
  if (['JACKET', 'COAT'].includes(family) && ['oversized', 'boxy'].includes(productFit)) {
    const article = productFit === 'oversized' ? 'an' : 'a';
    return {
      preserveBackend: true,
      reason: `${family === 'JACKET' ? 'this jacket' : 'this coat'} already has ${article} ${productFit} cut, so the backend size is preserved`,
    };
  }

  if (['SHIRT', 'POLO'].includes(family) && productFit === 'oversized') {
    return {
      preserveBackend: true,
      reason: `${family === 'SHIRT' ? 'this shirt' : 'this polo'} is oversized, so the backend size is preferred before sizing down`,
    };
  }

  return {
    preserveBackend: false,
    reason: '',
  };
}

function getGarmentFamilyRule({
  family,
  product,
  productFit,
  fitPreference,
  engineHandledProductFit,
  oneSizeProduct,
  conflictResolution,
}: {
  family: GarmentFamily;
  product: ProductLike;
  productFit: string;
  fitPreference: FitPreference;
  engineHandledProductFit: boolean;
  oneSizeProduct: boolean;
  conflictResolution: { preserveBackend: boolean; reason: string };
}) {
  if (oneSizeProduct) {
    return {
      totalBias: 0,
      mappingProductFit: 'unknown',
      reason: 'this is a one-size product',
    };
  }
  if (conflictResolution.preserveBackend) {
    return {
      totalBias: 0,
      mappingProductFit: 'regular',
      reason: conflictResolution.reason,
    };
  }

  const productStep = engineHandledProductFit ? 0 : getProductFitStep(productFit);
  const preferenceStep = getPreferenceStep(fitPreference);
  const text = getProductSearchText(product);
  const isSlimProduct = ['slim', 'compression'].includes(productFit);
  const isRoomyProduct = ['oversized', 'boxy', 'baggy'].includes(productFit);
  const wantsRoom = fitPreference === 'relaxed' || fitPreference === 'loose' || fitPreference === 'baggy';
  const isFormal = /\b(formal|dress shirt|business|office)\b/.test(text);

  if (family === 'T_SHIRT') {
    if (isRoomyProduct) {
      return {
        totalBias: Math.min(preferenceStep, 0),
        mappingProductFit: 'regular',
        reason: 'oversized tees already include extra room',
      };
    }
    if (isSlimProduct && wantsRoom) {
      return {
        totalBias: 1,
        mappingProductFit: productFit,
        reason: `this slim-fit tee runs closer through the chest and you prefer a ${fitPreference} fit`,
      };
    }
  }

  if (family === 'SHIRT') {
    if ((isSlimProduct || isFormal) && fitPreference !== 'slim') {
      return {
        totalBias: 1,
        mappingProductFit: productFit,
        reason: isSlimProduct
          ? `this slim-fit shirt runs closer through the chest and you prefer a ${fitPreference} fit`
          : 'formal shirts need comfortable chest and shoulder room',
      };
    }
  }

  if (family === 'POLO') {
    if (isSlimProduct && wantsRoom) {
      return {
        totalBias: 0.75,
        mappingProductFit: productFit,
        reason: `this slim-fit polo runs close, so a little extra room suits your ${fitPreference} preference`,
      };
    }
  }

  if (family === 'HOODIE' || family === 'SWEATSHIRT') {
    if (isRoomyProduct) {
      return {
        totalBias: Math.max(0, preferenceStep),
        mappingProductFit: 'regular',
        reason: `${family === 'HOODIE' ? 'hoodies' : 'sweatshirts'} already have casual ease, so the fit avoids an aggressive size-down`,
      };
    }
    if (isSlimProduct && fitPreference !== 'slim') {
      return {
        totalBias: 1,
        mappingProductFit: productFit,
        reason: `${family === 'HOODIE' ? 'this slim hoodie' : 'this slim sweatshirt'} runs closer through the body and should leave layering room`,
      };
    }
    if (fitPreference !== 'slim') {
      return {
        totalBias: 0.5,
        mappingProductFit: productFit,
        reason: `${family === 'HOODIE' ? 'hoodies' : 'sweatshirts'} are typically worn with a little layering room`,
      };
    }
  }

  if (family === 'JACKET') {
    const jacketSubtype = detectJacketSubtype(product);
    if (jacketSubtype === 'HEAVY_JACKET') {
      return {
        totalBias: fitPreference === 'slim' ? 0 : 1,
        mappingProductFit: 'regular',
        reason: 'heavy jackets are typically worn with layers',
      };
    }
    if (isSlimProduct && fitPreference !== 'slim') {
      return {
        totalBias: 1,
        mappingProductFit: productFit,
        reason: 'this slim light jacket runs closer through the body and should leave a little room',
      };
    }
    if (wantsRoom) {
      return {
        totalBias: 0.75,
        mappingProductFit: 'regular',
        reason: `this light jacket keeps the backend fit but adds room for your ${fitPreference} preference`,
      };
    }
    return {
      totalBias: 0,
      mappingProductFit: 'regular',
      reason: 'light jackets usually fit closest to the backend size',
    };
  }

  if (family === 'BLAZER') {
    if (isSlimProduct && fitPreference !== 'slim') {
      return {
        totalBias: 0.5,
        mappingProductFit: productFit,
        reason: 'this structured blazer should stay tailored while leaving chest and shoulder room',
      };
    }
    return {
      totalBias: 0,
      mappingProductFit: 'regular',
      reason: 'blazers need a structured fit without unnecessary oversizing',
    };
  }

  if (family === 'COAT') {
    return {
      totalBias: fitPreference === 'slim' ? 0.5 : 1,
      mappingProductFit: 'regular',
      reason: 'coats need room for layering',
    };
  }

  if (family === 'KURTA') {
    return {
      totalBias: isSlimProduct || wantsRoom ? 0.5 : Math.max(0, preferenceStep),
      mappingProductFit: 'regular',
      reason: 'kurtas are more comfortable when the fit is not reduced unnecessarily',
    };
  }

  if (family === 'DRESS') {
    return {
      totalBias: 0,
      mappingProductFit: 'regular',
      reason: '',
    };
  }

  return {
    totalBias: productStep + preferenceStep,
    mappingProductFit: engineHandledProductFit ? 'unknown' : productFit,
    reason: '',
  };
}

function normalizeEngineConfidence(confidence: unknown) {
  const value = numberFrom(confidence) ?? 70;
  return value <= 1 ? value * 100 : value;
}

function calculateConfidence({
  baseConfidence,
  product,
  profile,
  availableOptions,
  chart,
  garmentFamily,
  productFit,
  mappingQuality,
  sizeFormat,
  engineSize,
  finalSize,
  oneSizeProduct,
}: {
  baseConfidence: number;
  product: ProductLike;
  profile: ProfileLike;
  availableOptions: SizeOption[];
  chart?: Record<string, number>;
  garmentFamily: GarmentFamily;
  productFit: string;
  mappingQuality: string;
  sizeFormat: string;
  engineSize: string;
  finalSize: string;
  oneSizeProduct: boolean;
}) {
  let score = Math.min(baseConfidence, 92);
  score += garmentFamily === 'UNKNOWN' ? -6 : 3;
  score += productFit === 'unknown' ? -2 : 2;

  const chartSizeCount = chart ? Object.keys(chart).length : 0;
  if (chartSizeCount >= 3) score += 6;
  else if (chartSizeCount > 0) score += 2;
  else score -= 4;

  const measurements = profile.measurements || {};
  const hasChest = Boolean(numberFrom(measurements.chest ?? measurements.bust));
  const hasWaist = Boolean(numberFrom(measurements.waist));
  const hasShoulders = Boolean(numberFrom(measurements.shoulders));
  if (hasChest && hasWaist && hasShoulders) score += 6;
  else if (hasChest && hasWaist) score += 3;
  else score -= 12;

  if (oneSizeProduct) score -= 18;
  else if (!availableOptions.length) score -= 12;
  else if (mappingQuality === 'chart') score += 6;
  else if (mappingQuality === 'exact') score += 5;
  else if (mappingQuality === 'fit-adjusted') score -= 3;
  else if (mappingQuality === 'nearest') score -= 5;
  else if (mappingQuality === 'single-available') score -= 12;
  else if (mappingQuality === 'no-availability') score -= 12;

  const adjustmentSteps = getSizeAdjustmentSteps(engineSize, finalSize);
  if (oneSizeProduct) score -= 6;
  else if (adjustmentSteps === 0) score += 4;
  else if (adjustmentSteps <= 1) score -= 5;
  else score -= 12;

  if (['slim', 'compression'].includes(productFit) && adjustmentSteps === 0) {
    score -= garmentFamily === 'DRESS' ? 10 : 5;
  }

  const extractionConfidence = numberFrom(product.confidence);
  if (extractionConfidence !== undefined) {
    const normalized = extractionConfidence <= 1 ? extractionConfidence : extractionConfidence / 100;
    score += (Math.max(0, Math.min(1, normalized)) * 4) - 2;
  }

  if (['regional', 'mixed'].includes(sizeFormat)) score -= 3;
  if (sizeFormat === 'numeric' && !chart) score -= 2;

  let maxScore = chartSizeCount >= 3 ? 98 : 92;
  if (oneSizeProduct) maxScore = Math.min(maxScore, 72);
  if (!availableOptions.length) maxScore = Math.min(maxScore, 70);
  if (!hasChest || !hasWaist) maxScore = Math.min(maxScore, 65);
  if (garmentFamily === 'UNKNOWN') maxScore = Math.min(maxScore, 82);
  if (['slim', 'compression'].includes(productFit) && adjustmentSteps === 0) {
    maxScore = Math.min(maxScore, garmentFamily === 'DRESS' ? 78 : 84);
  }

  return Math.max(50, Math.min(maxScore, Math.round(score)));
}

function getSizeAdjustmentSteps(engineSize: string, finalSize: string) {
  const engineOption = normalizeSizeOption(engineSize);
  const finalOption = normalizeSizeOption(finalSize);
  if (!engineOption || !finalOption) return 0;
  if (engineOption.kind !== finalOption.kind) return finalOption.kind === 'one-size' ? 2 : 1;
  return Math.abs(getOptionRank(finalOption) - getOptionRank(engineOption));
}

function getSizeDirection(engineRank?: number, finalRank?: number): 'size-down' | 'true-to-size' | 'size-up' {
  if (engineRank === undefined || finalRank === undefined) return 'true-to-size';
  if (finalRank > engineRank + 0.1) return 'size-up';
  if (finalRank < engineRank - 0.1) return 'size-down';
  return 'true-to-size';
}

function buildRecommendationReason({
  finalSize,
  engineSize,
  availableSizes,
  garmentFamily,
  productFit,
  fitPreference,
  category,
  mappingQuality,
  measurementAnchor,
  hasChart,
  oneSizeProduct,
  ruleReason,
}: {
  finalSize: string;
  engineSize: string;
  availableSizes: string[];
  garmentFamily: GarmentFamily;
  productFit: string;
  fitPreference: FitPreference;
  category: string;
  mappingQuality: string;
  measurementAnchor: { name: string; inches: number } | null;
  hasChart: boolean;
  oneSizeProduct: boolean;
  ruleReason?: string;
}) {
  const availabilityText = availableSizes.length
    ? ` among the available sizes (${availableSizes.slice(0, 6).join(', ')}${availableSizes.length > 6 ? ', ...' : ''})`
    : '';

  if (oneSizeProduct) {
    return `${finalSize} is recommended because this product is listed as one size.`;
  }
  if (mappingQuality === 'single-available') {
    return `${finalSize} is the only available size for this product.`;
  }
  if (ruleReason) {
    return `Recommended ${finalSize} because ${ruleReason}${availabilityText}.`;
  }
  if (category === 'bottom' && measurementAnchor && ['numeric', 'regional'].includes(normalizeSizeOption(finalSize)?.kind || '')) {
    const comfort = fitPreference === 'slim' ? 'closer waist fit' : fitPreference === 'regular' ? 'balanced waist comfort' : 'extra waist comfort';
    return `${finalSize} recommended for ${comfort}${availabilityText}.`;
  }
  if (hasChart && ['chart', 'nearest'].includes(mappingQuality)) {
    return `${finalSize} is based on the product size chart and your saved fit profile.`;
  }

  if (productFit === 'oversized') {
    return `Recommended because this oversized fit already includes extra chest room${availabilityText}.`;
  }
  if (productFit === 'boxy') {
    return `Recommended because the boxy silhouette already adds room through the body${availabilityText}.`;
  }
  if (productFit === 'baggy') {
    return `Recommended because the baggy silhouette is designed with extra ease${availabilityText}.`;
  }
  if (productFit === 'relaxed') {
    return `Recommended because the relaxed fit gives more room than a regular cut${availabilityText}.`;
  }
  if (productFit === 'slim') {
    return `This slim-fit silhouette is tighter through the chest and shoulders, so ${finalSize} is the best available match.`;
  }
  if (productFit === 'compression') {
    return `This compression fit is intentionally close to the body, so ${finalSize} is mapped carefully from your measurements.`;
  }
  if (mappingQuality === 'nearest' && engineSize && finalSize !== engineSize) {
    return `${engineSize} was the profile match, and ${finalSize} is the nearest available product size.`;
  }
  if (hasChart) {
    return `${finalSize} is based on the product size chart and your saved fit profile.`;
  }
  if (!availableSizes.length) {
    return `${finalSize} is based on your saved fit profile; this page did not expose selectable size availability.`;
  }
  return `${finalSize} is the best match for this ${garmentFamily.toLowerCase().replace(/_/g, ' ')} from the product's available sizes and your saved fit profile.`;
}
