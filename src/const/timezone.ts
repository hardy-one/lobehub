export interface TimezoneOption {
  label: string;
  offset: string;
  value: string;
}

// IANA timezone identifiers are stored in `value` (Drizzle/cron expect the
// underscored form). `label` is the human-readable display (underscores → spaces),
// `offset` renders subtly on the right of each dropdown row, similar to Notion's style.
// Shared by the scheduled-task picker and the general-settings timezone selector.
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { label: 'UTC', offset: 'UTC+0', value: 'UTC' },

  // Americas
  { label: 'America/New York', offset: 'EST/EDT · UTC−5/−4', value: 'America/New_York' },
  { label: 'America/Chicago', offset: 'CST/CDT · UTC−6/−5', value: 'America/Chicago' },
  { label: 'America/Denver', offset: 'MST/MDT · UTC−7/−6', value: 'America/Denver' },
  { label: 'America/Los Angeles', offset: 'PST/PDT · UTC−8/−7', value: 'America/Los_Angeles' },
  { label: 'America/Toronto', offset: 'EST/EDT · UTC−5/−4', value: 'America/Toronto' },
  { label: 'America/Vancouver', offset: 'PST/PDT · UTC−8/−7', value: 'America/Vancouver' },
  { label: 'America/Mexico City', offset: 'CST · UTC−6', value: 'America/Mexico_City' },
  { label: 'America/Sao Paulo', offset: 'BRT · UTC−3', value: 'America/Sao_Paulo' },
  { label: 'America/Buenos Aires', offset: 'ART · UTC−3', value: 'America/Buenos_Aires' },

  // Europe
  { label: 'Europe/London', offset: 'GMT/BST · UTC+0/+1', value: 'Europe/London' },
  { label: 'Europe/Paris', offset: 'CET/CEST · UTC+1/+2', value: 'Europe/Paris' },
  { label: 'Europe/Berlin', offset: 'CET/CEST · UTC+1/+2', value: 'Europe/Berlin' },
  { label: 'Europe/Madrid', offset: 'CET/CEST · UTC+1/+2', value: 'Europe/Madrid' },
  { label: 'Europe/Rome', offset: 'CET/CEST · UTC+1/+2', value: 'Europe/Rome' },
  { label: 'Europe/Amsterdam', offset: 'CET/CEST · UTC+1/+2', value: 'Europe/Amsterdam' },
  { label: 'Europe/Brussels', offset: 'CET/CEST · UTC+1/+2', value: 'Europe/Brussels' },
  { label: 'Europe/Moscow', offset: 'MSK · UTC+3', value: 'Europe/Moscow' },
  { label: 'Europe/Istanbul', offset: 'TRT · UTC+3', value: 'Europe/Istanbul' },

  // Asia
  { label: 'Asia/Dubai', offset: 'GST · UTC+4', value: 'Asia/Dubai' },
  { label: 'Asia/Kolkata', offset: 'IST · UTC+5:30', value: 'Asia/Kolkata' },
  { label: 'Asia/Shanghai', offset: 'CST · UTC+8', value: 'Asia/Shanghai' },
  { label: 'Asia/Hong Kong', offset: 'HKT · UTC+8', value: 'Asia/Hong_Kong' },
  { label: 'Asia/Taipei', offset: 'CST · UTC+8', value: 'Asia/Taipei' },
  { label: 'Asia/Singapore', offset: 'SGT · UTC+8', value: 'Asia/Singapore' },
  { label: 'Asia/Tokyo', offset: 'JST · UTC+9', value: 'Asia/Tokyo' },
  { label: 'Asia/Seoul', offset: 'KST · UTC+9', value: 'Asia/Seoul' },
  { label: 'Asia/Bangkok', offset: 'ICT · UTC+7', value: 'Asia/Bangkok' },
  { label: 'Asia/Jakarta', offset: 'WIB · UTC+7', value: 'Asia/Jakarta' },

  // Oceania
  { label: 'Australia/Sydney', offset: 'AEDT/AEST · UTC+11/+10', value: 'Australia/Sydney' },
  { label: 'Australia/Melbourne', offset: 'AEDT/AEST · UTC+11/+10', value: 'Australia/Melbourne' },
  { label: 'Australia/Brisbane', offset: 'AEST · UTC+10', value: 'Australia/Brisbane' },
  { label: 'Australia/Perth', offset: 'AWST · UTC+8', value: 'Australia/Perth' },
  { label: 'Pacific/Auckland', offset: 'NZDT/NZST · UTC+13/+12', value: 'Pacific/Auckland' },

  // Africa & Middle East
  { label: 'Africa/Cairo', offset: 'EET · UTC+2', value: 'Africa/Cairo' },
  { label: 'Africa/Johannesburg', offset: 'SAST · UTC+2', value: 'Africa/Johannesburg' },
];
