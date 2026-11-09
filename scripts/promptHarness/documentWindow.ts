export interface DocumentWindowNotice {
  endLine: number;
  nextOffset?: number;
  startLine: number;
  totalChars?: number;
  totalLines: number;
}

/**
 * Parse the model-facing continuation notice emitted by @lobechat/prompts.
 *
 * Agent document reads intentionally expose the window through text, not a
 * synthetic metadata envelope. The mock and verifier must follow that actual
 * contract so a valid product response is not mistaken for a missing one.
 */
export const readDocumentWindowNotice = (content: string): DocumentWindowNotice | undefined => {
  const match = content.match(
    /\[Showing lines (\d+)-(\d+) of (\d+) lines(?:, (\d+) characters)?\.[^\]]*\]/,
  );
  if (!match) return undefined;

  const nextOffset = match[0].match(/offset=(\d+)/)?.[1];
  return {
    endLine: Number(match[2]),
    ...(nextOffset === undefined ? {} : { nextOffset: Number(nextOffset) }),
    startLine: Number(match[1]),
    ...(match[4] === undefined ? {} : { totalChars: Number(match[4]) }),
    totalLines: Number(match[3]),
  };
};
