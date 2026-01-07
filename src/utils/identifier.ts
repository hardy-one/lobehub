/**
 * Standardize an identifier to a consistent format.
 * Ensures that regardless of input format (with or without prefix),
 * the output is always the full database ID with prefix.
 * @param identifier - The identifier to standardize (can be with or without prefix)
 * @param prefix - The expected prefix ('docs' or 'agt')
 * @returns The standardized identifier (always with prefix if provided)
 * @example
 * standardizeIdentifier("docs_123", "docs")  // → "docs_123"
 * standardizeIdentifier("123", "docs")        // → "docs_123"
 * standardizeIdentifier("agt_456", "agt")     // → "agt_456"
 * standardizeIdentifier("456", "agt")         // → "agt_456"
 */

export const standardizeIdentifier = (identifier: string, prefix?: 'docs' | 'agt') => {
  if (identifier.includes('_')) {
    return identifier;
  }

  // If identifier doesn't have a prefix, add the standard prefix
  if (prefix) {
    return `${prefix}_${identifier}`;
  }

  // If no prefix specified, return identifier as-is
  return identifier;
};

export const getIdFromIdentifier = (identifier: string, prefix?: 'docs' | 'agt') => {
  if (identifier.includes('_')) {
    return identifier;
  }

  return `${prefix}_${identifier}`;
};
