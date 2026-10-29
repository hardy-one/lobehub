export interface LocalObjectBytes {
  base64: string;
  mimeType: string;
}

/**
 * Reads an object this deployment owns directly from storage. Lets the server
 * fulfil base64 conversions without requesting its own presigned URL back over
 * HTTP, which depends on resolving and reaching the public storage origin.
 * Return `undefined` for URLs the storage layer does not own; those keep the
 * regular SSRF-safe download.
 */
export type LocalObjectReader = (url: string) => Promise<LocalObjectBytes | undefined>;

/**
 * Ask the caller's storage reader for the object, falling back to the HTTP
 * download when the reader is absent, does not own the URL, or fails. A storage
 * read failure must not lose the image: the HTTP path is still a valid source.
 */
export const readLocalObject = async (
  url: string,
  reader: LocalObjectReader | undefined,
): Promise<LocalObjectBytes | undefined> => {
  if (!reader) return undefined;

  try {
    return await reader(url);
  } catch (error) {
    console.warn('Failed to read image from storage, falling back to download:', error);
    return undefined;
  }
};
