/**
 * ZipRIGHT — Internal Demo Mode & Fixture Utilities
 *
 * Provides optional internal testing fixtures for local development.
 * PRODUCTION BUILDS ALWAYS FORCE DEMO MODE OFF.
 */

import { demoProducts, type DemoProduct } from './demoProducts';

export function isDemoMode(): boolean {
  // CRITICAL: Production builds ALWAYS force demo mode OFF.
  // Even if a localStorage key or URL parameter attempts to enable demo mode, production ignores it.
  if (import.meta.env.PROD || import.meta.env.MODE === 'production') {
    return false;
  }
  // Internal development gate: only enable if explicitly enabled via environment variable
  if (import.meta.env.VITE_INTERNAL_DEMO_MODE !== 'true') {
    return false;
  }
  if (typeof window === 'undefined') return false;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === 'true' || urlParams.get('demo') === '1') {
      localStorage.setItem('zipright_demo_mode', 'true');
      return true;
    }
    if (urlParams.get('demo') === 'false' || urlParams.get('demo') === '0') {
      localStorage.removeItem('zipright_demo_mode');
      return false;
    }
    const stored = localStorage.getItem('zipright_demo_mode');
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // ignore local storage restrictions
  }
  return false;
}

/**
 * Curated 4-garment showcase set matching Section 6:
 * 1. Roadster Checked Casual Shirt (Validated live stream)
 * 2. Mango People Cotton Straight Kurta (Validated live swap)
 * 3. Solid Polo T-Shirt (Visually distinct casual top)
 * 4. Classic Denim Jacket (Distinct structured layer)
 */
export const CURATED_DEMO_GARMENTS: DemoProduct[] = [
  demoProducts.find((p) => p.id === 'demo-roadster-shirt') || demoProducts[0],
  demoProducts.find((p) => p.id === 'demo-mango-kurta') || demoProducts[2],
  demoProducts.find((p) => p.id === 'demo-polo-tee') || demoProducts[3],
  demoProducts.find((p) => p.id === 'demo-women-denim-jacket') || demoProducts[4],
  demoProducts.find((p) => p.id === 'demo-casual-red-shirt') || demoProducts[1],
];

/**
 * Physically consistent, realistic demo profile data.
 * Produces real size recommendations with high confidence without mock math.
 */
export const DEMO_PRESET_PROFILE = {
  profileName: 'Alex',
  gender: 'Male',
  brand: 'Roadster',
  topSize: 'M',
  heightUnit: 'ft' as const,
  heightFt: '5',
  heightIn: '10',
  heightCm: '178',
  weight: '72',
  waistSize: '32',
  chestSize: '38',
  bustSize: '',
  hipsSize: '38',
  braCup: '',
  bodyShape: 'average',
  fitPreference: 2, // regular
};
