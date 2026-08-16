import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './Text';
import { Icon } from './Icon';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { Loading, ErrorState } from './EmptyState';
import { Alert } from '../services/alert';
import { colors } from '../theme/colors';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/auth';
import { errorMessage } from '../services/api';
import {
  fetchChatThread,
  sendChatMessage,
  markChatThreadRead,
  setChatThreadOpen,
  type ChatThread,
  type ChatMessage,
} from '../services/endpoints';

/** How often to re-read the thread. There is no socket transport; this is it. */
const POLL_MS = 6000;

const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const dayLabel = (iso: string) => {
  const date = new Date(iso);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * The server's `blockedMessage` is written for the patient — it tells the
 * reader to book a follow-up. Shown to the doctor who just closed the thread
 * themselves, it reads as nonsense, so their side gets its own sentence.
 */
const DOCTOR_BLOCKED: Record<string, string> = {
  CLOSED_BY_DOCTOR: 'You closed this conversation.',
  EXPIRED: 'The follow-up window for this consultation has ended.',
  BLOCKED_BY_ADMIN: 'An administrator has blocked this conversation.',
};

const expiryNote = (thread: ChatThread) => {
  if (!thread.canSend) return null;
  const days = Math.ceil((new Date(thread.expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return null;
  return days === 1 ? 'Open for 1 more day' : `Open for ${days} more days`;
};

export interface ChatConversationScreenProps {
  navigation: any;
  /** `route.params.threadId` is required; `title`/`subtitle` avoid a blank header on first paint. */
  route: any;
  role: 'PATIENT' | 'DOCTOR';
}

/**
 * One follow-up conversation, used unchanged by both apps.
 *
 * Which side the reader is on comes from the signed-in user id versus each
 * message's `senderUserId` — not from the `role` prop, which only decides what
 * the header offers. The server resolves party membership from the token, so a
 * wrong `role` here changes the chrome and never the permissions.
 *
 * Whether a message can be sent is the server's `canSend`, never re-derived
 * from the dates: expiry, a doctor closing the thread, and an admin block are
 * three different states with three different sentences, and the server already
 * decided which one applies.
 */
export const ChatConversationScreen: React.FC<ChatConversationScreenProps> = ({
  navigation,
  route,
  role,
}) => {
  const { threadId, title, subtitle } = (route.params ?? {}) as {
    threadId: string;
    title?: string;
    subtitle?: string;
  };
  const { user } = useAuth();

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const mounted = useRef(true);
  // Messages awaiting a server id. Kept out of `thread` so a poll cannot drop them.
  const [pending, setPending] = useState<ChatMessage[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (initial: boolean) => {
      try {
        const next = await fetchChatThread(threadId);
        if (!mounted.current) return;
        setThread(next);
        setError(null);

        // Anything from the other side is now on screen, so it has been read.
        const unread = next.messages.some((m) => m.senderUserId !== user?.id && !m.readAt);
        if (unread) await markChatThreadRead(threadId).catch(() => undefined);
      } catch (err) {
        if (mounted.current && initial) setError(errorMessage(err));
      } finally {
        if (mounted.current && initial) setLoading(false);
      }
    },
    [threadId, user?.id]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  /**
   * Polls only while the app is in the foreground — a backgrounded phone
   * hitting this every six seconds drains battery for messages nobody is
   * looking at.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => void load(false), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    start();
    const sub = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop()
    );

    return () => {
      stop();
      sub.remove();
    };
  }, [load]);

  const messages = React.useMemo(() => {
    const confirmed = thread?.messages ?? [];
    // Drop optimistic copies the server has since echoed back.
    const settled = new Set(confirmed.map((m) => `${m.senderUserId}:${m.body}`));
    return [...confirmed, ...pending.filter((p) => !settled.has(`${p.senderUserId}:${p.body}`))];
  }, [thread?.messages, pending]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !thread?.canSend) return;

    const optimistic: ChatMessage = {
      id: `pending-${Date.now()}`,
      senderUserId: user?.id ?? '',
      body,
      readAt: null,
      createdAt: new Date().toISOString(),
    };

    setPending((prev) => [...prev, optimistic]);
    setDraft('');
    setSending(true);

    try {
      await sendChatMessage(threadId, body);
      await load(false);
      if (mounted.current) setPending((prev) => prev.filter((p) => p.id !== optimistic.id));
    } catch (err) {
      if (!mounted.current) return;
      setPending((prev) => prev.filter((p) => p.id !== optimistic.id));
      // Hand the text back rather than losing what they typed.
      setDraft((current) => (current ? current : body));
      Alert.alert('Not sent', errorMessage(err));
      void load(false);
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  /** Doctor only. The server refuses this for a patient and for a blocked thread. */
  const toggleOpen = () => {
    if (!thread) return;
    const reopening = !thread.canSend;

    Alert.alert(
      reopening ? 'Reopen this conversation?' : 'Close this conversation?',
      reopening
        ? 'The patient will be able to message you again for the follow-up window.'
        : 'The patient will not be able to send new messages until you reopen it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: reopening ? 'Reopen' : 'Close',
          style: reopening ? 'default' : 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await setChatThreadOpen(threadId, reopening);
              await load(false);
            } catch (err) {
              Alert.alert('Could not change it', errorMessage(err));
            } finally {
              if (mounted.current) setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (loading) return <Loading label="Loading conversation" />;
  if (error || !thread) {
    return <ErrorState message={error ?? 'Conversation unavailable.'} onRetry={() => void load(true)} />;
  }

  /**
   * The route param is only a hint so the header is not blank on first paint.
   * Once the thread is loaded it names the other party itself, which is what
   * makes opening this straight from a notification work.
   */
  const counterparty =
    (role === 'DOCTOR' ? thread.patient?.fullName : thread.doctor?.name) ??
    title ??
    (role === 'DOCTOR' ? 'Patient' : 'Your doctor');
  const adminBlocked = thread.blockedBecause === 'BLOCKED_BY_ADMIN';
  const note = expiryNote(thread);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={navigation.goBack} hitSlop={12} accessibilityLabel="Go back">
          <Icon name="arrow_back" size={24} color={colors.primary} />
        </Pressable>

        <Avatar name={counterparty} size={40} tint={role === 'DOCTOR' ? 'info' : 'success'} />

        <View style={styles.headerText}>
          <Text variant="headlineSmMobile" color={colors.headingDark} numberOfLines={1}>
            {counterparty}
          </Text>
          <Text variant="captionSm" color={colors.captionGray} numberOfLines={1}>
            {subtitle ?? (thread.canSend ? (note ?? 'Follow-up chat') : 'Closed')}
          </Text>
        </View>

        {/* Only the doctor may open or close, so only the doctor sees the control. */}
        {role === 'DOCTOR' && !adminBlocked ? (
          <Pressable
            onPress={toggleOpen}
            disabled={busy}
            hitSlop={8}
            style={[styles.stateButton, busy && styles.dim]}
            accessibilityLabel={thread.canSend ? 'Close conversation' : 'Reopen conversation'}
          >
            <Icon
              name={thread.canSend ? 'lock_open' : 'lock'}
              size={20}
              color={thread.canSend ? colors.primary : colors.warningDark}
            />
          </Pressable>
        ) : null}
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
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <View style={styles.notice}>
              <Badge label="Follow-up chat" tint="info" icon="chat" />
              <Text variant="captionSm" color={colors.captionGray} center>
                {role === 'DOCTOR'
                  ? 'Follow-up questions from a patient you have consulted.'
                  : 'Ask about the consultation you just had. For anything urgent, use emergency services.'}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.notice}>
              <Text variant="captionSm" color={colors.captionGray} center>
                No messages yet.
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const mine = item.senderUserId === user?.id;
            const previous = messages[index - 1];
            const showDay =
              !previous || dayLabel(previous.createdAt) !== dayLabel(item.createdAt);

            return (
              <>
                {showDay ? (
                  <Text variant="captionSm" color={colors.captionGray} center style={styles.day}>
                    {dayLabel(item.createdAt)}
                  </Text>
                ) : null}
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                    <Text variant="bodyMd" color={mine ? colors.onPrimary : colors.headingDark}>
                      {item.body}
                    </Text>
                    <View style={styles.meta}>
                      <Text
                        variant="captionSm"
                        color={mine ? colors.onPrimaryContainer : colors.captionGray}
                      >
                        {clockTime(item.createdAt)}
                      </Text>
                      {/* Read state is only meaningful on messages you sent. */}
                      {mine && !item.id.startsWith('pending-') ? (
                        <Icon
                          name={item.readAt ? 'done_all' : 'check'}
                          size={13}
                          color={colors.onPrimaryContainer}
                        />
                      ) : null}
                    </View>
                  </View>
                </View>
              </>
            );
          }}
        />

        {thread.canSend ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message"
              placeholderTextColor={colors.captionGray}
              multiline
              maxLength={2000}
            />
            <Pressable
              onPress={() => void send()}
              disabled={!draft.trim() || sending}
              style={[styles.sendButton, (!draft.trim() || sending) && styles.dim]}
              accessibilityLabel="Send message"
            >
              <Icon name="send" size={20} color={colors.onPrimary} />
            </Pressable>
          </View>
        ) : (
          /*
            The server decided *which* state applies; each side words it for
            its own reader.
          */
          <View style={styles.closed}>
            <Icon name="lock" size={18} color={colors.captionGray} />
            <Text variant="captionSm" color={colors.captionGray} style={styles.flex}>
              {(role === 'DOCTOR' && thread.blockedBecause
                ? DOCTOR_BLOCKED[thread.blockedBecause]
                : thread.blockedMessage) ?? 'This conversation is closed.'}
            </Text>
            {role === 'DOCTOR' && !adminBlocked ? (
              <Pressable onPress={toggleOpen} hitSlop={8}>
                <Text variant="labelMd" weight="semibold" color={colors.primary}>
                  Reopen
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
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
  stateButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: spacing.insetPage, gap: spacing.base },
  notice: { alignItems: 'center', gap: spacing.base, marginBottom: spacing.insetPage },
  day: { marginVertical: spacing.base },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', padding: spacing.insetCard, borderRadius: radius.lg, gap: 2 },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
  theirs: { backgroundColor: colors.surfaceContainerLowest, borderBottomLeftRadius: radius.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
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
  dim: { opacity: 0.4 },
  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    padding: spacing.insetPage,
    backgroundColor: colors.surfaceContainerLowest,
  },
});
