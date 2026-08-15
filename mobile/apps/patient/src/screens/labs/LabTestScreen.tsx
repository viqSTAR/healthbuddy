import React, { useState, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Alert,
  Badge,
  bookLabTest,
  type LabPackage,
  Button,
  Card,
  Chip,
  ChipRow,
  colors,
  EmptyState,
  errorMessage,
  ErrorState,
  fetchLabPackages,
  Icon,
  Loading,
  radius,
  rupees,
  Screen,
  SearchBar,
  SectionHeader,
  spacing,
  Text,
  TopBar,
  useAsync,
} from '@healthbuddy/shared';
import { PromoBanner } from '../../components/PromoBanner';
import { useLocation } from '../../services/location';

const CATEGORIES = [
  'Preventive Care',
  'Cardiology',
  'Endocrinology',
  'General',
  'Diabetology',
  'Nutrition',
  'Gastroenterology',
];

/** Mirrors `lab_test_dashboard` / `book_lab_test`. */
export const LabTestScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const { selected } = useLocation();

  const { data, loading, error, refreshing, refresh, reload } = useAsync(
    () => fetchLabPackages(category ? { category } : {}),
    [category]
  );

  const packages = useMemo(() => {
    const list = data?.packages ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.testName.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
    );
  }, [data, query]);

  const book = async (pkg: LabPackage) => {
    const testId = pkg.id;

    // A test that must be attended is never booked against an address, and one
    // that can be collected needs a real one — sending a phlebotomist to
    // "somewhere" is worse than asking first.
    if (pkg.homeCollection && !selected) {
      Alert.alert('Where should we collect?', 'Add a delivery address so we know where to send the phlebotomist.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Add address', onPress: () => navigation.navigate('AddressBook') },
      ]);
      return;
    }

    setBookingId(testId);
    try {
      const order = await bookLabTest({
        testId,
        ...(pkg.homeCollection && selected ? { addressId: selected.id, homeCollection: true } : { homeCollection: false }),
      });
      /**
       * A booking is not a payment. The order is created waiting on money and
       * does not reach the lab until it arrives, so the patient continues to
       * the same payment screen a medicine order uses.
       *
       * COD is refused: nothing is handed over at a door for a lab test, so
       * there is no moment at which cash could be collected — the server
       * refuses it for this purpose too.
       */
      navigation.navigate('Payment', {
        purpose: 'LAB_ORDER',
        targetId: order.id,
        amount: pkg.price,
        nextScreen: 'LabResult',
        nextParams: { orderId: order.id },
        allowCod: false,
      });
    } catch (err) {
      Alert.alert('Could not book', errorMessage(err));
    } finally {
      setBookingId(null);
    }
  };

  return (
    <Screen padded={false} refreshing={refreshing} onRefresh={refresh} bottomInset={spacing.xxl}>
      <TopBar title="Lab Tests" onNotificationsPress={() => navigation.navigate('Orders')} />

      <View style={styles.page}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search lab tests" />

        <PromoBanner
          eyebrow="Home Collection"
          title="Free sample pickup at your doorstep"
          actionLabel="Learn more"
        />

        <View>
          <SectionHeader
            title="Categories"
            actionLabel={category ? 'Clear' : undefined}
            onActionPress={() => setCategory(null)}
          />
          <ChipRow>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={c}
                icon="biotech"
                tint="warning"
                selected={category === c}
                onPress={() => setCategory(category === c ? null : c)}
              />
            ))}
          </ChipRow>
        </View>

        <View style={styles.list}>
          <SectionHeader title={category ?? 'Popular Tests'} />

          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : packages.length === 0 ? (
            <EmptyState icon="search_off" title="No tests found" message="Try another category." />
          ) : (
            packages.map((pkg) => (
              <Card key={pkg.id} style={styles.testCard}>
                <View style={styles.testHead}>
                  <View style={styles.testIcon}>
                    <Icon name="biotech" size={22} color={colors.warningDark} />
                  </View>

                  <View style={styles.flex}>
                    <Text variant="headlineSmMobile" color={colors.headingDark}>
                      {pkg.testName}
                    </Text>
                    <Text variant="captionSm" color={colors.captionGray}>
                      {pkg.category} · {pkg.sampleType}
                    </Text>
                  </View>
                </View>

                <View style={styles.testMeta}>
                  {pkg.fastingReq ? (
                    <Badge label="Fasting required" tint="warning" icon="schedule" />
                  ) : (
                    <Badge label="No fasting" tint="success" icon="check_circle" />
                  )}
                  {pkg.homeCollection ? (
                    <Badge label="Home collection" tint="info" icon="home" />
                  ) : (
                    <Badge label="Visit the lab" tint="neutral" icon="local_hospital" />
                  )}
                  {/* Said up front because it changes what the patient gets:
                      a scan produces films and a viewer, not just a PDF. */}
                  {pkg.deliveryMode === 'PHYSICAL' ? (
                    <Badge label="Film delivered" tint="warning" icon="local_shipping" />
                  ) : pkg.deliveryMode === 'DIGITAL_IMAGING' ? (
                    <Badge label="Report + images" tint="info" icon="image" />
                  ) : null}
                </View>

                <View style={styles.testFoot}>
                  <Text variant="displayBold" color={colors.primary}>
                    {rupees(pkg.price)}
                  </Text>
                  <Button
                    label="Book test"
                    size="md"
                    loading={bookingId === pkg.id}
                    onPress={() => book(pkg)}
                  />
                </View>
              </Card>
            ))
          )}
        </View>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.insetPage, gap: spacing.xl },
  list: { gap: spacing.insetCard },
  testCard: { gap: spacing.insetCard },
  testHead: { flexDirection: 'row', gap: spacing.insetCard, alignItems: 'center' },
  testIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  testMeta: { flexDirection: 'row', gap: spacing.base, flexWrap: 'wrap' },
  testFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
