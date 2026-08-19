import React from 'react';
import { Text, View } from 'react-native';

import { SignUpForm } from '@/features/auth/AuthUI';
import { Card, Screen, useTheme } from '@/ui';

export default function SignUpScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  return (
    <Screen title="Create account" scrollable padded testID="sign-up-screen">
      <View style={{ gap: spacing.lg }}>
        <Card>
          <Text style={[typography.h3, { color: colors.text }]}>Private by default</Text>
          <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>
            Your password is hashed in local SQLite. There is no server account or cloud recovery.
          </Text>
        </Card>
        <SignUpForm />
      </View>
    </Screen>
  );
}
