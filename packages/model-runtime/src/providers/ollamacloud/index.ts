import { LobeOllamaAI } from '../ollama';

const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';

export class LobeOllamaCloudAI extends LobeOllamaAI {
  constructor({ baseURL, apiKey }: { baseURL?: string; apiKey?: string } = {}) {
    super({ baseURL: baseURL || OLLAMA_CLOUD_BASE_URL, apiKey });
  }
}

export default LobeOllamaCloudAI;
