const WAV_MIME_TYPE = 'audio/wav';
const WAV_HEADER_SIZE = 44;
const PCM16_BYTES_PER_SAMPLE = 2;
const PCM16_CHANNELS = 1;

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

/**
 * Wraps already-encoded s16le frames from `BrowserAudioWorkletCapture` in a canonical
 * 44-byte PCM WAV container. The frame bytes are copied verbatim: no decode, resample,
 * or int16 -> float32 -> int16 round trip is performed.
 *
 * The header layout matches `VoiceMessage/normalizeRecording.ts#encodePcm16Wav`.
 */
export const encodePcm16FramesToWav = (frames: ArrayBuffer[], sampleRate = 16_000): Blob => {
  let dataLength = 0;
  for (const frame of frames) dataLength += frame.byteLength;

  const arrayBuffer = new ArrayBuffer(WAV_HEADER_SIZE + dataLength);
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, arrayBuffer.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, PCM16_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * PCM16_CHANNELS * PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(32, PCM16_CHANNELS * PCM16_BYTES_PER_SAMPLE, true);
  view.setUint16(34, PCM16_BYTES_PER_SAMPLE * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = WAV_HEADER_SIZE;
  for (const frame of frames) {
    bytes.set(new Uint8Array(frame), offset);
    offset += frame.byteLength;
  }

  return new Blob([arrayBuffer], { type: WAV_MIME_TYPE });
};
