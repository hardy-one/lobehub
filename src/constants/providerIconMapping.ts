/**
 * Provider Icon Mapping
 * Maps Coding Plan and other custom providers to existing provider icons
 * This avoids waiting for @lobehub/icons to add new provider mappings
 */

/**
 * Coding Plan provider icon mappings
 * These providers should display using their parent company's icon
 */
export const providerIconMapping: Record<string, string> = {
  // Aliyun Bailian Coding Plan -> Bailian icon
  bailiancodingplan: 'bailian',
  // MiniMax Coding Plan -> Minimax icon
  minimaxcodingplan: 'minimax',
  // GLM Coding Plan -> Zhipu icon (ChatGLM)
  glmcodingplan: 'zhipu',
  // Kimi Coding Plan -> Moonshot icon
  kimicodingplan: 'moonshot',
  // Volcengine Coding Plan -> Volcengine icon
  volcenginecodingplan: 'volcengine',
};

/**
 * Get the actual provider key for icon display
 * @param provider - The original provider key
 * @returns The mapped provider key for icon display, or the original if no mapping exists
 */
export function getProviderIconKey(provider: string): string {
  return providerIconMapping[provider] || provider;
}
