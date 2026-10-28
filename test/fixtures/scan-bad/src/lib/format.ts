import { pricing } from "@/app/checkout/pricing";

export function formatPrice(v: number) {
  return pricing.symbol + v.toFixed(2);
}
