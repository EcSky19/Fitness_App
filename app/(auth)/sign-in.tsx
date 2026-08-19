import React from 'react';
import { Text, View } from 'react-native';

import { SignInForm } from '@/features/auth/AuthUI';
import { Card, Screen, useTheme } from '@/ui';

export default function SignInScreen(): React.JSX.Element {
  const { colors, spacing, typography } = useTheme();

  return (
    <Screen title="Welcome back" scrollable padded testID="sign-in-screen">
      <View style={{ gap: spacing.lg }}>
        <Card>
          <Text style={[typography.h3, { color: colors.text }]}>Sign in to MacroTrack</Text>
          <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>
            Accounts are stored only on this device. Your food, weight and goals stay offline.
          </Text>
        </Card>
        <SignInForm />
      </View>
    </Screen>
  );
}
