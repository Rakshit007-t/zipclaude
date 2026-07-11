// ponytail: stubs — brand size-chart/availability APIs not wired yet; return null so callers fall back to the size engine.
export const fetchSizeChart = async (_brand: string, _category: string) => {
  return null;
};

export const fetchProductAvailability = async (_brand: string, _title: string) => {
  return null;
};
