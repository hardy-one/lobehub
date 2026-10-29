import { createStaticStyles, css, cx, textGroupStyles, textStyles } from '@lobehub/ui';

export const lineEllipsis = (line: number) =>
  cx(css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: ${line};

    text-overflow: ellipsis;
  `);

export const oneLineEllipsis = lineEllipsis(1);

/**
 * Inspector text style for builtin tool inspectors
 * Combines oneLineEllipsis with secondary text color
 */
export const inspectorTextStyles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    /* Coordinate space for the shiny sweep: every shimmering span in the row
     * resolves its overlay against this box, so they read as one wave. */
    ${textGroupStyles.shinyGroup}

    overflow: hidden;
    display: flex;
    align-items: center;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * Highlight underline effect using gradient background
 * - primary: default blue highlight
 * - info: info blue highlight
 * - warning: warning yellow highlight
 * - gold: gold highlight (for page-agent etc.)
 */
export const highlightTextStyles = createStaticStyles(({ css, cssVar }) => {
  const highlightBase = (highlightColor: string) => css`
    overflow: hidden;

    min-width: 0;
    margin-inline-start: 4px;
    padding-block-end: 1px;

    color: ${cssVar.colorText};
    text-overflow: ellipsis;

    background: linear-gradient(to top, ${highlightColor} 40%, transparent 40%);
  `;

  return {
    gold: highlightBase(cssVar.gold4),
    info: highlightBase(cssVar.colorInfoBg),
    primary: highlightBase(cssVar.colorPrimaryBgHover),
    warning: highlightBase(cssVar.colorWarningBg),
  };
});

/**
 * One shimmer for a whole row, instead of one per span inside it.
 *
 * A row used to give every label its own `lobe-text-shiny` span. Each of those
 * keeps a sweep running for as long as the row is on screen, and Blink resolves
 * an animation's style on every frame whether or not the value changed, so a
 * long tool list paid per label rather than per row. Hanging the sweep on the
 * row animates the same text once.
 *
 * The sweep is drawn by an absolutely positioned `::after` over the host, which
 * only reads right when the host is the text itself. `-leaf` keeps it off any
 * element that wraps children, where the overlay would sit behind opaque
 * descendants and paint a band across the row.
 */
export const rowShinyText = (active: boolean | undefined) =>
  cx(active && cx(textStyles.shiny, 'lobe-text-shiny-leaf'));

export const shinyGroupStyles = {
  shinyGroup: textGroupStyles.shinyGroup,
};
