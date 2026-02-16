import { Flexbox } from '@lobehub/ui';
import { type FC, type ReactNode, useRef } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { FOOTER_HEIGHT, ITEM_HEIGHT, MAX_PANEL_HEIGHT, TOOLBAR_HEIGHT } from '../../const';
import { useBuildListItems } from '../../hooks/useBuildListItems';
import { useModelAndProvider } from '../../hooks/useModelAndProvider';
import { usePanelHandlers } from '../../hooks/usePanelHandlers';
import { styles } from '../../styles';
import { type GroupMode } from '../../types';
import { menuKey } from '../../utils';
import { ListItemRenderer } from './ListItemRenderer';

interface ListProps {
  extraControls?: (modelId: string, providerId: string) => ReactNode;
  groupMode: GroupMode;
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  provider?: string;
  searchKeyword?: string;
}

export const List: FC<ListProps> = ({
  extraControls,
  groupMode,
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  provider: providerProp,
  searchKeyword = '',
}) => {
  const { t: tCommon } = useTranslation('common');
  const newLabel = tCommon('new');

  const [isScrolling, setIsScrolling] = useState(false);
  const enabledList = useEnabledChatModels();
  const { model, provider } = useModelAndProvider(modelProp, providerProp);
  const { handleModelChange, handleClose } = usePanelHandlers({
    onModelChange: onModelChangeProp,
    onOpenChange,
  });
  const listItems = useBuildListItems(enabledList, groupMode, searchKeyword);

  const panelHeight = useMemo(
    () =>
      enabledList.length === 0
        ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
        : MAX_PANEL_HEIGHT,
    [enabledList.length],
  );

  const activeKey = menuKey(provider, model);

  // Find the index of the currently active model to scroll to center
  const activeIndex = useMemo(() => {
    return listItems.findIndex((item) => {
      switch (item.type) {
        case 'model-item-single':
        case 'model-item-multiple': {
          return item.data.providers.some((p) => menuKey(p.id, item.data.model.id) === activeKey);
        }
        case 'provider-model-item': {
          return menuKey(item.provider.id, item.model.id) === activeKey;
        }
        default:
          return false;
      }
    });
  }, [activeKey, listItems]);

  // Use ref to access Virtuoso's scrollToIndex method
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Scroll to the active model in center position on mount
  useEffect(() => {
    if (activeIndex >= 0) {
      // Use double requestAnimationFrame to ensure Virtuoso is mounted and ref is available
      const frame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({
            align: 'center',
            behavior: 'auto',
            index: activeIndex,
          });
        });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [activeIndex]);

  const handleScrollingStateChange = useCallback((scrolling: boolean) => {
    setIsScrolling(scrolling);
  }, []);

  const itemContent = useCallback(
    (index: number) => {
      const item = listItems[index];
      return (
        <ListItemRenderer
          activeKey={activeKey}
          extraControls={extraControls}
          isScrolling={isScrolling}
          item={item}
          newLabel={newLabel}
          onClose={handleClose}
          onModelChange={handleModelChange}
        />
      );
    },
    [activeKey, extraControls, handleClose, handleModelChange, isScrolling, listItems, newLabel],
  );

  const listHeight = panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT;

  return (
    <Flexbox
      className={styles.list}
      flex={1}
      style={{
        height: listHeight,
      }}
    >
      <Virtuoso
        isScrolling={handleScrollingStateChange}
        itemContent={itemContent}
        overscan={200}
        ref={virtuosoRef}
        style={{ height: listHeight }}
        totalCount={listItems.length}
      />
    </Flexbox>
  );
};
