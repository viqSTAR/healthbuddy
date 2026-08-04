import React, { useState, useRef } from 'react';
import { View, StyleSheet, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Avatar,
  Badge,
  Icon,
  Text,
  colors,
  radius,
  spacing,
  typography,
} from '@healthbuddy/shared';

interface Message {
  id: string;
  from: 'me' | 'them';
  body: string;
  at: string;
}

const now = () => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Mirrors `consultation_chat` / `consultation_chat_joinable_meeting`.
 *
 * Messages are local to the session — there is no chat transport on the
 * backend yet, so nothing is persisted or delivered to the doctor.
 */
export const ConsultationChatScreen: React.FC<{ navigation: any; route: any }> = ({
  navigation,
  route,
}) => {
  const { appointment } = route.params ?? {};
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const listRef = useRef<FlatList<Message>>(null);

  const send = () => {
    const body = draft.trim();
    if (!body) return;

    setMessages((prev) => [...prev, { id: `${Date.now()}`, from: 'me', body, at: now() }]);
    setDraft('');
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={navigation.goBack} hitSlop={12} accessibilityLabel="Go back">
          <Icon name="arrow_back" size={24} color={colors.primary} />
        </Pressable>

        <Avatar name={appointment?.doctor?.name ?? 'Doctor'} size={40} tint="success" />

        <View style={styles.headerText}>
          <Text variant="headlineSmMobile" color={colors.headingDark} numberOfLines={1}>
            {appointment?.doctor?.name ?? 'Consultation'}
          </Text>
          <Text variant="captionSm" color={colors.captionGray}>
            {appointment?.doctor?.specialty ?? 'Chat'}
          </Text>
        </View>

        <Pressable
          onPress={() => navigation.navigate('VideoConsultation', { appointment })}
          style={styles.videoButton}
          accessibilityLabel="Start video call"
        >
          <Icon name="videocam" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.notice}>
              <Badge label="Session chat" tint="info" icon="info" />
              <Text variant="captionSm" color={colors.captionGray} center>
                Messages here stay on this device. Use the video call for live consultation.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.from === 'me' && styles.bubbleRowMine]}>
              <View style={[styles.bubble, item.from === 'me' ? styles.mine : styles.theirs]}>
                <Text
                  variant="bodyMd"
                  color={item.from === 'me' ? colors.onPrimary : colors.headingDark}
                >
                  {item.body}
                </Text>
                <Text
                  variant="captionSm"
                  color={item.from === 'me' ? colors.onPrimaryContainer : colors.captionGray}
                  style={styles.time}
                >
                  {item.at}
                </Text>
              </View>
            </View>
          )}
        />

        <View style={styles.composer}>
          <Pressable hitSlop={8} accessibilityLabel="Attach file">
            <Icon name="attach_file" size={22} color={colors.captionGray} />
          </Pressable>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message"
            placeholderTextColor={colors.captionGray}
            multiline
            maxLength={2000}
            onSubmitEditing={send}
          />

          <Pressable
            onPress={send}
            disabled={!draft.trim()}
            style={[styles.sendButton, !draft.trim() && styles.sendDisabled]}
            accessibilityLabel="Send message"
          >
            <Icon name="send" size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetCard,
    backgroundColor: colors.surfaceContainerLowest,
  },
  headerText: { flex: 1 },
  videoButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: spacing.insetPage, gap: spacing.base },
  notice: { alignItems: 'center', gap: spacing.base, marginBottom: spacing.insetPage },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', padding: spacing.insetCard, borderRadius: radius.lg, gap: 2 },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
  theirs: { backgroundColor: colors.surfaceContainerLowest, borderBottomLeftRadius: radius.sm },
  time: { alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.insetCard,
    padding: spacing.insetCard,
    backgroundColor: colors.surfaceContainerLowest,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    ...typography.bodyMd,
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.insetPage,
    paddingVertical: spacing.insetCard,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
