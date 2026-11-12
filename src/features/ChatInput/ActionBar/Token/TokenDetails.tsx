import { Center, cssVar, Flexbox, Tooltip } from '@lobehub/ui';
import numeral from 'numeral';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import TokenProgress from './TokenProgress';
import { type TokenBreakdown } from './useTokenBreakdown';

interface TokenDetailsProps {
  breakdown: Pick<
    TokenBreakdown,
    | 'chatsToken'
    | 'hasProviderUsage'
    | 'historySummaryToken'
    | 'maxTokens'
    | 'systemRoleToken'
    | 'toolsToken'
    | 'usedToken'
    | 'usedTokenIsEstimated'
  >;
}

const TokenDetails = memo<TokenDetailsProps>(({ breakdown }) => {
  const { t } = useTranslation(['chat', 'components']);

  const {
    chatsToken,
    hasProviderUsage,
    historySummaryToken,
    maxTokens,
    systemRoleToken,
    toolsToken,
    usedToken,
    usedTokenIsEstimated,
  } = breakdown;
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);

  return (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} width={'100%'}>
        <div style={{ color: cssVar.colorTextDescription }}>{t('tokenDetails.title')}</div>
        <Tooltip
          styles={{ root: { maxWidth: 'unset', pointerEvents: 'none' } }}
          title={t('ModelSelect.featureTag.tokens', {
            ns: 'components',
            tokens: numeral(maxTokens).format('0,0'),
          })}
        >
          <Center
            height={20}
            paddingInline={4}
            style={{
              background: cssVar.colorFillTertiary,
              borderRadius: 4,
              color: cssVar.colorTextSecondary,
              fontFamily: cssVar.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      <Flexbox gap={4}>
        <div style={{ color: cssVar.colorTextDescription, fontSize: 12, lineHeight: 1.4 }}>
          {t(
            usedTokenIsEstimated
              ? hasProviderUsage
                ? 'tokenDetails.usageEstimated'
                : 'tokenDetails.usageLocal'
              : 'tokenDetails.usageProvider',
          )}
        </div>
        <div style={{ color: cssVar.colorTextDescription, fontSize: 12, lineHeight: 1.4 }}>
          {t('tokenDetails.contextWindowBasis')}
        </div>
        <div style={{ color: cssVar.colorTextDescription, fontSize: 12, lineHeight: 1.4 }}>
          {t('tokenDetails.breakdownBasis')}
        </div>
      </Flexbox>
      {isDevMode && (
        <TokenProgress
          showIcon
          data={[
            {
              color: cssVar.magenta,
              estimated: true,
              id: 'systemRole',
              title: t('tokenDetails.systemRole'),
              value: systemRoleToken,
            },
            {
              color: cssVar.geekblue,
              estimated: true,
              id: 'tools',
              title: t('tokenDetails.tools'),
              value: toolsToken,
            },
            {
              color: cssVar.orange,
              estimated: true,
              id: 'historySummary',
              title: t('tokenDetails.historySummary'),
              value: historySummaryToken,
            },
            {
              color: cssVar.gold,
              estimated: true,
              id: 'chats',
              title: t('tokenDetails.chats'),
              value: chatsToken,
            },
          ]}
        />
      )}
      <TokenProgress
        showIcon={isDevMode}
        showTotal={t('tokenDetails.total')}
        totalValue={maxTokens}
        data={[
          {
            color: cssVar.colorSuccess,
            estimated: usedTokenIsEstimated,
            id: 'used',
            title: t('tokenDetails.used'),
            value: usedToken,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            estimated: usedTokenIsEstimated,
            title: t('tokenDetails.rest'),
            value: Math.max(maxTokens - usedToken, 0),
          },
        ]}
      />
    </Flexbox>
  );
});

TokenDetails.displayName = 'ContextWindowTokenDetails';

export default TokenDetails;
