/**
 * ZipRIGHT Dynamic SEO Engine & Meta Tag Registry
 * Ensures institutional-grade search indexing, social graph rendering, and canonical resolution.
 */

export interface PageMetadata {
  title: string;
  description: string;
  noindex?: boolean;
  ogType?: 'website' | 'article' | 'product';
}

const CANONICAL_ORIGIN = (import.meta.env.VITE_CANONICAL_DOMAIN || 'https://zipright.ai').replace(/\/+$/, '');

export const ROUTE_METADATA: Record<string, PageMetadata> = {
  '/': {
    title: 'ZipRIGHT — AI Virtual Try-On & Sizing Atelier',
    description: 'AI fashion-tech atelier providing neural virtual try-on on your own photo, 3D body measurements, and cross-brand size recommendations.',
    ogType: 'website',
  },
  '/welcome': {
    title: 'Welcome | ZipRIGHT — The Fit Atelier',
    description: 'Experience fashion where fit is guaranteed. Discover your digital twin, 3D body sizing, and personal AI styling.',
    ogType: 'website',
  },
  '/login': {
    title: 'Sign In | ZipRIGHT — Member Access',
    description: 'Access your private wardrobe, saved fit profiles, biometric calibrations, and personalized fashion drops on ZipRIGHT.',
    ogType: 'website',
  },
  '/home': {
    title: 'Atelier Home | ZipRIGHT — Curated Fashion & True Fit',
    description: 'Explore your daily style edit, curated apparel drops, and instant cross-brand sizing calculations.',
    ogType: 'website',
  },
  '/marketplace': {
    title: 'Marketplace | ZipRIGHT — Multi-Brand Fit Verified Collection',
    description: 'Shop curated garments across top retailers with verified size recommendations calculated against your exact body measurements.',
    ogType: 'website',
  },
  '/fashion-studio': {
    title: 'Virtual Try-On Studio | ZipRIGHT — Neural Fitting Room',
    description: 'Upload your photo and preview any garment with realistic fabric drape, lighting, and proportion accuracy before buying.',
    ogType: 'website',
  },
  '/live-tryon': {
    title: 'Live AR Try-On | ZipRIGHT — Real-Time Camera Fitting',
    description: 'Real-time augmented reality garment visualization powered by client-side landmark tracking.',
    ogType: 'website',
  },
  '/tryon-studio': {
    title: 'Studio Workspace | ZipRIGHT — AI Fitting Suite',
    description: 'Generate, fine-tune, and inspect high-fidelity photorealistic clothing try-on renders.',
    ogType: 'website',
  },
  '/ai-studio': {
    title: 'AI Styling Atelier | ZipRIGHT — Wardrobe Intelligence',
    description: 'Collaborate with your AI stylist to construct coordinated outfits tailored to your body type and aesthetic.',
    ogType: 'website',
  },
  '/fit-profile': {
    title: 'Your Fit Profile | ZipRIGHT — Biometric Measurements',
    description: 'View and calibrate your private 3D body measurements, proportions, and brand size mappings.',
    noindex: true,
  },
  '/smart-fit-scan': {
    title: 'Smart Fit Scan | ZipRIGHT — 3D Body Measurement',
    description: 'Privacy-first edge body landmark detection calculating precise chest, waist, and hip dimensions in seconds.',
    noindex: true,
  },
  '/cart': {
    title: 'Cart & Bag | ZipRIGHT — Checkout Selection',
    description: 'Review your selected garments, sizing confidence ratings, and direct retailer order links.',
    noindex: true,
  },
  '/wishlist': {
    title: 'Saved Pieces | ZipRIGHT — Wardrobe Wishlist',
    description: 'Your saved styles, favourite silhouettes, and monitored brand price drops.',
    noindex: true,
  },
  '/friends': {
    title: 'Social Hub | ZipRIGHT — Style Network',
    description: 'Connect with friends, exchange lookbooks, and gift outfits with guaranteed size accuracy.',
    noindex: true,
  },
  '/community': {
    title: 'Community Feed | ZipRIGHT — Style Collective',
    description: 'Browse authentic community outfit inspirations and community fit ratings.',
    ogType: 'website',
  },
  '/about-us': {
    title: 'About Us | ZipRIGHT — The Fit Atelier Story',
    description: 'Learn why ZipRIGHT exists: to eliminate sizing guesswork through neural try-on and ethical, privacy-preserving AI.',
    ogType: 'article',
  },
  '/faqs': {
    title: 'Frequently Asked Questions | ZipRIGHT — Help Center',
    description: 'Find answers about AI virtual try-on, sizing accuracy, biometric privacy standards, returns, and ordering.',
    ogType: 'article',
  },
  '/privacy-policy': {
    title: 'Privacy Policy | ZipRIGHT — Biometric & Data Protection',
    description: 'Our comprehensive privacy policy compliant with the DPDP Act 2023, GDPR, CCPA, and Illinois BIPA. Zero selling of biometric data.',
    ogType: 'article',
  },
  '/terms-of-use': {
    title: 'Terms of Use | ZipRIGHT — Intermediary Agreement',
    description: 'Statutory terms of use, intermediary safe harbor guidelines, FTC affiliate disclosures, and sizing disclaimers.',
    ogType: 'article',
  },
  '/cookie-policy': {
    title: 'Cookie Policy | ZipRIGHT — Transparency & Informed Consent',
    description: 'Detailed inventory of strictly necessary and opt-in storage items with in-app preference management.',
    ogType: 'article',
  },
  '/refund-policy': {
    title: 'Refund & Return Policy | ZipRIGHT — Consumer Guarantees',
    description: 'Clear rules on digital subscription cancellations, intermediary retailer returns, and payment timelines.',
    ogType: 'article',
  },
  '/privacy-center': {
    title: 'Privacy Center | ZipRIGHT — Data Rights Management',
    description: 'Exercise your rights to data access, correction, portable export, and account purging.',
    ogType: 'article',
  },
  '/404': {
    title: 'Piece Not Found (404) | ZipRIGHT',
    description: 'The requested page or garment silhouette does not exist in the atelier. Return to the home feed or marketplace.',
    noindex: true,
  },
};

