import React, { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import {
  Card,
  colors,
  Icon,
  Screen,
  SectionHeader,
  spacing,
  Text,
  TopBar,
} from '@healthbuddy/shared';

/**
 * How the app actually behaves, in the patient's own words.
 *
 * Replaces a "Help Center" row that rendered and did nothing. The answers here
 * are written from the real rules in the services — the 72-hour consent window,
 * what cancelling refunds, what closing an account keeps — rather than generic
 * copy, because the questions people ask support are exactly the places where
 * the system does something non-obvious and correct.
 *
 * No support address is hardcoded. Inventing one would send people into a void;
 * it belongs in configuration alongside the DPO contact, which is still
 * outstanding — see DATA-POLICY.md §7.
 */

interface Entry {
  q: string;
  a: string;
}

const SECTIONS: { title: string; entries: Entry[] }[] = [
  {
    title: 'Consultations',
    entries: [
      {
        q: 'How do I cancel a consultation?',
        a:
          'Profile → My consultations, then Cancel on the booking. The slot is released ' +
          'immediately for someone else and anything you paid is refunded automatically. ' +
          'A consultation that has already finished cannot be cancelled.',
      },
      {
        q: 'When can I join a video consultation?',
        a:
          'The room opens shortly before your slot and stays open for a while after it ' +
          'starts, so arriving a few minutes late is fine. Outside that window the Join ' +
          'button will not connect — book again rather than waiting.',
      },
      {
        q: 'Can I message the doctor afterwards?',
        a:
          'Yes, for a limited period after the consultation. Profile → Messages. The ' +
          'thread closes after that window; a new question after it closes needs a new ' +
          'consultation, which is also what keeps doctors answering the ones that are open.',
      },
    ],
  },
  {
    title: 'Prescriptions and orders',
    entries: [
      {
        q: 'My doctor prescribed something — where is it?',
        a:
          'It appears on your home screen as a prescription ready to order, with the ' +
          'price worked out. You have 72 hours to approve it before it expires. Nothing ' +
          'is ordered or charged until you approve it.',
      },
      {
        q: 'Why can I not order a medicine I was prescribed?',
        a:
          'Some medicines cannot be sold online at all under the drug rules, and others ' +
          'are only stocked by pharmacies that do not serve your pincode. The basket ' +
          'shows what is orderable; anything missing needs a physical pharmacy.',
      },
      {
        q: 'My order was split into several deliveries.',
        a:
          'No single pharmacy stocked everything, so each shop sends its own parcel. Each ' +
          'is tracked separately and you are charged once for the whole order.',
      },
    ],
  },
  {
    title: 'Money',
    entries: [
      {
        q: 'Where can I see what I was charged?',
        a:
          'Profile → Payments. It lists every payment, what it was for, and any refunds ' +
          'against it.',
      },
      {
        q: 'When do refunds arrive?',
        a:
          'The refund is issued immediately when you cancel. How long it takes to appear ' +
          'depends on your bank — usually a few working days.',
      },
      {
        q: 'What is cash on delivery?',
        a:
          'You pay the rider when the parcel arrives. It shows as awaiting payment until ' +
          'then, which is normal and not a failed payment. It is not offered on very ' +
          'large orders.',
      },
    ],
  },
  {
    title: 'Your data',
    entries: [
      {
        q: 'What do you hold about me?',
        a:
          'Profile → Privacy & data → See what we hold. It lists everything, by category, ' +
          'from your profile to your consultations and payments.',
      },
      {
        q: 'What happens if I close my account?',
        a:
          'Your name, phone number, saved addresses, devices and profile photos are ' +
          'deleted and cannot be recovered. Your consultation, prescription and payment ' +
          'records are kept — they are medical and accounting records with their own ' +
          'retention periods, and the doctor who prescribed remains accountable for it. ' +
          'The records no longer identify you.',
      },
      {
        q: 'Can I stop the health tips without losing my account?',
        a:
          'Yes. Profile → Privacy & data, and turn off health tips and offers. It changes ' +
          'nothing about the care available to you.',
      },
    ],
  },
];

const Question: React.FC<Entry> = ({ q, a }) => {
  const [open, setOpen] = useState(false);

  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <Card style={styles.card}>
        <View style={styles.qRow}>
          <Text variant="labelMd" style={styles.flex}>
            {q}
          </Text>
          <Icon name={open ? 'expand_less' : 'expand_more'} size={20} color={colors.captionGray} />
        </View>
        {open ? (
          <Text variant="captionSm" style={styles.answer}>
            {a}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
};

export const HelpScreen: React.FC<{ navigation: any }> = ({ navigation }) => (
  <Screen padded={false} bottomInset={spacing.xxl}>
    <TopBar title="Help" onBack={() => navigation.goBack()} />

    <View style={styles.page}>
      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.group}>
          <SectionHeader title={section.title} />
          {section.entries.map((entry) => (
            <Question key={entry.q} {...entry} />
          ))}
        </View>
      ))}

      <Card style={styles.emergency}>
        <View style={styles.qRow}>
          <Icon name="emergency" size={20} color={colors.error} />
          <Text variant="labelMd" style={styles.flex}>
            In an emergency
          </Text>
        </View>
        <Text variant="captionSm" style={styles.answer}>
          Do not wait for a consultation. Use the Emergency button on the home screen for
          local ambulance and hospital numbers, or call your national emergency number.
        </Text>
      </Card>
    </View>
  </Screen>
);

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg },
  group: { gap: spacing.base },
  card: { gap: spacing.base },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.base },
  flex: { flex: 1 },
  answer: { color: colors.onSurfaceVariant, lineHeight: 20 },
  emergency: { gap: spacing.base, borderColor: colors.error, borderWidth: 1 },
});
