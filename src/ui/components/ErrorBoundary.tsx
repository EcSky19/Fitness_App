import React, { type ErrorInfo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  showDetails: boolean;
}

const INITIAL_STATE: ErrorBoundaryState = {
  error: null,
  componentStack: '',
  showDetails: false,
};

/** Catches render crashes and offers a safe recovery UI. */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = INITIAL_STATE;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, showDetails: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? '' });
  }

  private handleReset = (): void => {
    this.props.onReset?.();
    this.setState(INITIAL_STATE);
  };

  private handleToggleDetails = (): void => {
    this.setState((state) => ({ showDetails: !state.showDetails }));
  };

  render(): React.ReactNode {
    const { error, componentStack, showDetails } = this.state;

    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }

    const details = [error.message, componentStack].filter((part) => part.length > 0).join('\n\n');

    return (
      <View testID="error-boundary-fallback" style={styles.container}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            Sorry, something went wrong.
          </Text>
          <Text style={styles.message}>
            We hit an unexpected problem. You can try again now, or copy the technical details for a
            bug report.
          </Text>

          <Pressable
            testID="error-boundary-retry"
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={this.handleReset}
            style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>

          <Pressable
            testID="error-boundary-details-toggle"
            accessibilityRole="button"
            accessibilityLabel={showDetails ? 'Hide technical details' : 'Show technical details'}
            onPress={this.handleToggleDetails}
            style={({ pressed }) => [styles.detailsToggle, pressed ? styles.pressed : null]}
          >
            <Text style={styles.detailsToggleText}>
              {showDetails ? 'Hide technical details' : 'Show technical details'}
            </Text>
          </Pressable>

          {showDetails ? (
            <ScrollView testID="error-boundary-details" style={styles.detailsBox}>
              <Text selectable style={styles.detailsText}>
                {details || 'No technical details were provided.'}
              </Text>
            </ScrollView>
          ) : null}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D1D5DB',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 520,
    padding: 24,
    width: '100%',
  },
  container: {
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  detailsBox: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 180,
    padding: 12,
  },
  detailsText: {
    color: '#374151',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  detailsToggle: {
    alignSelf: 'center',
    marginBottom: 16,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  detailsToggleText: {
    color: '#1D4ED8',
    fontSize: 15,
    fontWeight: '700',
  },
  message: {
    color: '#4B5563',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
  retryButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  title: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    marginBottom: 10,
    textAlign: 'center',
  },
});

export default ErrorBoundary;
