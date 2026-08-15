import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Button,
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
import { LocationChip } from '../../components/LocationChip';
import { CartBar } from '../../components/CartBar';
import { useToast } from '../../components/Toast';
import { useCart } from '../../services/cart';
import { useLocation } from '../../services/location';

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
  const toast = useToast();
  const { active, activePincode, serviceability, ready, locating, detectFromGps } = useLocation();

  const pincode = activePincode ?? undefined;

  /**
   * The catalogue is fetched per area. Keying the request on the pincode means
   * switching address refetches rather than leaving the previous area's prices
   * on screen — those prices belong to shops that do not deliver here.
   */
  const { data, loading, error, refreshing, refresh, reload } = useAsync(
    () => fetchMedicines({ ...(category ? { category } : {}), ...(pincode ? { pincode } : {}) }),
    [category, pincode]
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

  const header = (
    <>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Icon name="spa" size={26} color={colors.primary} />
          <Text variant="displayBold" color={colors.primary}>
            Medicine Store
          </Text>
        </View>

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

      <View style={styles.chipWrap}>
        <LocationChip onPress={() => navigation.navigate('AddressBook')} />
      </View>
    </>
  );

  /* ---------- No location yet ---------- */

  /**
   * Wait for the startup resolution before declaring the user location-less.
   * `ready` covers the cached-pincode and saved-address lookups; `locating`
   * covers the GPS attempt that follows when neither answered. Skipping this
   * flashes "where should we deliver?" at someone whose location is a beat away.
   */
  if (!ready || locating) {
    return (
      <Screen padded={false} bottomInset={spacing.xxl}>
        {header}
        <Loading label={locating ? 'Finding your location' : 'Loading'} />
      </Screen>
    );
  }

  if (!active) {
    return (
      <Screen padded={false} bottomInset={spacing.xxl}>
        {header}
        <EmptyState
          icon="location_off"
          title="Where should we deliver?"
          message="Share your location and we'll show what's in stock near you, with real prices. You can enter a pincode instead."
          actionLabel="Use my location"
          onActionPress={() => void detectFromGps()}
          secondaryActionLabel="Enter pincode"
          onSecondaryActionPress={() => navigation.navigate('AddressBook')}
        />
      </Screen>
    );
  }

  /**
   * Not serviceable — the store does not open.
   *
   * Showing a browsable catalogue that refuses at checkout is worse than saying
   * no here: it wastes the trip and teaches people the listing is unreliable.
   */
  if (serviceability?.serviceable === false) {
    return (
      <Screen padded={false} bottomInset={spacing.xxl}>
        {header}
        <View style={styles.gate}>
          <View style={styles.gateIcon}>
            <Icon name="local_shipping" size={40} color={colors.captionGray} />
          </View>
          <Text variant="headlineSmMobile" color={colors.headingDark}>
            We don&apos;t deliver to {active.pincode} yet
          </Text>
          <Text variant="bodyMd" color={colors.captionGray} style={styles.gateBody}>
            No pharmacy near {active.city ?? 'this area'} has signed up with us so far. You can
            still book consultations and lab tests from here.
          </Text>
          <Button
            label="Try another address"
            icon="location_on"
            onPress={() => navigation.navigate('AddressBook')}
          />
          <Pressable onPress={() => navigation.navigate('Home')} hitSlop={8}>
            <Text variant="labelMd" weight="medium" color={colors.primary}>
              Back to home
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  /* ---------- The store ---------- */

  return (
    <>
      <Screen
        padded={false}
        refreshing={refreshing}
        onRefresh={refresh}
        // Room for the cart bar, so the last row is never trapped underneath it.
        bottomInset={cart.count > 0 ? 96 : spacing.xxl}
      >
        {header}

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
            <SectionHeader title={category ?? 'Available near you'} />

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
                    {row.map((m) => {
                      // `available` is what the local shop can actually sell;
                      // `stock` is the catalogue reference and means nothing here.
                      const sellable = m.available ?? m.stock;
                      return (
                        <ProductCard
                          key={m.id}
                          title={m.name}
                          subtitle={m.description ?? m.category}
                          price={m.price}
                          {...(m.mrp && m.mrp > m.price ? { originalPrice: m.mrp } : {})}
                          outOfStock={sellable <= 0}
                          eta={m.deliverySpeed === 'EXPRESS' ? 'Under 30 min' : '2 days'}
                          express={m.deliverySpeed === 'EXPRESS'}
                          // Tapping a product opens the product. This used to
                          // jump to the cart, which is the one place a shopper
                          // is not trying to go when they tap a tile.
                          onPress={() => navigation.navigate('MedicineDetail', { medicine: m })}
                          onAdd={() => {
                            cart.add(m);
                            const next = cart.quantityOf(m.id) + 1;
                            toast.show(
                              next > 1 ? `${m.name} · ${next} in cart` : `${m.name} added`
                            );
                          }}
                        />
                      );
                    })}
                    {row.length === 1 ? <View style={styles.flex} /> : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Screen>

      <CartBar onPress={() => navigation.navigate('Cart')} />
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.insetPage,
    paddingTop: spacing.insetPage,
    paddingBottom: spacing.base,
  },
  chipWrap: { paddingHorizontal: spacing.insetPage, paddingBottom: spacing.insetCard },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
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
  gate: {
    alignItems: 'center',
    gap: spacing.insetCard,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  gateIcon: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
  },
  gateBody: { textAlign: 'center' },
});
