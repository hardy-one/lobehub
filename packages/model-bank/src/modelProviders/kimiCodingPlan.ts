import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.moonshot.ai/docs
const KimiCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'kimi-k2.5',
  description:
    'Kimi Code Plan from Moonshot AI provides access to Kimi models including K2.5 for coding tasks.',
  disableBrowserRequest: true,
  id: 'kimicodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://platform.moonshot.ai/docs',
  name: 'Kimi Code Plan',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.moonshot.ai/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://platform.moonshot.ai',
};

export default KimiCodingPlan;
