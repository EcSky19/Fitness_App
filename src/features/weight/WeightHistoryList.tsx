/**
 * Weigh-in history grouped by month, with per-entry deltas.
 * Tap a row to edit it, long-press to delete it.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import * as Haptics from 'expo-haptics';

import { deleteWeightLog } from '@/db/repositories';
import { formatDateLabel } from '@/domain';
import { useAppStore } from '@/store/appStore';
import { Badge, Button, Divider, ListRow, SectionHeader, useTheme } from '@/ui';
import type { WeightLog, WeightUnit } from '@/types';

import { deltaTone, groupByMonth, toneColor } from './useWeightHistory';
import { EM_DASH, formatDelta, formatKg } from './weightFormat';

/** Rows rendered before the "Show all" affordance appears. */
export const HISTORY_PAGE_SIZE = 100;

export interface WeightHistoryListProps {
  /** Every log, oldest first. */
  logs: WeightLog[];
  unit: WeightUnit;
  goalKg: number | null;
  onEdit: (log: WeightLog) => void;
  /** Called after a successful delete. */
  onDeleted?: (log: WeightLog) => void;
}

function sourceLabel(source: WeightLog['source']): string | null {
  if (source === 'healthkit') return 'Apple Health';
  if (source === 'health_connect') return 'Health Connect';
  return null;
}

export function WeightHistoryList({
  logs,
  unit,
  goalKg,
  onEdit,
  onDeleted,
}: WeightHistoryListProps): React.JSX.Element | null {
  const { colors, spacing, typography } = useTheme();
  const invalidate = useAppStore((state) => state.invalidate);
  const [showAll, setShowAll] = useState(false);

  /** Delta against the previous (older) weigh-in, computed over the full list. */
  const deltaById = useMemo(() => {
    const map = new Map<string, number | null>();
    logs.forEach((log, index) => {
      map.set(log.id, index === 0 ? null : log.weightKg - logs[index - 1].weightKg);
    });
    return map;
  }, [logs]);

  const descending = useMemo(() => [...logs].reverse(), [logs]);
  const visible = showAll ? descending : descending.slice(0, HISTORY_PAGE_SIZE);
  const sections = useMemo(() => groupByMonth(visible), [visible]);
  const hidden = descending.length - visible.length;

  const remove = useCallback(
    async (log: WeightLog) => {
      try {
        await deleteWeightLog(log.id);
        invalidate();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onDeleted?.(log);
      } catch (error) {
        console.warn('[WeightHistoryList] delete failed', error);
      }
    },
    [invalidate, onDeleted]
  );

  const confirmDelete = useCallback(
    (log: WeightLog) => {
      Alert.alert(
        'Delete weigh-in',
        `Delete ${formatKg(log.weightKg, unit)} logged on ${formatDateLabel(log.date)}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void remove(log) },
        ]
      );
    },
    [remove, unit]
  );

  if (logs.length === 0) return null;

  return (
    <View testID="weight-history-list">
      {sections.map((section) => (
        <View key={section.key}>
          <SectionHeader title={section.label} />
          {section.logs.map((log, index) => {
            const delta = deltaById.get(log.id) ?? null;
            const tone = toneColor(deltaTone(delta, goalKg, log.weightKg), colors);
            const badge = sourceLabel(log.source);
            const details = [
              formatDateLabel(log.date),
              log.bodyFatPct != null ? `${log.bodyFatPct}% body fat` : null,
              log.note,
            ]
              .filter((part): part is string => Boolean(part))
              .join(' \u00b7 ');

            return (
              <View key={log.id}>
                <ListRow
                  title={formatKg(log.weightKg, unit)}
                  subtitle={details}
                  leftIcon="scale-outline"
                  leftColor={colors.primary}
                  onPress={() => onEdit(log)}
                  onLongPress={() => confirmDelete(log)}
                  right={
                    <View style={styles.right}>
                      <Text
                        testID={`weight-delta-${log.id}`}
                        accessibilityLabel={`Change ${delta == null ? 'unknown' : formatDelta(delta, unit)}`}
                        style={[typography.label, { color: tone }]}
                      >
                        {delta == null ? EM_DASH : formatDelta(delta, unit)}
                      </Text>
                      {badge ? <Badge label={badge} tone="primary" /> : null}
                    </View>
                  }
                />
                {index < section.logs.length - 1 ? <Divider /> : null}
              </View>
            );
          })}
        </View>
      ))}

      {hidden > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          <Button
            title={`Show all ${descending.length} weigh-ins`}
            variant="secondary"
            size="sm"
            onPress={() => setShowAll(true)}
            fullWidth
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  right: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
});

export default WeightHistoryList;
