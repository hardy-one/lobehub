/**
 * Turn id like `docs_123` to `123`. Or add prefix to the identifier.
 * @param identifier - The identifier to standardize.
 * @param prefix - The prefix to use when adding to plain identifiers ('docs' or 'agt').
 * @returns The standardized identifier.
 * @example
 * standardizeIdentifier("docs_123")           // → "123"
 * standardizeIdentifier("agt_456")              // → "456"
 * standardizeIdentifier("123", "docs")         // → "docs_123"
 * standardizeIdentifier("abc123", "agt")       // → "agt_abc123"
 */

export const standardizeIdentifier = (identifier: string, prefix?: 'docs' | 'agt') => {
  if (identifier.includes('_')) {
    return identifier.split('_')[1];
  } else if (prefix) {
    return `${prefix}_${identifier}`;
  }

  return identifier;
};

export const getIdFromIdentifier = (identifier: string, prefix?: 'docs' | 'agt') => {
  if (identifier.includes('_')) {
    return identifier;
  }

  return `${prefix}_${identifier}`;
};
