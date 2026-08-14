import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { Medicine } from '@healthbuddy/shared';

export interface CartLine {
  medicine: Medicine;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  count: number;
  subtotal: number;
  /** Lines grouped by the shop filling them — the parcels this will become. */
  parcels: { pharmacyId: string; pharmacyName: string; lines: CartLine[]; subtotal: number }[];
  add: (medicine: Medicine, quantity?: number) => void;
  setQuantity: (medicineId: string, quantity: number) => void;
  remove: (medicineId: string) => void;
  clear: () => void;
  quantityOf: (medicineId: string) => number;
}

const CartContext = createContext<CartState | null>(null);

/**
 * What can still be added of a given medicine.
 *
 * `available` is the sellable count at the local shop and is the real ceiling;
 * `stock` is the catalogue reference figure shared platform-wide and would let
 * someone add twenty of something the nearby shop has two of.
 */
const ceilingOf = (medicine: Medicine) => medicine.available ?? medicine.stock;

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lines, setLines] = useState<CartLine[]>([]);

  const add = useCallback((medicine: Medicine, quantity = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.medicine.id === medicine.id);
      if (!existing) return [...prev, { medicine, quantity }];

      // Never let the cart exceed known stock — the server rejects it anyway.
      const next = Math.min(existing.quantity + quantity, ceilingOf(medicine));
      return prev.map((l) => (l.medicine.id === medicine.id ? { ...l, quantity: next } : l));
    });
  }, []);

  const setQuantity = useCallback((medicineId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.medicine.id !== medicineId)
        : prev.map((l) =>
            l.medicine.id === medicineId
              ? { ...l, quantity: Math.min(quantity, ceilingOf(l.medicine)) }
              : l
          )
    );
  }, []);

  const remove = useCallback((medicineId: string) => {
    setLines((prev) => prev.filter((l) => l.medicine.id !== medicineId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartState>(() => {
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    const subtotal = Number(
      lines.reduce((sum, l) => sum + l.medicine.price * l.quantity, 0).toFixed(2)
    );

    // Grouped the same way the server will split the order, so the cart can
    // promise two parcels only when the order genuinely becomes two.
    const grouped = new Map<string, { pharmacyName: string; lines: CartLine[] }>();
    for (const line of lines) {
      const shop = line.medicine.soldBy;
      if (!shop) continue;
      const entry = grouped.get(shop.id);
      if (entry) entry.lines.push(line);
      else grouped.set(shop.id, { pharmacyName: shop.name, lines: [line] });
    }

    const parcels = [...grouped.entries()].map(([pharmacyId, { pharmacyName, lines: group }]) => ({
      pharmacyId,
      pharmacyName,
      lines: group,
      subtotal: Number(
        group.reduce((sum, l) => sum + l.medicine.price * l.quantity, 0).toFixed(2)
      ),
    }));

    return {
      lines,
      count,
      subtotal,
      parcels,
      add,
      setQuantity,
      remove,
      clear,
      quantityOf: (id) => lines.find((l) => l.medicine.id === id)?.quantity ?? 0,
    };
  }, [lines, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export const useCart = (): CartState => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>.');
  return ctx;
};
