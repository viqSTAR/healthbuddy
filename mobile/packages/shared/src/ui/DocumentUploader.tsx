import React, { useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Text } from './Text';
import { Icon } from './Icon';
import { Badge } from './Badge';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/typography';
import { errorMessage } from '../services/api';
// Relative, not '@healthbuddy/shared': this file IS the shared package.
import { Alert } from '../services/alert';
import {
  uploadDocument,
  deleteDocument,
  type DocumentKind,
  type DocumentRef,
} from '../services/endpoints';

export interface DocumentUploaderProps {
  label: string;
  hint?: string;
  kind: DocumentKind;
  applicationId?: string;
  labOrderId?: string;
  /** Documents already attached, filtered to this `kind` by the caller. */
  documents: DocumentRef[];
  onChange: () => void;
  required?: boolean;
  /** Locks the control once an application has been submitted or approved. */
  disabled?: boolean;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Attaches a licence or certificate to an application.
 *
 * Offers camera and file paths because partners typically hold a paper licence
 * — photographing it is the realistic route, while a PDF is what an accountant
 * would send. Uploaded files are private: they are addressed by id and only
 * ever served through an authorisation check.
 */
export const DocumentUploader: React.FC<DocumentUploaderProps> = ({
  label,
  hint,
  kind,
  applicationId,
  labOrderId,
  documents,
  onChange,
  required,
  disabled,
}) => {
  const [busy, setBusy] = useState(false);

  const send = async (file: { uri: string; name: string; mimeType: string }) => {
    setBusy(true);
    try {
      await uploadDocument(file, kind, { applicationId, labOrderId });
      onChange();
    } catch (err) {
      Alert.alert('Upload failed', errorMessage(err, 'Could not upload that file.'));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;

      await send({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      });
    } catch (err) {
      Alert.alert('Could not open the picker', errorMessage(err));
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera unavailable', 'Allow camera access to photograph the document.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;

      await send({
        uri: asset.uri,
        name: asset.fileName ?? `${kind.toLowerCase()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
    } catch (err) {
      // Without this the picker rejects into nothing and the button looks dead.
      Alert.alert('Camera unavailable', errorMessage(err, 'Could not open the camera.'));
    }
  };

  const remove = (doc: DocumentRef) => {
    Alert.alert('Remove document', `Remove ${doc.fileName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDocument(doc.id);
            onChange();
          } catch (err) {
            Alert.alert('Could not remove', errorMessage(err));
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text variant="labelMd" weight="semibold" color={colors.onSurface}>
          {label}
          {required ? <Text color={colors.error}> *</Text> : null}
        </Text>
        {documents.length > 0 ? <Badge label="Attached" tint="success" icon="check" /> : null}
      </View>

      {hint ? (
        <Text variant="captionSm" color={colors.captionGray}>
          {hint}
        </Text>
      ) : null}

      {documents.map((doc) => (
        <View key={doc.id} style={styles.file}>
          <Icon
            name={doc.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'}
            size={20}
            color={colors.primary}
          />
          <View style={styles.fileBody}>
            <Text variant="labelMd" numberOfLines={1} color={colors.onSurface}>
              {doc.fileName}
            </Text>
            <Text variant="captionSm" color={colors.captionGray}>
              {formatSize(doc.sizeBytes)}
            </Text>
          </View>
          {!disabled ? (
            <Pressable onPress={() => remove(doc)} hitSlop={10} accessibilityLabel="Remove document">
              <Icon name="close" size={18} color={colors.captionGray} />
            </Pressable>
          ) : null}
        </View>
      ))}

      {!disabled ? (
        <View style={styles.actions}>
          {/*
            Hidden on web: a desktop browser has no camera roll, and
            launchCameraAsync there either does nothing or errors. Offering a
            button that cannot work is worse than not offering it — "Choose
            file" already covers photographing on a phone and attaching it.
          */}
          {Platform.OS !== 'web' ? (
            <Pressable
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              onPress={takePhoto}
              disabled={busy}
            >
              <Icon name="photo_camera" size={18} color={colors.primary} />
              <Text variant="labelMd" weight="semibold" color={colors.primary}>
                {busy ? 'Uploading…' : 'Camera'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            onPress={pickFile}
            disabled={busy}
          >
            <Icon name="upload_file" size={18} color={colors.primary} />
            <Text variant="labelMd" weight="semibold" color={colors.primary}>
              {busy ? 'Uploading…' : 'Choose file'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.base,
    padding: spacing.insetCard,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.insetCard,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceContainerLow,
  },
  fileBody: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.insetCard },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.stackMedium,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLow,
  },
  pressed: { opacity: 0.75 },
});
