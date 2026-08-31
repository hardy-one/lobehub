export const CONTEXT_REFERENCE_NODE_TYPE = 'context-reference';
export const CONTEXT_REFERENCE_TAG = 'context_reference';

/**
 * Serialize an editor context-reference node into the markdown-safe marker that
 * is resolved by the context engine immediately before an LLM request.
 */
export const createContextReferenceMarker = (id: string): string =>
  `<${CONTEXT_REFERENCE_TAG} id="${encodeURIComponent(id)}" />`;

export const decodeContextReferenceId = (encodedId: string): string => {
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
};
