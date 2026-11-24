import { parseCronWeekdays } from '@lobechat/utils/cronEval';
import { type Dayjs } from 'dayjs';

export type ScheduleType = 'daily' | 'hourly' | 'weekly';

export const SCHEDULE_TYPE_OPTIONS = [
  { label: 'taskSchedule.scheduleType.daily', value: 'daily' },
  { label: 'taskSchedule.scheduleType.hourly', value: 'hourly' },
  { label: 'taskSchedule.scheduleType.weekly', value: 'weekly' },
] as const;

// The option list itself lives in `@/const/timezone` so the scheduled-task
// picker and the general-settings timezone selector share one source.
export { TIMEZONE_OPTIONS, type TimezoneOption } from '@/const/timezone';

export const WEEKDAYS = [
  { key: 1, label: 'taskSchedule.weekdays.mon' },
  { key: 2, label: 'taskSchedule.weekdays.tue' },
  { key: 3, label: 'taskSchedule.weekdays.wed' },
  { key: 4, label: 'taskSchedule.weekdays.thu' },
  { key: 5, label: 'taskSchedule.weekdays.fri' },
  { key: 6, label: 'taskSchedule.weekdays.sat' },
  { key: 0, label: 'taskSchedule.weekdays.sun' },
] as const;

/** Minutes every plan can pick; any other exact minute is the gated custom time. */
export const STANDARD_MINUTES = [0, 30] as const;

/**
 * The minutes a picker offers. Without custom-time access it stays on the
 * standard ones plus the value already stored, so a schedule set before a
 * downgrade (or by an agent) still reads back as it runs.
 */
export const getMinuteChoices = (canUseCustomMinute: boolean, currentMinute: number): number[] => {
  if (canUseCustomMinute) return Array.from({ length: 60 }, (_, minute) => minute);

  return [...new Set<number>([...STANDARD_MINUTES, currentMinute])].sort((a, b) => a - b);
};

/**
 * Parse cron pattern (minute hour day month weekday) into editable schedule info.
 */
export const parseCronPattern = (
  cronPattern: string,
): {
  hourlyInterval?: number;
  scheduleType: ScheduleType;
  triggerHour: number;
  triggerMinute: number;
  weekdays?: number[];
} => {
  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { scheduleType: 'daily', triggerHour: 0, triggerMinute: 0 };
  }

  const [minute, hour, , , weekday] = parts;
  const rawMinute = minute === '*' ? 0 : Number.parseInt(minute);
  // Interval minutes such as `*/15` pin no clock minute.
  const triggerMinute = Number.isNaN(rawMinute) ? 0 : rawMinute;

  if (hour.startsWith('*/')) {
    const interval = Number.parseInt(hour.slice(2));
    return { hourlyInterval: interval, scheduleType: 'hourly', triggerHour: 0, triggerMinute };
  }
  if (hour === '*') {
    return { hourlyInterval: 1, scheduleType: 'hourly', triggerHour: 0, triggerMinute };
  }

  const triggerHour = Number.parseInt(hour);

  if (weekday !== '*') {
    return {
      scheduleType: 'weekly',
      triggerHour,
      triggerMinute,
      weekdays: parseCronWeekdays(cronPattern),
    };
  }

  return { scheduleType: 'daily', triggerHour, triggerMinute };
};

/**
 * Replace a single field in a standard 5-field cron expression while preserving
 * all other fields (for example, weekday qualifiers such as `FRI#2` or `5L`).
 * Returns `null` when the pattern is not a 5-field expression.
 */
export const updateCronPatternField = (
  cronPattern: string,
  fieldIndex: 0 | 1 | 2 | 3 | 4,
  value: string,
): string | null => {
  const parts = cronPattern.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  parts[fieldIndex] = value;
  return parts.join(' ');
};

/**
 * Build cron pattern (minute hour day month weekday) from editable schedule info.
 */
export const buildCronPattern = (
  scheduleType: ScheduleType,
  triggerTime: Dayjs,
  hourlyInterval?: number,
  weekdays?: number[],
): string => {
  const minute = triggerTime.minute();
  const hour = triggerTime.hour();

  switch (scheduleType) {
    case 'hourly': {
      const interval = hourlyInterval || 1;
      if (interval === 1) return `${minute} * * * *`;
      return `${minute} */${interval} * * *`;
    }
    case 'daily': {
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const days =
        weekdays && weekdays.length > 0
          ? [...weekdays].sort((a, b) => a - b).join(',')
          : '0,1,2,3,4,5,6';
      return `${minute} ${hour} * * ${days}`;
    }
  }
};
