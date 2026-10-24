import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

interface MobileContentLayoutProps extends FlexboxProps {
  header?: ReactNode;
  withNav?: boolean;
}

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
});

const MobileContentLayout = ({
  children,
  withNav,
  style,
  header,
  id = 'lobe-mobile-scroll-container',
  ...rest
}: MobileContentLayoutProps) => {
  const scrollStyle = {
    ...style,
    overflowX: 'hidden' as const,
    overflowY: 'auto' as const,
    paddingBottom: withNav ? 48 : style?.paddingBottom,
    position: 'relative' as const,
  };

  const content = (
    <Flexbox height="100%" id={id} style={scrollStyle} width="100%" {...rest}>
      {children}
    </Flexbox>
  );

  const containerProps = stylex.props(styles.container);

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
        height="100%"
        id={'lobe-mobile-scroll-container'}
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
