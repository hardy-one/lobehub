import { type ModelProviderCard } from '@/types/llm';

// ref: https://platform.xiaomimimo.com/
const Mimo: ModelProviderCard = {
  chatModels: [],
  checkModel: 'mimo-v2-flash',
  description:
    'Xiaomi MiMo is a large language model platform developed by the Xiaomi LLM Core Team, featuring the open-source MiMo-V2-Flash model with 309B parameters and exceptional coding capabilities.',
  id: 'mimo',
  modelsUrl: 'https://platform.xiaomimimo.com/#/docs/welcome',
  name: 'MiMo',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.xiaomimimo.com/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://platform.xiaomimimo.com',
};

export default Mimo;
