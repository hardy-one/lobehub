import { getGoalCommand, isGoalCommandFailed } from '@lobechat/shared-tool-ui/goal-command';
import { createStaticStyles, cx, Icon } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ChevronRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';
import { rowShinyText } from '@/styles';
import { type MetaData } from '@/types/meta';

import { getToolDisplayName } from '../../toolDisplayNames';
import { extractToolKeyword } from './extractToolKeyword';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  aborted: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  keyword: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 1px;

    color: ${cssVar.colorTextDescription};
    white-space: nowrap;
  `,
  label: css`
    flex: none;
  `,
  standalone: css`
    overflow: hidden;
    flex: 0 1 auto;
    min-width: 0;
    text-overflow: ellipsis;
  `,
}));

interface ToolTitleProps {
  apiName: string;
  args?: Record<string, unknown>;
  identifier: string;
  isAborted?: boolean;
  isLoading?: boolean;
  partialArgs?: Record<string, unknown>;
  /**
   * Metadata for this identifier, resolved once per tool list by the parent.
   * Omitted means resolve it here, which costs a full scan of the tool list.
   */
  pluginMeta?: MetaData;
  /** The settled tool result, so a failed goal command is not titled as done. */
  result?: { error?: unknown; state?: any };
}

const isCJK = (value: string) => /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(value);

/**
 * Collapsed tool row title. When a command has a step description it stands
 * alone — the action label ("执行代码") adds nothing next to "恢复登录态", and
 * showing both at different sizes reads as a glitch, so the description takes
 * the label's typography. Command-like keywords (program name, file basename)
 * keep the "<label> <keyword>" shape in the smaller code font.
 */
const ToolTitle = memo<ToolTitleProps>(
  ({
    identifier,
    apiName,
    args,
    partialArgs,
    isLoading,
    isAborted,
    pluginMeta: pluginMetaProp,
    result,
  }) => {
    const { t } = useTranslation('plugin');

    // The parent resolves every identifier in the list in one pass; this
    // fallback keeps standalone callers working without that list.
    const resolvedMeta = useToolStore(
      pluginMetaProp === undefined ? toolSelectors.getMetaById(identifier) : () => pluginMetaProp,
      isEqual,
    );
    const pluginTitle = pluginHelpers.getPluginTitle(resolvedMeta);

    // Builtin (and hetero-agent) tools have per-API action labels under
    // `builtins.<identifier>.apiName.<apiName>`; everything else falls back to
    // the workflow-summary display name (MCP short labels / title-cased
    // apiName), prefixed with the plugin title when we actually know it.
    const actionLabel = t(`builtins.${identifier}.apiName.${apiName}`, { defaultValue: '' });

    const effectiveArgs = args ?? partialArgs;
    const keyword = useMemo(() => extractToolKeyword(effectiveArgs), [effectiveArgs]);

    // Only command step descriptions can replace the action. Resource titles,
    // queries, and paths can also contain CJK text but do not say what the tool
    // is doing (for example, creating versus updating a Linear issue).
    const hasCommand = ['command', 'cmd', 'script'].some(
      (key) => typeof effectiveArgs?.[key] === 'string' && effectiveArgs[key].trim(),
    );
    const isStandaloneDescription =
      hasCommand &&
      !!keyword &&
      isCJK(keyword) &&
      keyword === extractToolKeyword({ description: effectiveArgs?.description });

    // `/goal` in a CLI agent conversation creates and plans the goal through
    // `lh` — that step reads as the goal step, not "执行命令 <description>".
    const goalCommand = useMemo(
      () =>
        typeof effectiveArgs?.command === 'string'
          ? getGoalCommand(effectiveArgs.command)
          : undefined,
      [effectiveArgs],
    );
    if (goalCommand) {
      const goalTitle = goalCommand.kind === 'create' ? goalCommand.title : undefined;
      // Same rule as the expanded GoalCommandInspector, so the collapsed row
      // never says "Goal created" next to a failed status.
      const failed = !isLoading && isGoalCommandFailed(result);
      const status = isLoading ? 'loading' : failed ? 'failed' : 'completed';
      return (
        <div className={cx(styles.root, isAborted && styles.aborted, rowShinyText(isLoading))}>
          <span className={styles.label}>
            {t(`builtins.goalCommand.${goalCommand.kind}.${status}`)}
          </span>
          {goalTitle && <span className={styles.standalone}>{goalTitle}</span>}
        </div>
      );
    }

    return (
      <div className={cx(styles.root, isAborted && styles.aborted, rowShinyText(isLoading))}>
        {isStandaloneDescription ? (
          <span className={styles.standalone}>{keyword}</span>
        ) : (
          <>
            <span className={styles.label}>
              {actionLabel || (
                <>
                  {pluginTitle && (
                    <>
                      <span>{pluginTitle}</span>
                      <Icon icon={ChevronRight} />
                    </>
                  )}
                  <span>{getToolDisplayName(apiName)}</span>
                </>
              )}
            </span>
            {keyword && <span className={styles.keyword}>{keyword}</span>}
          </>
        )}
      </div>
    );
  },
);

export default ToolTitle;
