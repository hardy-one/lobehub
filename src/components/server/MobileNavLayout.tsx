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
  // through to `body`. Stating it here keeps the content area on the layout
  // surface of the selected colour scheme, independent of what sets `body`.
  container: {
    background: cssVar.colorBgLayout,
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
