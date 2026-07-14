import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import dynamic from '@/libs/next/dynamic';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useChatInputTopicModel } from '../../hooks/useTopicModel';

const LargeTokenContent = dynamic(() => import('./TokenTag'), { ssr: false });

const Token = memo<PropsWithChildren>(({ children }) => {
  const { model, provider } = useChatInputTopicModel();
  const showTag = useAiInfraStore(aiModelSelectors.isModelHasContextWindowToken(model, provider));

  return showTag && children;
});

const ContextWindow = memo(() => {
  return (
    <Token>
      <LargeTokenContent />
    </Token>
  );
});

ContextWindow.displayName = 'ContextWindow';

export default ContextWindow;
