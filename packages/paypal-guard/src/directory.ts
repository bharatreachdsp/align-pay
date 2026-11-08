/**
 * What the guard knows about the store itself: its catalogue (prices come from here, never from the agent) and its
 * customers (invoice recipients come from here). Kettle & Kesar and everyone in it are fictional.
 */
export interface Product {
  sku: string;
  name: string;
  priceUsd: number;
  aliases: string[];
}

export interface Customer {
  /** Scenario-scoped id, e.g. "ben-7K2Q". It is the `custom_id` on the customer's PayPal orders. */
  id: string;
  base: string;
  name: string;
  email: string;
  businessName: string | null;
}

export interface StoreDirectory {
  storeName: string;
  ownerEmail: string;
  products: Product[];
  findProduct(nameOrSku: string): Product | null;
  customer(id: string): Customer | null;
  customerByEmail(email: string): Customer | null;
}

export const KETTLE_AND_KESAR_PRODUCTS: Product[] = [
  { sku: "KK-CHAI", name: "Kesar Chai Blend", priceUsd: 18, aliases: ["kesar chai", "chai blend"] },
  { sku: "KK-DARJ", name: "Darjeeling First Flush", priceUsd: 26, aliases: ["darjeeling", "first flush"] },
  { sku: "KK-KETTLE", name: "Brass Tea Kettle", priceUsd: 64, aliases: ["kettle", "brass kettle"] },
  { sku: "KK-CASE", name: "Chai Case (24 packs)", priceUsd: 180, aliases: ["chai case", "case", "cases", "chai cases"] },
];

export const CUSTOMER_PROFILES = {
  asha: { name: "Asha Rao", givenName: "Asha", surname: "Rao", businessName: null },
  ben: { name: "Ben Okafor", givenName: "Ben", surname: "Okafor", businessName: null },
  chen: { name: "Chen Wei", givenName: "Chen", surname: "Wei", businessName: "Chen's Corner Café (fictional)" },
} as const;
export type CustomerBase = keyof typeof CUSTOMER_PROFILES;

export const STORE_NAME = "Kettle & Kesar";
export const OWNER_EMAIL = "owner@kettle-and-kesar.example";

/** "ben-7K2Q" → { base: "ben", tag: "7K2Q" }. */
export function parseCustomerId(id: string): { base: CustomerBase; tag: string } | null {
  const m = /^(asha|ben|chen)-([A-Z0-9]{4,12})$/.exec(id);
  return m ? { base: m[1] as CustomerBase, tag: m[2]! } : null;
}

export const customerEmail = (base: string, tag: string): string => `${base}.${tag.toLowerCase()}@customers.example.com`;

export function kettleAndKesar(): StoreDirectory {
  const products = KETTLE_AND_KESAR_PRODUCTS;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return {
    storeName: STORE_NAME,
    ownerEmail: OWNER_EMAIL,
    products,
    findProduct(q) {
      const n = norm(q);
      if (!n) return null;
      return (
        products.find((p) => p.sku.toLowerCase() === n || norm(p.name) === n) ??
        products.find((p) => p.aliases.some((a) => n === a || n.includes(a))) ??
        null
      );
    },
    customer(id) {
      const p = parseCustomerId(id);
      if (!p) return null;
      const prof = CUSTOMER_PROFILES[p.base];
      return { id, base: p.base, name: prof.name, email: customerEmail(p.base, p.tag), businessName: prof.businessName };
    },
    customerByEmail(email) {
      const m = /^(asha|ben|chen)\.([a-z0-9]{4,12})@customers\.example\.com$/.exec(email.trim().toLowerCase());
      return m ? this.customer(`${m[1]}-${m[2]!.toUpperCase()}`) : null;
    },
  };
}