/**
 * Normalizes a React Router pathname and returns the best matching PageMetadata.
 */
export function getRouteMetadata(pathname: string): PageMetadata {
  // Strip trailing slashes
  const cleanPath = pathname.replace(/\/+$/, '') || '/';

  if (ROUTE_METADATA[cleanPath]) {
    return ROUTE_METADATA[cleanPath];
  }

  // Prefix matching for parameterized routes
  if (cleanPath.startsWith('/product/')) {
    return {
      title: 'Product Details | ZipRIGHT — Fit Calibrated',
      description: 'View garment specifications, cross-brand size recommendation, and virtual try-on simulation.',
      ogType: 'product',
    };
  }
  if (cleanPath.startsWith('/brand/')) {
    return {
      title: 'Brand Profile | ZipRIGHT',
      description: 'Explore brand size charts, fit tolerance standards, and verified catalog garments.',
      ogType: 'website',
    };
  }
  if (cleanPath.startsWith('/seller/')) {
    return {
      title: 'Seller Portal | ZipRIGHT',
      description: 'Merchant dashboard for size chart ingestion and virtual try-on analytics.',
      noindex: true,
    };
  }
  if (cleanPath.startsWith('/admin/')) {
    return {
      title: 'Atelier Admin | ZipRIGHT',
      description: 'Administrative management console.',
      noindex: true,
    };
  }
  if (cleanPath.startsWith('/chat/')) {
    return {
      title: 'Stylist Chat | ZipRIGHT',
      description: 'Encrypted personal styling and outfit conversation.',
      noindex: true,
    };
  }

  // Fallback to 404 Not Found metadata if unknown
  return ROUTE_METADATA['/404'];
}

function ensureMetaTag(nameOrProperty: 'name' | 'property', key: string): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(`meta[${nameOrProperty}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(nameOrProperty, key);
    document.head.appendChild(element);
  }
  return element;
}

function ensureLinkTag(rel: string): HTMLLinkElement {
  let element = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  return element;
}

/**
 * Dynamically applies document title, meta descriptions, canonical URLs,
 * and social graph tags on route transition.
 */
export function applyPageSEO(pathname: string): void {
  const meta = getRouteMetadata(pathname);

  // 1. Update Document Title
  document.title = meta.title;

  // 2. Canonical URL Tag
  const canonicalUrl = `${CANONICAL_ORIGIN}/#${pathname}`;
  const canonicalTag = ensureLinkTag('canonical');
  canonicalTag.setAttribute('href', canonicalUrl);

  // 3. Meta Description
  const descTag = ensureMetaTag('name', 'description');
  descTag.setAttribute('content', meta.description);

  // 4. Robots Directives
  const robotsTag = ensureMetaTag('name', 'robots');
  robotsTag.setAttribute('content', meta.noindex ? 'noindex, nofollow' : 'index, follow');

  // 5. OpenGraph Tags
  const ogTitle = ensureMetaTag('property', 'og:title');
  ogTitle.setAttribute('content', meta.title);

  const ogDesc = ensureMetaTag('property', 'og:description');
  ogDesc.setAttribute('content', meta.description);

  const ogUrl = ensureMetaTag('property', 'og:url');
  ogUrl.setAttribute('content', canonicalUrl);

  const ogType = ensureMetaTag('property', 'og:type');
  ogType.setAttribute('content', meta.ogType || 'website');

  // 6. Twitter Card Tags
  const twTitle = ensureMetaTag('name', 'twitter:title');
  twTitle.setAttribute('content', meta.title);

  const twDesc = ensureMetaTag('name', 'twitter:description');
  twDesc.setAttribute('content', meta.description);
}
