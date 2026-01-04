'use client';

import { BuiltinInterventionProps } from '@lobechat/types';
import { Block } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// Maximum height for the todo list container (approximately 8-9 items visible)
const MAX_LIST_HEIGHT = 360;

const styles = createStaticStyles(({ css }) => ({
  scrollContainer: css`
    overflow: hidden auto;
    max-height: ${MAX_LIST_HEIGHT}px;
  `,
}));

import type { CreateTodosParams, TodoItem } from '../../types';
import { SortableTodoList } from '../components';

const AddTodoIntervention = memo<BuiltinInterventionProps<CreateTodosParams>>(
  ({ args, onArgsChange, registerBeforeApprove }) => {
    const { t } = useTranslation('tool');

    // Handle both formats:
    // - Initial AI input: { adds: string[] } (from AI)
    // - After user edit: { items: TodoItem[] } (saved format)
    const defaultItems: TodoItem[] =
      args?.items || args?.adds?.map((text) => ({ completed: false, text })) || [];

    const handleSave = useCallback(
      async (items: TodoItem[]) => {
        console.log('[AddTodoIntervention] handleSave called with', items.length, 'items');
        await onArgsChange?.({ items });
        console.log('[AddTodoIntervention] onArgsChange completed');
      },
      [onArgsChange],
    );

    return (
      <Block className={styles.scrollContainer} variant={'outlined'}>
        <SortableTodoList
          defaultItems={defaultItems}
          onSave={handleSave}
          placeholder={t('lobe-gtd.addTodo.placeholder')}
          registerBeforeApprove={registerBeforeApprove}
        />
      </Block>
    );
  },
  isEqual,
);

AddTodoIntervention.displayName = 'AddTodoIntervention';

export default AddTodoIntervention;
