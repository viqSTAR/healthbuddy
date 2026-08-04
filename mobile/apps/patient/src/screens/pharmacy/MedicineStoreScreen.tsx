import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  Screen,
  SearchBar,
  SectionHeader,
  Text,
  colors,
  fetchMedicines,
  radius,
  spacing,
  useAsync,
} from '@healthbuddy/shared';
import { ProductCard } from '../../components/ProductCard';
import { PromoBanner } from '../../components/PromoBanner';
import { useCart } from '../../services/cart';

const CATEGORIES = [
  { label: 'Pain Relief', icon: 'healing', tint: 'danger' as const },
  { label: 'Antibiotics', icon: 'pill', tint: 'info' as const },
  { label: 'Allergy', icon: 'masks', tint: 'warning' as const },
  { label: 'Supplements', icon: 'nutrition', tint: 'success' as const },
  { label: 'Cardiac', icon: 'monitor_heart', tint: 'danger' as const },
  { label: 'Diabetes', icon: 'bloodtype', tint: 'info' as const },
];

/** Mirrors `medicine_store` / `medicine_dashboard`. */
export const MedicineStoreScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const cart = useCart();

  const { data, loading, error, refreshing, refresh, reload } = useAsync(
    () => fetchMedicines(category ? { category } : {}),
    [category]
  );

  const medicines = useMemo(() => {
    const list = data?.medicines ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) => m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
    );
  }, [data, query]);

  const rows = useMemo(() => {
    const out: (typeof medicines)[] = [];
    for (let i = 0; i < medicines.length; i += 2) out.push(medicines.slice(i, i + 2));
    return out;
  }, [medicines]);

  return (
    <Screen padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={spacing.xxl}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Icon name="spa" size={26} color={colors.primary} />
          <Text variant="displayBold" color={colors.primary}>
            Medicine Store
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => navigation.navigate('Cart')}
            style={styles.iconButton}
            accessibilityLabel={`Cart, ${cart.count} items`}
          >
            <Icon name="shopping_cart" size={22} color={colors.primary} />
            {cart.count > 0 ? (
              <View style={styles.cartBadge}>
                <Text variant="captionSm" weight="bold" color={colors.onError}>
                  {cart.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.page}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search medicines, healthcare products"
        />

        <PromoBanner
          eyebrow="Health Buddy Plus"
          title="20% Off on your first order"
          actionLabel="Claim Now"
        />

        <View>
          <SectionHeader
            title="Categories"
            actionLabel="See All"
            onActionPress={() => setCategory(null)}
          />
          <ChipRow>
            {CATEGORIES.map((c) => (
              <Chip
                key={c.label}
                label={c.label}
                icon={c.icon}
                tint={c.tint}
                selected={category === c.label}
                onPress={() => setCategory(category === c.label ? null : c.label)}
              />
            ))}
          </ChipRow>
        </View>

        <View>
          <SectionHeader title={category ?? 'Featured Products'} />

          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : medicines.length === 0 ? (
            <EmptyState
              icon="search_off"
              title="Nothing here yet"
              message="No products match this filter."
            />
          ) : (
            <View style={styles.grid}>
              {rows.map((row, i) => (
                <View key={i} style={styles.gridRow}>
                  {row.map((m) => (
                    <ProductCard
                      key={m.id}
                      title={m.name}
                      subtitle={m.description ?? m.category}
                      price={m.price}
                      outOfStock={m.stock <= 0}
                      badge={m.stock > 200 ? { label: 'In stock', tone: 'new' } : undefined}
                      onPress={() => navigation.navigate('Cart')}
                      onAdd={() => cart.add(m)}
                    />
                  ))}
                  {row.length === 1 ? <View style={styles.flex} /> : null}
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetPage,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  headerActions: { flexDirection: 'row', gap: spacing.base },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.xl },
  grid: { gap: spacing.insetPage },
  gridRow: { flexDirection: 'row', gap: spacing.insetPage },
  flex: { flex: 1 },
});
