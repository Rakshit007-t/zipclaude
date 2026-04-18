export const fetchSizeChart = async (brand: string, category: string) => {
  console.log(`Fetching size chart for ${brand} in ${category}`);
  // Mock size chart data
  return {
    'S': { chest: '36-38', waist: '30-32' },
    'M': { chest: '38-40', waist: '32-34' },
    'L': { chest: '40-42', waist: '34-36' },
    'XL': { chest: '42-44', waist: '36-38' }
  };
};

export const fetchProductAvailability = async (brand: string, title: string) => {
  console.log(`Fetching availability for ${title} by ${brand}`);
  // Mock availability data
  return {
    inStock: true,
    sizes: ['S', 'M', 'L', 'XL']
  };
};
