import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Button, Card, Divider, ListRow, SectionHeader, Sheet, TextField, useTheme } from '@/ui';
import {
  INVALID_CREDENTIALS_MESSAGE,
  changePassword,
  deleteCurrentAccount,
  lockRemainingMs,
  normalizeEmail,
  resetPasswordWithSecurityAnswer,
} from '@/services/auth';
import { validateEmail, validatePassword, type PasswordScore } from '@/services/auth/password';
import { useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store/appStore';
import type { Account } from '@/types';

const CONFIRM_DELETE = 'DELETE';

const SCORE_LABELS: Record<PasswordScore, string> = {
  0: 'Very weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Excellent',
};

function authDestination(): '/onboarding' | '/(tabs)' {
  const profile = useAppStore.getState().profile;
  return !profile || profile.onboardedAt == null ? '/onboarding' : '/(tabs)';
}

function formatLockout(email: string): string | null {
  const ms = lockRemainingMs(email);
  if (ms <= 0) return null;
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

export function PasswordField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  helper,
  testID,
  autoComplete,
  textContentType,
  keyboardType,
  returnKeyType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  helper?: string;
  testID?: string;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  keyboardType?: KeyboardTypeOptions;
  returnKeyType?: TextInputProps['returnKeyType'];
}): React.JSX.Element {
  const { colors, spacing, typography, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View>
      <Text style={[typography.label, { color: colors.textMuted, marginBottom: spacing.xs }]}>
        {label}
      </Text>
      <View
        style={[
          styles.passwordField,
          { backgroundColor: colors.surfaceAlt, borderColor, borderRadius: radius.md },
        ]}
      >
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={autoComplete}
          textContentType={textContentType}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[typography.body, styles.passwordInput, { color: colors.text }]}
        />
      </View>
      {error ? (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[typography.caption, { color: colors.textFaint, marginTop: spacing.xs }]}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export function PasswordStrength({ password }: { password: string }): React.JSX.Element | null {
  const { colors, spacing, typography } = useTheme();
  if (!password) return null;
  const check = validatePassword(password);
  const bars = [0, 1, 2, 3];
  const tone =
    check.score >= 3 ? colors.success : check.score >= 2 ? colors.warning : colors.danger;

  return (
    <View testID="password-strength">
      <View style={[styles.strengthBars, { gap: spacing.xs }]}>
        {bars.map((bar) => (
          <View
            key={bar}
            style={[
              styles.strengthBar,
              { backgroundColor: bar < check.score ? tone : colors.surfaceAlt },
            ]}
          />
        ))}
      </View>
      <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>
        {`Password strength: ${SCORE_LABELS[check.score]}`}
      </Text>
      {check.problems.map((problem) => (
        <Text key={problem} style={[typography.caption, { color: colors.danger }]}>
          {problem}
        </Text>
      ))}
    </View>
  );
}

export function AccountSwitcherSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const accounts = useAuthStore((s) => s.accounts);
  const session = useAuthStore((s) => s.session);
  const switchAccount = useAuthStore((s) => s.switchAccount);
  const refreshAccounts = useAuthStore((s) => s.refreshAccounts);
  const [selected, setSelected] = useState<Account | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    void refreshAccounts();
  }, [refreshAccounts, visible]);

  const handleSwitch = useCallback(async () => {
    if (!selected || submitRef.current) return;
    submitRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await switchAccount(selected.id, password);
      if (!result.ok) {
        setError(result.code === 'invalid_credentials' ? INVALID_CREDENTIALS_MESSAGE : result.error ?? 'Could not switch account.');
        return;
      }
      setPassword('');
      setSelected(null);
      onClose();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(authDestination());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch account.');
    } finally {
      submitRef.current = false;
      setBusy(false);
    }
  }, [onClose, password, router, selected, switchAccount]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Switch account">
      <View style={{ gap: spacing.md }} testID="account-switcher-sheet">
        {accounts.length === 0 ? (
          <Text style={[typography.body, { color: colors.textMuted }]}>
            No local accounts are saved on this device yet.
          </Text>
        ) : (
          <Card padded={false}>
            {accounts.map((account, index) => (
              <View key={account.id}>
                {index > 0 ? <Divider /> : null}
                <ListRow
                  title={account.displayName}
                  subtitle={account.email}
                  meta={account.id === session?.accountId ? 'Current' : undefined}
                  leftIcon="person-circle-outline"
                  onPress={() => {
                    setSelected(account);
                    setError(null);
                  }}
                  testID={`switch-account-${index}`}
                />
              </View>
            ))}
          </Card>
        )}
        {selected ? (
          <View style={{ gap: spacing.md }}>
            <Text style={[typography.body, { color: colors.textMuted }]}>
              {`Enter the password for ${selected.displayName}.`}
            </Text>
            <PasswordField
              label="Password"
              value={password}
              onChangeText={setPassword}
              autoComplete="current-password"
              textContentType="password"
              error={error ?? undefined}
              testID="switch-password"
            />
            <Button
              title="Switch account"
              onPress={() => void handleSwitch()}
              disabled={password.length === 0}
              loading={busy}
              fullWidth
              testID="switch-submit"
            />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

export function SignInForm(): React.JSX.Element {
  const router = useRouter();
  const { spacing, typography, colors } = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const clearError = useAuthStore((s) => s.clearError);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const submitRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    if (submitRef.current) return;
    const normalized = normalizeEmail(email);
    if (!validateEmail(normalized)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!password) {
      setError(INVALID_CREDENTIALS_MESSAGE);
      return;
    }
    submitRef.current = true;
    setBusy(true);
    setError(null);
    clearError();
    try {
      const result = await signIn({ email: normalized, password });
      if (!result.ok) {
        setError(
          result.code === 'invalid_credentials'
            ? INVALID_CREDENTIALS_MESSAGE
            : formatLockout(normalized) ?? result.error ?? 'Could not sign in.'
        );
        return;
      }
      setPassword('');
      router.replace(authDestination());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      submitRef.current = false;
      setBusy(false);
    }
  }, [clearError, email, password, router, signIn]);

  return (
    <View style={{ gap: spacing.lg }}>
      <TextField
        label="Email"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setError(null);
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="you@example.com"
        testID="sign-in-email"
      />
      <PasswordField
        label="Password"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setError(null);
        }}
        autoComplete="current-password"
        textContentType="password"
        error={error ?? undefined}
        testID="sign-in-password"
      />
      <Button
        title="Sign in"
        onPress={() => void handleSubmit()}
        loading={busy}
        fullWidth
        testID="sign-in-submit"
      />
      <View style={{ gap: spacing.sm }}>
        <Text
          style={[typography.label, { color: colors.primary }]}
          onPress={() => router.push('/(auth)/forgot-password')}
          accessibilityRole="link"
          testID="forgot-password-link"
        >
          Forgot password?
        </Text>
        <Text
          style={[typography.label, { color: colors.primary }]}
          onPress={() => setSwitchOpen(true)}
          accessibilityRole="button"
          testID="open-switcher"
        >
          Switch local account
        </Text>
        <Text
          style={[typography.label, { color: colors.primary }]}
          onPress={() => router.push('/(auth)/sign-up')}
          accessibilityRole="link"
          testID="create-account-link"
        >
          Create an account
        </Text>
      </View>
      <AccountSwitcherSheet visible={switchOpen} onClose={() => setSwitchOpen(false)} />
    </View>
  );
}

