/** Units left, phrased the way a shop assistant would. */
export function StockLabel({ stock, className = '' }: { stock: number; className?: string }) {
  if (stock <= 0) return <span className={`text-destructive ${className}`}>نفدت الكمية</span>;
  if (stock <= 5) return <span className={`text-amber-600 ${className}`}>باقي {stock} بس</span>;
  return <span className={`text-success ${className}`}>متوفر {stock > 99 ? '+99' : stock}</span>;
}
