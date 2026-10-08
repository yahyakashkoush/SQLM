/**
 * Server-side only. Inside the production network the API is reached
 * directly (API_INTERNAL_URL); everywhere else through its public URL.
 */
const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface SiteProduct {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  images: string[];
  duration: string | null;
  badge: string | null;
  featured: boolean;
  ratingScore: string | null;
  reviewCount: number;
  categoryId: string | null;
}

export interface SiteData {
  name: string;
  tagline: string;
  about: string;
  botUrl: string;
  supportContact: string;
  deliveryTime: string;
  terms: string;
  paymentMethods: Array<{ id: string; name: string; description: string | null; kind: 'manual' | 'crypto'; currency: string }>;
  categories: Array<{ id: string; slug: string; name: string }>;
  products: SiteProduct[];
}

const FALLBACK: SiteData = {
  name: 'subsc',
  tagline: 'اشتراكاتك الرقمية الأصلية — بسعر أقل، وتسليم في دقايق.',
  about:
    'متجر متخصص في الاشتراكات والأدوات الرقمية الأصلية. بنشتغل بالكامل من خلال تيليجرام: بتختار المنتج، بتدفع بالطريقة اللي تناسبك، وبتستلم في الشات.',
  botUrl: 'https://t.me/subsctech_bot',
  supportContact: '',
  deliveryTime: 'من 15 دقيقة لحد ساعتين',
  terms: '',
  paymentMethods: [],
  categories: [],
  products: [],
};

/** Never throws: if the API is down the site still renders, pointing people at the bot. */
export async function getSite(): Promise<SiteData> {
  try {
    const res = await fetch(`${API_URL}/api/v1/store/site`, { next: { revalidate: 60 } });
    if (!res.ok) return FALLBACK;
    return (await res.json()) as SiteData;
  } catch {
    return FALLBACK;
  }
}

/** t.me deep link that opens the bot on one product (handled by /start p_<slug>). */
export function productLink(botUrl: string, slug: string): string {
  const payload = `p_${slug}`.slice(0, 64);
  return /^[A-Za-z0-9_-]+$/.test(payload) ? `${botUrl}?start=${payload}` : botUrl;
}