export function SignUpForm(): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const signUp = useAuthStore((s) => s.signUp);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitRef = useRef(false);

  const passwordCheck = useMemo(() => validatePassword(password), [password]);

  const handleSubmit = useCallback(async () => {
    if (submitRef.current) return;
    const normalized = normalizeEmail(email);
    if (!validateEmail(normalized)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!displayName.trim()) {
      setError('Enter your name.');
      return;
    }
    if (!passwordCheck.ok) {
      setError(passwordCheck.problems[0] ?? 'Choose a stronger password.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if ((securityQuestion.trim() || securityAnswer.trim()) && (!securityQuestion.trim() || !securityAnswer.trim())) {
      setError('Enter both a security question and answer, or leave both blank.');
      return;
    }
    submitRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await signUp({
        email: normalized,
        password,
        displayName: displayName.trim(),
        securityQuestion: securityQuestion.trim() || undefined,
        securityAnswer: securityAnswer.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not create account.');
        return;
      }
      setPassword('');
      setConfirm('');
      setSecurityAnswer('');
      router.replace(authDestination());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.');
    } finally {
      submitRef.current = false;
      setBusy(false);
    }
  }, [
    confirm,
    displayName,
    email,
    password,
    passwordCheck.ok,
    passwordCheck.problems,
    router,
    securityAnswer,
    securityQuestion,
    signUp,
  ]);

  return (
    <View style={{ gap: spacing.lg }}>
      <TextField
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Alex"
        error={error?.includes('name') ? error : undefined}
        testID="sign-up-name"
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="you@example.com"
        error={error?.includes('email') ? error : undefined}
        testID="sign-up-email"
      />
      <PasswordField
        label="Password"
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        textContentType="newPassword"
        error={error && !error.includes('email') && !error.includes('name') ? error : undefined}
        testID="sign-up-password"
      />
      <PasswordStrength password={password} />
      <PasswordField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        autoComplete="new-password"
        textContentType="newPassword"
        testID="sign-up-confirm"
      />
      <Card>
        <Text style={[typography.title, { color: colors.text }]}>Offline password recovery</Text>
        <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.sm }]}>
          MacroTrack has no server. A security question is the only way to recover this account
          offline. If you skip it and forget your password, that account's data is permanently lost.
        </Text>
        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <TextField
            label="Security question (optional)"
            value={securityQuestion}
            onChangeText={setSecurityQuestion}
            placeholder="What was your first pet's name?"
            testID="security-question"
          />
          <PasswordField
            label="Security answer (optional)"
            value={securityAnswer}
            onChangeText={setSecurityAnswer}
            autoComplete="off"
            textContentType="none"
            testID="security-answer"
          />
        </View>
      </Card>
      <Button
        title="Create account"
        onPress={() => void handleSubmit()}
        loading={busy}
        fullWidth
        testID="sign-up-submit"
      />
      <Button
        title="I already have an account"
        variant="ghost"
        onPress={() => router.replace('/(auth)/sign-in')}
        testID="sign-up-to-sign-in"
      />
    </View>
  );
}

