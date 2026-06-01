export interface DemoProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  image: string;
  category: string;
  type: string;
  url: string;
  affiliateLink?: string;
  description?: string;
  fit_hint?: string | null;
  size_chart?: Record<string, number> | null;
  available_sizes?: string[] | null;
  size_format?: string | null;
}

export const demoProducts: DemoProduct[] = [
  {
    id: 'demo-roadster-shirt',
    title: 'Checked Casual Shirt',
    brand: 'Roadster',
    price: 'Rs. 1,299',
    image: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1080&q=85',
    category: 'Men',
    type: 'shirt',
    url: 'https://zipright.ai/demo/checked-casual-shirt',
    description: 'Everyday casual shirt demo with shoulder, chest, and sleeve fit guidance.',
  },
  {
    id: 'demo-mango-kurta',
    title: 'Cotton Straight Kurta',
    brand: 'Mango People',
    price: 'Rs. 1,899',
    image: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=1080&q=85',
    category: 'Women',
    type: 'kurta',
    url: 'https://zipright.ai/demo/cotton-straight-kurta',
    description: 'Modest ethnic-wear demo for bust, shoulder, waist, and length recommendations.',
  },
  {
    id: 'demo-polo-tee',
    title: 'Solid Polo T-Shirt',
    brand: 'Urban League',
    price: 'Rs. 999',
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1080&q=85',
    category: 'Men',
    type: 'tshirt',
    url: 'https://zipright.ai/demo/solid-polo-tshirt',
    description: 'Core tee demo for chest, torso length, and preferred ease scoring.',
  },
  {
    id: 'demo-denim-jeans',
    title: 'Slim Fit Stretch Jeans',
    brand: 'Denim Co.',
    price: 'Rs. 2,499',
    image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1080&q=85',
    category: 'Men',
    type: 'jeans',
    url: 'https://zipright.ai/demo/slim-fit-stretch-jeans',
    description: 'Denim demo focused on waist, hip, inseam, and return-risk signals.',
  },
  {
    id: 'demo-women-denim-jacket',
    title: 'Classic Denim Jacket',
    brand: 'StyleCast',
    price: 'Rs. 2,799',
    image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1080&q=85',
    category: 'Women',
    type: 'jacket',
    url: 'https://zipright.ai/demo/classic-denim-jacket',
    description: 'Outerwear demo showing layered-fit guidance and size confidence.',
  },
  {
    id: 'demo-white-sneaker',
    title: 'Everyday White Sneakers',
    brand: 'Stride Street',
    price: 'Rs. 3,199',
    image: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1080&q=85',
    category: 'Shoes',
    type: 'shoes',
    url: 'https://zipright.ai/demo/everyday-white-sneakers',
    description: 'Footwear demo for size translation, width preference, and comfort notes.',
  },
  {
    id: 'demo-kids-hoodie',
    title: 'Kids Cotton Hoodie',
    brand: 'Little Mode',
    price: 'Rs. 1,199',
    image: 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=1080&q=85',
    category: 'Kids',
    type: 'kids',
    url: 'https://zipright.ai/demo/kids-cotton-hoodie',
    description: 'Kidswear demo with growth-room guidance for parents.',
  },
  {
    id: 'demo-work-tote',
    title: 'Minimal Work Tote',
    brand: 'Arden Studio',
    price: 'Rs. 1,599',
    image: 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=1080&q=85',
    category: 'Accessories',
    type: 'accessory',
    url: 'https://zipright.ai/demo/minimal-work-tote',
    description: 'Accessory demo for styling recommendations and gifting workflows.',
  },
  {
    id: 'demo-linen-shirt',
    title: 'Relaxed Linen Shirt',
    brand: 'Summerline',
    price: 'Rs. 1,699',
    image: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1080&q=85',
    category: 'Women',
    type: 'shirt',
    url: 'https://zipright.ai/demo/relaxed-linen-shirt',
    description: 'Smart casual demo for sleeve length, shoulder drop, and preferred ease.',
  },
];
