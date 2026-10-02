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
  color?: string;
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
    url: 'https://zipright.ai/products/checked-casual-shirt',
    description: 'Everyday casual shirt crafted in breathable cotton with structured collar and tailored sleeve fall.',
  },
  {
    id: 'demo-casual-red-shirt',
    title: 'Casual Red Shirt',
    brand: 'Urban Ridge',
    price: 'Rs. 1,499',
    image: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=1080&q=85',
    category: 'Men',
    type: 'shirt',
    color: 'Red',
    url: 'https://zipright.ai/products/casual-red-shirt',
    description: 'Casual red button-down shirt featuring tailored shoulders and clean drape.',
  },
  {
    id: 'demo-mango-kurta',
    title: 'Cotton Straight Kurta',
    brand: 'Mango People',
    price: 'Rs. 1,899',
    image: 'https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=1080&q=85',
    category: 'Women',
    type: 'kurta',
    url: 'https://zipright.ai/products/cotton-straight-kurta',
    description: 'Breathable cotton straight-fit kurta tailored for everyday comfort and clean lines.',
  },
  {
    id: 'demo-polo-tee',
    title: 'Solid Polo T-Shirt',
    brand: 'Urban League',
    price: 'Rs. 999',
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1080&q=85',
    category: 'Men',
    type: 'tshirt',
    url: 'https://zipright.ai/products/solid-polo-tshirt',
    description: 'Classic solid polo t-shirt with ribbed collar and comfortable chest ease.',
  },
  {
    id: 'demo-denim-jeans',
    title: 'Slim Fit Stretch Jeans',
    brand: 'Denim Co.',
    price: 'Rs. 2,499',
    image: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1080&q=85',
    category: 'Men',
    type: 'jeans',
    url: 'https://zipright.ai/products/slim-fit-stretch-jeans',
    description: 'Slim-fit stretch denim designed with modern contouring and durable wash.',
  },
  {
    id: 'demo-women-denim-jacket',
    title: 'Classic Denim Jacket',
    brand: 'StyleCast',
    price: 'Rs. 2,799',
    image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1080&q=85',
    category: 'Women',
    type: 'jacket',
    url: 'https://zipright.ai/products/classic-denim-jacket',
    description: 'Timeless denim jacket tailored for comfortable layering over casual essentials.',
  },
  {
    id: 'demo-white-sneaker',
    title: 'Everyday White Sneakers',
    brand: 'Stride Street',
    price: 'Rs. 3,199',
    image: 'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1080&q=85',
    category: 'Shoes',
    type: 'shoes',
    url: 'https://zipright.ai/products/everyday-white-sneakers',
    description: 'Clean low-top sneakers with cushioned footbed and versatile profile.',
  },
  {
    id: 'demo-kids-hoodie',
    title: 'Kids Cotton Hoodie',
    brand: 'Little Mode',
    price: 'Rs. 1,199',
    image: 'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=1080&q=85',
    category: 'Kids',
    type: 'kids',
    url: 'https://zipright.ai/products/kids-cotton-hoodie',
    description: 'Soft cotton-blend pullover hoodie designed for everyday durability and ease.',
  },
  {
    id: 'demo-work-tote',
    title: 'Minimal Work Tote',
    brand: 'Arden Studio',
    price: 'Rs. 1,599',
    image: 'https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=1080&q=85',
    category: 'Accessories',
    type: 'accessory',
    url: 'https://zipright.ai/products/minimal-work-tote',
    description: 'Structured everyday tote designed with clean lines and reinforced straps.',
  },
  {
    id: 'demo-linen-shirt',
    title: 'Relaxed Linen Shirt',
    brand: 'Summerline',
    price: 'Rs. 1,699',
    image: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1080&q=85',
    category: 'Women',
    type: 'shirt',
    url: 'https://zipright.ai/products/relaxed-linen-shirt',
    description: 'Lightweight breathable linen shirt with relaxed drape and casual collar.',
  },
];
