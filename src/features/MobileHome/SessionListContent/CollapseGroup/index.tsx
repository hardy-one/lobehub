import { Accordion, createStaticStyles, responsive, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

const styles = createStaticStyles(({ css, cssVar }) => ({
  header: css`
    border-radius: ${cssVar.borderRadius};
    color: ${cssVar.colorTextDescription};

    ${responsive.sm} {
      /* On mobile the header used to be a full-bleed tinted band. Once the content
         area took the container surface the band sat brighter than the rows it
         labels and cut the list into blocks, so the grouping now comes from
         typography and spacing instead of a background. */
      margin-block-start: 10px;
      border-radius: 0;
      color: ${cssVar.colorTextSecondary};
    }

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

export interface CollapseGroupItem {
  children: ReactNode;
  extra?: ReactNode;
  key: string;
  label: ReactNode;
}

interface CollapseGroupProps {
  activeKey?: string[];
  items: CollapseGroupItem[];
  onChange?: (keys: string[]) => void;
}

const CollapseGroup = memo<CollapseGroupProps>(({ activeKey, items, onChange }) => {
  const isMobile = useIsMobile();

  return (
    <Accordion
      classNames={{ header: styles.header }}
      indicatorPlacement={'end'}
      value={activeKey}
      items={items.map((item) => ({
        action: item.extra,
        alwaysShowAction: isMobile,
        children: item.children,
        key: item.key,
        title: (
          <Text ellipsis {...(isMobile ? { fontSize: 13, weight: 500 } : {})}>
            {item.label}
          </Text>
        ),
      }))}
      styles={{
        header: isMobile ? { marginInline: 0 } : undefined,
        trigger: { minHeight: isMobile ? 44 : undefined, paddingInline: '16px 10px' },
      }}
      onValueChange={onChange}
    />
  );
});

export default CollapseGroup;
