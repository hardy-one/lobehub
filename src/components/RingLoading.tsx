import { createStaticStyles, cssVar, cx, keyframes } from '@lobehub/ui';
import { type CSSProperties, type SVGProps } from 'react';

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const styles = createStaticStyles(({ css }) => ({
  // The animation lives on the wrapping span, never on the svg: Blink refuses
  // to composite transform animations on SVG elements once the effective zoom
  // is > 1 (device pixel ratio scaling), so an svg-level spin costs a full
  // style-recalc pass over the whole document every frame (~60/s with this
  // page's DOM size, measured on-device). An HTML wrapper composites for free.
  // The track is a full circle and the arc is centered, so spinning the whole
  // icon is visually identical.
  root: css`
    display: inline-flex;
    flex: none;
    line-height: 1;
    animation: ${spin} 1s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));

interface RingLoadingIconProps extends SVGProps<SVGSVGElement> {
  ringColor?: string;
  size?: number | string;
  style?: CSSProperties;
}

const RingLoadingIcon = ({
  ref,
  size = 16,
  className,
  style,
  ringColor = cssVar.colorBorder,
  ...rest
}: RingLoadingIconProps & { ref?: React.RefObject<SVGSVGElement | null> }) => {
  return (
    <span className={cx('anticon', styles.root, className)} style={style}>
      <svg
        color="currentColor"
        height={size}
        ref={ref}
        viewBox="0 0 1024 1024"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...rest}
      >
        <g fill="none">
          <circle cx="512" cy="512" fill="none" r="400" stroke={ringColor} strokeWidth="128" />
          <path
            d="M912 512C912 290.92 733.08 112 512 112"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="128"
          />
        </g>
      </svg>
    </span>
  );
};

export default RingLoadingIcon;
