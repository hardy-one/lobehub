import { shinyTextStyles as sharedShinyTextStyles } from '@lobechat/shared-tool-ui/styles';
import { createStaticStyles, css } from '@lobehub/ui';

export const dotLoading = css`
  &::after {
    content: '\\2026'; /* ascii code for the ellipsis character */

    overflow: hidden;
    display: inline-block;

    width: 0;

    vertical-align: bottom;

    /* Intentionally animates width, not transform: the reveal is step-wise
       (steps(4)), and each ellipsis glyph is wider than the last, so only a
       width animation exposes exactly one, two, or three dots. This rule
       carries a single animation on one inline element — not worth converting. */
    animation: ellipsis steps(4, end) 900ms infinite;
  }

  @keyframes ellipsis {
    to {
      width: 1.25em;
    }
  }
`;

export const elapsedTimeStyles = createStaticStyles(({ css, cssVar }) => ({
  elapsedTime: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

export const errorTextStyles = createStaticStyles(({ css, cssVar }) => ({
  errorText: css`
    color: ${cssVar.colorError};
  `,
}));

export const shinyTextStyles = {
  errorText: errorTextStyles.errorText,
  shinyText: sharedShinyTextStyles.shinyText,
};
