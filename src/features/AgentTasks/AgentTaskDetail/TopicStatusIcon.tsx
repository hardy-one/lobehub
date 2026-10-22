import { createStaticStyles, cssVar, Icon, keyframes } from '@lobehub/ui';
import { CircleAlert } from 'lucide-react';
import { memo } from 'react';

import { EXECUTION_STATUS_VISUALS, type ExecutionStatusVisual } from '@/components/ExecutionStatus';

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const styles = createStaticStyles(({ css }) => ({
  // The animation lives on the wrapping span, never on the svg: Blink refuses
  // to composite transform animations on SVG elements once the effective zoom
  // is > 1 (device pixel ratio scaling), so an svg-level spin costs a full
  // style-recalc pass over the whole document every frame (~60/s measured
  // on-device with several running icons mounted). An HTML wrapper composites
  // for free. The track and center dot are rotation-symmetric, so spinning
  // the whole icon is equivalent.
  running: css`
    display: inline-flex;
    flex: none;
    line-height: 1;
    animation: ${spin} 1s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

type TopicRunStatus =
  | 'canceled'
  | 'completed'
  | 'device_offline'
  | 'failed'
  | 'pending'
  | 'quota_limited'
  | 'running'
  | 'timeout'
  | 'transient_failed';

const STATIC_META: Record<Exclude<TopicRunStatus, 'running'>, ExecutionStatusVisual> = {
  canceled: EXECUTION_STATUS_VISUALS.canceled,
  completed: EXECUTION_STATUS_VISUALS.completed,
  // The run's device was unavailable; it is retried, not failed.
  device_offline: { color: cssVar.colorWarning, icon: CircleAlert },
  failed: EXECUTION_STATUS_VISUALS.failed,
  // Not-yet-started run: same glyph as a backlog task.
  pending: EXECUTION_STATUS_VISUALS.backlog,
  // A usage limit or a transport fault: retried on a schedule, not failed.
  quota_limited: { color: cssVar.colorWarning, icon: CircleAlert },
  timeout: { color: cssVar.colorWarning, icon: CircleAlert },
  transient_failed: { color: cssVar.colorWarning, icon: CircleAlert },
};

const RunningIcon = memo<{ size: number }>(({ size }) => {
  const mainColor = cssVar.colorWarning;
  const ringColor = `color-mix(in srgb, ${cssVar.colorWarning} 35%, transparent)`;
  return (
    <span className={styles.running}>
      <svg aria-hidden fill="none" height={size} viewBox="0 0 16 16" width={size}>
        <circle cx="8" cy="8" r="6.5" stroke={ringColor} strokeWidth="1.5" />
        <path
          d="M14.5 8 A 6.5 6.5 0 0 1 8 14.5"
          fill="none"
          stroke={mainColor}
          strokeLinecap="round"
          strokeWidth="1.5"
        />
        <circle cx="8" cy="8" fill={mainColor} r="2.5" stroke={ringColor} strokeWidth="1" />
      </svg>
    </span>
  );
});

interface TopicStatusIconProps {
  size?: number;
  status?: string | null;
}

const TopicStatusIcon = memo<TopicStatusIconProps>(({ size = 16, status }) => {
  if (status === 'running') return <RunningIcon size={size} />;
  const key = (status ?? 'pending') as keyof typeof STATIC_META;
  const meta = STATIC_META[key] ?? STATIC_META.pending;
  return <Icon color={meta.color} icon={meta.icon} size={size} />;
});

export default TopicStatusIcon;
