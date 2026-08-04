import React, { useState, useMemo } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  SearchBar,
  Text,
  TopBar,
  colors,
  fetchDoctors,
  spacing,
  useAsync,
} from '@healthbuddy/shared';
import { DoctorRow } from '../../components/DoctorCard';

const SPECIALTIES = [
  'All',
  'General Physician',
  'Cardiologist',
  'Dermatologist',
  'Pediatrician',
  'Orthopedic',
  'Neurologist',
];

/** Doctor directory with specialty filtering and client-side search. */
export const DoctorDirectoryScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const [specialty, setSpecialty] = useState<string>(route.params?.specialty ?? 'All');
  const [query, setQuery] = useState('');

  const { data, loading, error, refreshing, refresh, reload } = useAsync(
    () => fetchDoctors(specialty === 'All' ? {} : { specialty }),
    [specialty]
  );

  const doctors = useMemo(() => {
    const list = data?.doctors ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (d) => d.name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q)
    );
  }, [data, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Find a Doctor" onBack={navigation.canGoBack() ? navigation.goBack : undefined} />

      <View style={styles.controls}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search doctors or specialties"
        />
      </View>

      <View style={styles.chipsWrapper}>
        <FlatList
          horizontal
          data={SPECIALTIES}
          keyExtractor={(s) => s}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          renderItem={({ item }) => (
            <Chip label={item} selected={specialty === item} onPress={() => setSpecialty(item)} />
          )}
        />
      </View>

      {loading ? (
        <Loading label="Loading doctors…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <FlatList
          data={doctors}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={refresh}
          ListHeaderComponent={
            <Text variant="captionSm" color={colors.captionGray}>
              {doctors.length} {doctors.length === 1 ? 'doctor' : 'doctors'} available
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="search_off"
              title="No doctors found"
              message="Try a different specialty or search term."
            />
          }
          renderItem={({ item }) => (
            <DoctorRow
              doctor={item}
              onPress={() => navigation.navigate('DoctorProfile', { doctorId: item.id })}
              onBook={() => navigation.navigate('BookConsultation', { doctorId: item.id })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  controls: { paddingHorizontal: spacing.insetPage, paddingBottom: spacing.insetCard },
  chipsWrapper: { paddingBottom: spacing.insetCard },
  chips: { gap: spacing.base, paddingHorizontal: spacing.insetPage },
  list: {
    paddingHorizontal: spacing.insetPage,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.insetCard,
  },
});
