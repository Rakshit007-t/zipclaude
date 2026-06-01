const BRAND_SIZE_ADJUSTMENT = {
  "H&M": -1, // runs large -> size down
  Zara: 0, // true to size
  Roadster: 0,
  JackAndJones: -1,
  Nike: 0,
  Puma: 0,
  Default: 0,
};

const SIZE_SCALE = ["XS", "S", "M", "L", "XL", "XXL"];

const NORMALIZED_BRAND_ADJUSTMENTS = {
  hm: BRAND_SIZE_ADJUSTMENT["H&M"],
  zara: BRAND_SIZE_ADJUSTMENT.Zara,
  roadster: BRAND_SIZE_ADJUSTMENT.Roadster,
  jackandjones: BRAND_SIZE_ADJUSTMENT.JackAndJones,
  nike: BRAND_SIZE_ADJUSTMENT.Nike,
  puma: BRAND_SIZE_ADJUSTMENT.Puma,
};

function adjustSize(baseSize, adjustment) {
  const index = SIZE_SCALE.indexOf(baseSize);
  if (index === -1) return baseSize;

  let newIndex = index + adjustment;

  if (newIndex < 0) newIndex = 0;
  if (newIndex >= SIZE_SCALE.length) newIndex = SIZE_SCALE.length - 1;

  return SIZE_SCALE[newIndex];
}

function getBrandAdjustment(brand) {
  if (!brand) return BRAND_SIZE_ADJUSTMENT.Default;
  if (BRAND_SIZE_ADJUSTMENT[brand] !== undefined) return BRAND_SIZE_ADJUSTMENT[brand];

  const normalizedBrand = String(brand)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return NORMALIZED_BRAND_ADJUSTMENTS[normalizedBrand] ?? BRAND_SIZE_ADJUSTMENT.Default;
}

function detectProductNature(product) {
  const text = `${String(product?.title || "")} ${String(product?.category || "")}`.toLowerCase();
  const oversizedKeywords = ["oversized", "loose", "relaxed fit", "drop shoulder", "boxy fit"];
  const slimKeywords = ["slim fit", "tailored", "fitted", "skinny fit"];

  if (oversizedKeywords.some((keyword) => text.includes(keyword))) return "oversized";
  if (slimKeywords.some((keyword) => text.includes(keyword))) return "slim";
  return "normal";
}

function normalizeCategory(product) {
  const text = `${String(product?.category || "")} ${String(product?.title || "")}`.toLowerCase();

  if (text.includes("jacket") || text.includes("coat")) return "jacket";
  if (text.includes("t-shirt") || text.includes("tshirt") || text.includes("tee")) return "tshirt";
  if (text.includes("shirt")) return "shirt";
  return "tshirt";
}

function getFitPreferenceAdjustment(fit, productNature) {
  if (productNature === "oversized") return 0;

  if (fit === "loose" || fit === "relaxed") return 1;
  if (fit === "slim") return -1;
  return 0;
}

function applyCategoryAdjustmentPolicy(adjustment, normalizedCategory) {
  if (normalizedCategory === "shirt") {
    return Math.max(-1, Math.min(1, adjustment));
  }
  return adjustment;
}

export function getRecommendedSize(product, userProfile) {
  if (!product) return null;

  const productNature = detectProductNature(product);
  const normalizedCategory = normalizeCategory(product);
  const baseSize = userProfile?.tshirt || "M";
  const brandAdjustment = getBrandAdjustment(product.brand);
  const fitPreference = String(userProfile?.fitPreference || "").toLowerCase();
  const fitPreferenceAdjustment = getFitPreferenceAdjustment(fitPreference, productNature);
  const totalAdjustment = brandAdjustment + fitPreferenceAdjustment;
  const categoryAdjustedTotal = applyCategoryAdjustmentPolicy(totalAdjustment, normalizedCategory);
  const finalSize = adjustSize(baseSize, categoryAdjustedTotal);
  const reason = productNature === "oversized"
    ? "Product is already oversized, no size increase applied"
    : "Adjusted for fit preference and brand sizing";

  return {
    size: finalSize,
    confidence: product.brand ? "High" : "Medium",
    reason,
  };
}
