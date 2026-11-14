/**
 * MiMo caps base64 audio at 10 MB. The limit applies to the encoded string, both for the
 * audio sent to recognition and for the sample a voice-clone request carries as its voice.
 */
export const XIAOMIMIMO_MAX_BASE64_BYTES = 10 * 1024 * 1024;

/** Base64 inflates raw bytes by 4/3, rounded up to whole quanta. */
export const estimateBase64Size = (rawBytes: number) => Math.ceil(rawBytes / 3) * 4;

const formatMegabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Reject oversized audio before it is read, encoded, or uploaded. A clear local error beats
 * an upstream rejection and avoids holding both the raw bytes and the encoded string.
 */
export const assertBase64AudioWithinLimit = (encodedSize: number, subject: string) => {
  if (encodedSize > XIAOMIMIMO_MAX_BASE64_BYTES) {
    throw new Error(
      `MiMo accepts at most 10 MB of base64 audio per ${subject}; this one reaches ${formatMegabytes(encodedSize)} MB. Shorten or compress it first.`,
    );
  }
};
