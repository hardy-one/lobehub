import { Center, cssVar, Flexbox, Tooltip } from '@lobehub/ui';
import numeral from 'numeral';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TokenProgress from './TokenProgress';
import { type TokenBreakdown } from './useTokenBreakdown';

interface TokenDetailsProps {
  breakdown: Pick<TokenBreakdown, 'maxTokens' | 'usedToken'>;
}

const TokenDetails = memo<TokenDetailsProps>(({ breakdown }) => {
  const { t } = useTranslation(['chat', 'components']);

  const { maxTokens, usedToken } = breakdown;
  const remainingTokens = Math.max(maxTokens - usedToken, 0);

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
      <TokenProgress
        showTotal={t('tokenDetails.total')}
        data={[
          {
            color: cssVar.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: usedToken,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: remainingTokens,
          },
        ]}
      />
    </Flexbox>
  );
});

TokenDetails.displayName = 'ContextWindowTokenDetails';

export default TokenDetails;
