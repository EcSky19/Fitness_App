import React from 'react';
import { Text, View } from 'react-native';

import { ForgotPasswordForm } from '@/features/auth/AuthUI';
import { Card, Screen, useTheme } from '@/ui';

export default function ForgotPasswordScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  return (
    <Screen title="Reset password" scrollable padded testID="forgot-password-screen">
      <View style={{ gap: spacing.lg }}>
        <Card>
          <Text style={[typography.h3, { color: colors.text }]}>Offline recovery</Text>
          <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>
            Answer the security question saved with this local account to choose a new password.
          </Text>
        </Card>
        <ForgotPasswordForm />
      </View>
    </Screen>
  );
}
