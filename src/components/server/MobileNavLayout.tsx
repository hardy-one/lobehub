import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { sx } from '@/styles/sx';

const DEFAULT_SCROLL_ID = 'lobe-mobile-scroll-container';

const styles = stylex.create({
  // Mobile pages declared no background of their own, so the scroll surface fell
  // through to `body`. Stating it here keeps the content area on the container
  // surface of the selected colour scheme, independent of what sets `body`.
  //
  // This is `colorBgContainer`, the same surface the desktop content panel uses,
  // so the mobile content sits one step above the layout surface that the header
  // and tab bar keep. Using the layout surface here flattened the content into the
  // page and left the composer as the only raised element.
  //
  // `backgroundColor`, not the `background` shorthand: StyleX drops the shorthand
  // silently, which leaves the container transparent.
  container: {
    backgroundColor: cssVar.colorBgContainer,
  },
  // Full-height mobile pages scroll their content pane without a visible bar.
  // This used to be AppTheme's descendant `#lobe-mobile-scroll-container` rule.
  hiddenScrollbar: {
    '::-webkit-scrollbar': { height: 0, width: 0 },
    'scrollbarWidth': 'none',
  },
});

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

const MobileContentLayout = ({
  children,
  withNav,
  style,
  header,
  className,
  id = DEFAULT_SCROLL_ID,
  ...rest
}: MobileContentLayoutProps) => {
  const scrollStyle = {
    overflowX: 'hidden' as const,
    overflowY: 'auto' as const,
    position: 'relative' as const,
    ...style,
    // TabNav Height
    paddingBottom: withNav ? 48 : style?.paddingBottom,
  };

  const containerProps = stylex.props(styles.container);

  const content = (
    // Only the shared scroll container hides its bar; a caller that renames the
    // element opts out, exactly as the id-scoped CSS rule did.
    <Flexbox
      className={sx(id === DEFAULT_SCROLL_ID && styles.hiddenScrollbar, className).className}
      height="100%"
      id={id}
      style={scrollStyle}
      width="100%"
      {...rest}
    >
      {children}
    </Flexbox>
  );

  if (!header) {
    return (
      <Flexbox height="100%" width="100%" {...containerProps}>
        {content}
      </Flexbox>
    );
  }

  return (
    <Flexbox
      className={containerProps.className}
      height="100%"
      style={{ overflow: 'hidden', position: 'relative' }}
      width="100%"
    >
      {header}
      <Flexbox
        className={sx(styles.hiddenScrollbar, className).className}
        height="100%"
        id={DEFAULT_SCROLL_ID}
        style={scrollStyle}
        width="100%"
        {...rest}
      >
        {children}
      </Flexbox>
    </Flexbox>
  );
};

export default MobileContentLayout;
