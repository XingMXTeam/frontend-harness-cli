export function formatPrice(v: number, symbol = "$") {
  return symbol + v.toFixed(2);
}
