import { type IconType } from '@lobehub/icons';
import { createStaticStyles, cssVar, cx, keyframes } from '@lobehub/ui';
import { type CSSProperties, type ForwardedRef } from 'react';

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const styles = createStaticStyles(({ css }) => ({
  root: css`
    display: inline-grid;
    flex: none;
    place-items: center;
    line-height: 1;
  `,
  // Two stacked svgs because the center stop square must not rotate. CSS on an
  // svg root is composited; the SMIL <animateTransform> this replaces re-wrote
  // the `transform` attribute on the arc every frame, forcing a style recalc +
  // SVG layout on the main thread while a run was going.
  layer: css`
    display: block;
    grid-area: 1 / 1;
  `,
  arcLayer: css`
    animation: ${spin} 1s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

interface StopLoadingProps {
  className?: string;
  ref?: ForwardedRef<SVGSVGElement>;
  size?: number | string;
  style?: CSSProperties;
}

const StopLoadingIcon: IconType = (({ ref, size = 16, className, style }: StopLoadingProps) => {
  return (
    <span className={cx(className, styles.root)} style={style}>
      <span className={styles.layer}>
        <svg fill="none" height={size} ref={ref} viewBox="0 0 1024 1024" width={size}>
          <g fill="none">
            <circle
              cx="512"
              cy="512"
              fill="none"
              r="426"
              stroke={cssVar.colorBorder}
              strokeWidth="72"
            />
            <rect fill="currentColor" height="252" rx="24" ry="24" width="252" x="386" y="386" />
          </g>
        </svg>
      </span>
      <span className={cx(styles.arcLayer, styles.layer)}>
        <svg fill="none" height={size} viewBox="0 0 1024 1024" width={size}>
          <path
            d="M938.667 512C938.667 276.359 747.64 85.333 512 85.333"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="73"
          />
        </svg>
      </span>
    </span>
  );
}) as IconType;

export default StopLoadingIcon;