export function ForgotPasswordForm(): React.JSX.Element {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const accounts = useAuthStore((s) => s.accounts);
  const refreshAccounts = useAuthStore((s) => s.refreshAccounts);
  const [email, setEmail] = useState('');
  const [answer, setAnswer] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitRef = useRef(false);
  const passwordCheck = useMemo(() => validatePassword(password), [password]);
  const account = accounts.find((a) => a.email === normalizeEmail(email));

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  const handleReset = useCallback(async () => {
    if (submitRef.current) return;
    const normalized = normalizeEmail(email);
    if (!validateEmail(normalized)) {
      setMessage('Enter a valid email address.');
      return;
    }
    if (!passwordCheck.ok) {
      setMessage(passwordCheck.problems[0] ?? 'Choose a stronger password.');
      return;
    }
    if (password !== confirm) {
      setMessage('Passwords do not match.');
      return;
    }
    submitRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await resetPasswordWithSecurityAnswer({
        email: normalized,
        securityAnswer: answer,
        newPassword: password,
      });
      if (!result.ok) {
        setMessage(formatLockout(normalized) ?? result.error ?? 'Could not reset password.');
        return;
      }
      setAnswer('');
      setPassword('');
      setConfirm('');
      Alert.alert('Password changed', 'Sign in with your new password.');
      router.replace('/(auth)/sign-in');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reset password.');
    } finally {
      submitRef.current = false;
      setBusy(false);
    }
  }, [answer, confirm, email, password, passwordCheck.ok, passwordCheck.problems, router]);

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={[typography.body, { color: colors.textMuted }]}>
        Recovery works only for local accounts that saved a security question.
      </Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        testID="recovery-email"
      />
      {account?.securityQuestion ? (
        <Card testID="security-question-card">
          <Text style={[typography.label, { color: colors.textMuted }]}>Security question</Text>
          <Text style={[typography.body, { color: colors.text, marginTop: spacing.xs }]}>
            {account.securityQuestion}
          </Text>
        </Card>
      ) : null}
      <PasswordField
        label="Security answer"
        value={answer}
        onChangeText={setAnswer}
        autoComplete="off"
        textContentType="none"
        testID="recovery-answer"
      />
      <PasswordField
        label="New password"
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        textContentType="newPassword"
        testID="recovery-password"
      />
      <PasswordStrength password={password} />
      <PasswordField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        autoComplete="new-password"
        textContentType="newPassword"
        testID="recovery-confirm"
      />
      {message ? <Text style={[typography.caption, { color: colors.danger }]}>{message}</Text> : null}
      <Button
        title="Reset password"
        onPress={() => void handleReset()}
        loading={busy}
        fullWidth
        testID="recovery-submit"
      />
    </View>
  );
}

