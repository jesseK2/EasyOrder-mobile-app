import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  image_url: string;
  badge: string | null;
};

export type CartLine = {
  product: Product;
  quantity: number;
};

export const CART_STORAGE_KEY = "easyorder-cart";

export const demoProducts: Product[] = [
  { id: "demo-1", slug: "daily-ceramic-cup", name: "Daily ceramic cup", description: "Hand-thrown stoneware · 320 ml", category: "Table", price_cents: 2800, image_url: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=1000&q=85", badge: "BESTSELLER" },
  { id: "demo-2", slug: "linen-market-tote", name: "Linen market tote", description: "Washed European linen · oat", category: "Carry", price_cents: 4200, image_url: "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=1000&q=85", badge: "JUST IN" },
  { id: "demo-3", slug: "morning-pour-over", name: "Morning pour-over", description: "Glazed porcelain · warm white", category: "Ritual", price_cents: 3600, image_url: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1000&q=85", badge: null },
  { id: "demo-4", slug: "field-notes-set", name: "Field notes set", description: "Three pocket notebooks · recycled", category: "Paper", price_cents: 1800, image_url: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?auto=format&fit=crop&w=1000&q=85", badge: null },
];

export function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
