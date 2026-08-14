import React, { useState, useMemo } from 'react';
import { View, StyleSheet, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  Loading,
  SearchBar,
  Text,
  TopBar,
  colors,
  fetchDoctors,
  radius,
  spacing,
  useAsync,
} from '@healthbuddy/shared';
import { DoctorRow } from '../../components/DoctorCard';
import { useLocation } from '../../services/location';

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
  const [visitType, setVisitType] = useState<'VIDEO' | 'IN_PERSON'>('VIDEO');
  const { selected } = useLocation();

  const pincode = selected?.pincode;

  const { data, loading, error, refreshing, refresh, reload } = useAsync(
    () =>
      fetchDoctors({
        ...(specialty === 'All' ? {} : { specialty }),
        visitType,
        // Only sent for an in-person search. On a video search it would be
        // ignored anyway, and sending it invites the filter to creep in later.
        ...(visitType === 'IN_PERSON' && pincode ? { pincode } : {}),
      }),
    [specialty, visitType, pincode]
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

        <View style={styles.visitToggle}>
          {(
            [
              { value: 'VIDEO', label: 'Video visit', icon: 'videocam' },
              { value: 'IN_PERSON', label: 'In person', icon: 'local_hospital' },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setVisitType(option.value)}
              style={[styles.visitOption, visitType === option.value && styles.visitOptionOn]}
            >
              <Icon
                name={option.icon}
                size={16}
                color={visitType === option.value ? colors.primary : colors.captionGray}
              />
              <Text
                variant="captionSm"
                weight={visitType === option.value ? 'semibold' : 'regular'}
                color={visitType === option.value ? colors.primary : colors.captionGray}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
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
              {/* Said out loud, because "why can I only see two doctors?" is the
                  obvious question the moment a filter silently narrows a list. */}
              {visitType === 'IN_PERSON'
                ? pincode
                  ? ` near ${selected?.city ?? pincode}`
                  : ' — set an address to find clinics near you'
                : ' · video reaches anywhere'}
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="search_off"
              title="No doctors found"
              message={
                visitType === 'IN_PERSON'
                  ? 'No clinics near this address take in-person visits yet. Try a video visit — those reach anywhere.'
                  : 'Try a different specialty or search term.'
              }
              {...(visitType === 'IN_PERSON'
                ? { actionLabel: 'Switch to video', onActionPress: () => setVisitType('VIDEO') }
                : {})}
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
  visitToggle: {
    flexDirection: 'row',
    gap: spacing.base,
    marginTop: spacing.insetCard,
  },
  visitOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.stackMedium,
    paddingVertical: spacing.base + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    backgroundColor: colors.surfaceContainerLowest,
  },
  visitOptionOn: { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLow },
  controls: { paddingHorizontal: spacing.insetPage, paddingBottom: spacing.insetCard },
  chipsWrapper: { paddingBottom: spacing.insetCard },
  chips: { gap: spacing.base, paddingHorizontal: spacing.insetPage },
  list: {
    paddingHorizontal: spacing.insetPage,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.insetCard,
  },
});