export function AccountSection(): React.JSX.Element | null {
  const router = useRouter();
  const { colors, spacing, typography } = useTheme();
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [sheetError, setSheetError] = useState<string | null>(null);
  const submitRef = useRef(false);

  const handleSignOut = useCallback(async () => {
    if (submitRef.current) return;
    submitRef.current = true;
    setBusy('signout');
    try {
      await signOut();
      router.replace('/(auth)/sign-in');
    } finally {
      submitRef.current = false;
      setBusy(null);
    }
  }, [router, signOut]);

  const handleChangePassword = useCallback(async () => {
    if (submitRef.current) return;
    const check = validatePassword(newPassword);
    if (!check.ok) {
      setSheetError(check.problems[0] ?? 'Choose a stronger password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSheetError('Passwords do not match.');
      return;
    }
    submitRef.current = true;
    setBusy('password');
    setSheetError(null);
    try {
      const result = await changePassword({ currentPassword, newPassword });
      if (!result.ok) {
        setSheetError(result.code === 'invalid_credentials' ? INVALID_CREDENTIALS_MESSAGE : result.error ?? 'Could not change password.');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordOpen(false);
      Alert.alert('Password changed', 'Use the new password next time you sign in.');
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      submitRef.current = false;
      setBusy(null);
    }
  }, [confirmPassword, currentPassword, newPassword]);

  const handleDelete = useCallback(async () => {
    if (submitRef.current || deleteConfirm.trim().toUpperCase() !== CONFIRM_DELETE) return;
    submitRef.current = true;
    setBusy('delete');
    setSheetError(null);
    try {
      const result = await deleteCurrentAccount(deletePassword);
      if (!result.ok) {
        setSheetError(result.code === 'invalid_credentials' ? INVALID_CREDENTIALS_MESSAGE : result.error ?? 'Could not delete account.');
        return;
      }
      setDeletePassword('');
      setDeleteConfirm('');
      setDeleteOpen(false);
      await useAuthStore.getState().signOut();
      router.replace('/(auth)/sign-in');
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : 'Could not delete account.');
    } finally {
      submitRef.current = false;
      setBusy(null);
    }
  }, [deleteConfirm, deletePassword, router]);

  if (!session) return null;

  return (
    <>
      <SectionHeader title="Account" />
      <Card padded={false} testID="account-section">
        <ListRow
          title={session.displayName}
          subtitle={session.email}
          leftIcon="person-circle-outline"
          testID="account-current"
        />
        <Divider />
        <ListRow
          title="Switch account"
          subtitle="Use another local account on this device."
          leftIcon="people-outline"
          onPress={() => setSwitchOpen(true)}
          testID="account-switch"
        />
        <Divider />
        <ListRow
          title="Change password"
          subtitle="Requires your current password."
          leftIcon="key-outline"
          onPress={() => {
            setSheetError(null);
            setPasswordOpen(true);
          }}
          testID="account-change-password"
        />
        <Divider />
        <ListRow
          title="Sign out"
          subtitle="Return to the sign-in screen."
          leftIcon="log-out-outline"
          onPress={() => void handleSignOut()}
          testID="account-sign-out"
        />
        <Divider />
        <ListRow
          title="Delete account"
          subtitle="Permanently deletes this account's entire history."
          leftIcon="trash-outline"
          leftColor={colors.danger}
          destructive
          onPress={() => {
            setSheetError(null);
            setDeleteOpen(true);
          }}
          testID="account-delete"
        />
      </Card>

      <AccountSwitcherSheet visible={switchOpen} onClose={() => setSwitchOpen(false)} />

      <Sheet visible={passwordOpen} onClose={() => setPasswordOpen(false)} title="Change password">
        <View style={{ gap: spacing.md }} testID="change-password-sheet">
          <PasswordField
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            autoComplete="current-password"
            textContentType="password"
            testID="change-current-password"
          />
          <PasswordField
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            testID="change-new-password"
          />
          <PasswordStrength password={newPassword} />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            testID="change-confirm-password"
          />
          {sheetError ? <Text style={[typography.caption, { color: colors.danger }]}>{sheetError}</Text> : null}
          <Button
            title="Save new password"
            onPress={() => void handleChangePassword()}
            loading={busy === 'password'}
            fullWidth
            testID="change-password-submit"
          />
        </View>
      </Sheet>

      <Sheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete account">
        <View style={{ gap: spacing.md }} testID="delete-account-sheet">
          <Text style={[typography.body, { color: colors.danger }]}>
            This permanently deletes this account's profile, goals, meals, foods, weigh-ins,
            workouts, settings and recovery data from this device.
          </Text>
          <PasswordField
            label="Password"
            value={deletePassword}
            onChangeText={setDeletePassword}
            autoComplete="current-password"
            textContentType="password"
            testID="delete-password"
          />
          <TextField
            label={`Type ${CONFIRM_DELETE}`}
            value={deleteConfirm}
            onChangeText={setDeleteConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="delete-confirm-word"
          />
          {sheetError ? <Text style={[typography.caption, { color: colors.danger }]}>{sheetError}</Text> : null}
          <Button
            title="Delete this account"
            variant="danger"
            onPress={() => void handleDelete()}
            disabled={deleteConfirm.trim().toUpperCase() !== CONFIRM_DELETE}
            loading={busy === 'delete'}
            fullWidth
            testID="delete-account-submit"
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  passwordField: {
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 8,
  },
  strengthBar: {
    borderRadius: 3,
    flex: 1,
    height: 6,
  },
  strengthBars: {
    flexDirection: 'row',
  },
});
