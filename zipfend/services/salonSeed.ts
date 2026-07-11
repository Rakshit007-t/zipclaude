/**
 * The Salon's opening collection — editorial looks posted by the house
 * account so a brand-new user never lands on an empty feed. These are
 * honest curated posts (creator = ZipRIGHT Éditions, our editorial desk),
 * not fake community members. Every look tags real catalog products, so
 * the whole feed is shoppable from first launch.
 *
 * Real community posts (from Firestore) always render ABOVE the seeds;
 * once the community is alive the seeds naturally fall away.
 */
import { demoProducts } from './demoProducts';

const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1080&q=85`;

const p = (id: string) => {
  const d = demoProducts.find(x => x.id === id)!;
  return { id: d.id, title: d.title, brand: d.brand, price: d.price, image: d.image, url: d.url, affiliateLink: d.affiliateLink || d.url };
};

export const HOUSE_CREATOR = {
  uid: 'zipright-editions',
  name: 'ZipRIGHT Éditions',
  username: 'zipright.editions',
  avatar: null as string | null,
};

export interface SeedLook {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorUsername: string;
  creatorAvatar: string | null;
  mediaUrl: string;
  mediaUrls: string[];
  mediaType: 'image';
  caption: string;
  hashtags: string[];
  audience: 'public';
  taggedProducts: ReturnType<typeof p>[];
  likesCount: number;
  viewsCount: number;
  createdAt: null;
  isSeed: true;
}

function look(id: string, images: string[], caption: string, products: string[], likes: number): SeedLook {
  return {
    id: `seed-${id}`,
    creatorId: HOUSE_CREATOR.uid,
    creatorName: HOUSE_CREATOR.name,
    creatorUsername: HOUSE_CREATOR.username,
    creatorAvatar: HOUSE_CREATOR.avatar,
    mediaUrl: images[0],
    mediaUrls: images,
    mediaType: 'image',
    caption,
    hashtags: (caption.match(/#[\w]+/g) || []).map(t => t.slice(1).toLowerCase()),
    audience: 'public',
    taggedProducts: products.map(p),
    likesCount: likes,
    viewsCount: likes * 9,
    createdAt: null,
    isSeed: true,
  };
}

export const SEED_LOOKS: SeedLook[] = [
  look('checked-street', [img('photo-1602810318383-e386cc2a3ccf')],
    'The checked shirt, worn like you mean it. Off-duty uniform, zero effort. #ootd #streetstyle',
    ['demo-roadster-shirt', 'demo-denim-jeans'], 214),
  look('kurta-morning', [img('photo-1594633312681-425c7b97ccd1'), img('photo-1583391733956-6c78276477e2')],
    'Cotton kurta, morning light. The drape does the talking. #ethnicwear #festive',
    ['demo-mango-kurta'], 187),
  look('denim-on-denim', [img('photo-1551028719-00167b16eac5'), img('photo-1541099649105-f69ad21f3246')],
    'Denim on denim — yes, still. Jacket boxy, jeans slim, balance kept. #denim #layers',
    ['demo-women-denim-jacket', 'demo-denim-jeans'], 342),
  look('white-sneaker-rule', [img('photo-1549298916-b41d501d3772')],
    'One rule this season: white sneakers with everything. Everything. #sneakers #minimal',
    ['demo-white-sneaker'], 456),
  look('linen-hour', [img('photo-1598033129183-c4f50c736f10'), img('photo-1496747611176-843222e1e57c')],
    'Linen hour. Relaxed shoulder, rolled sleeve, done. Summer solved. #linen #summerstyle',
    ['demo-linen-shirt'], 198),
  look('polo-quiet', [img('photo-1521572163474-6864f9cf17ab')],
    'The quiet polo. No logo shouting — the fit is the flex. #menswear #capsule',
    ['demo-polo-tee'], 165),
  look('tote-work', [img('photo-1594223274512-ad4803739b7c'), img('photo-1483985988355-763728e1935b')],
    'Carry the week. One tote, five outfits, zero fuss. #workwear #accessories',
    ['demo-work-tote'], 129),
  look('little-layers', [img('photo-1519238263530-99bdd11df2ea')],
    'Little layers for little people — room to grow built in. #kidswear',
    ['demo-kids-hoodie'], 98),
];
