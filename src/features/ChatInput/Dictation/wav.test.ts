import { describe, expect, it } from 'vitest';

import { encodePcm16FramesToWav } from './wav';

const readAscii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));

const pcm16Frame = (samples: number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return buffer;
};

const headerOf = async (blob: Blob) => new DataView(await blob.arrayBuffer());

describe('encodePcm16FramesToWav', () => {
  it('produces a valid empty WAV for no frames', async () => {
    const blob = encodePcm16FramesToWav([]);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44);

    const view = await headerOf(blob);
    expect(readAscii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36);
    expect(readAscii(view, 8, 4)).toBe('WAVE');
    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(0);
  });

  it('keeps a short, single frame verbatim (fewer than 3200 samples)', async () => {
    const frame = pcm16Frame([0, 1, -1, 1234, -5678]);
    const blob = encodePcm16FramesToWav([frame]);
    expect(blob.size).toBe(44 + frame.byteLength);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(36 + frame.byteLength);
    expect(view.getUint32(40, true)).toBe(frame.byteLength);
    expect(Array.from(bytes.slice(44))).toEqual(Array.from(new Uint8Array(frame)));
  });

  it('concatenates multiple s16le frames without any sample conversion', async () => {
    const first = pcm16Frame(Array.from({ length: 3200 }, (_, i) => (i % 100) - 50));
    const second = pcm16Frame(Array.from({ length: 3200 }, (_, i) => 50 - (i % 100)));
    const blob = encodePcm16FramesToWav([first, second]);

    expect(blob.size).toBe(44 + first.byteLength + second.byteLength);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(40, true)).toBe(first.byteLength + second.byteLength);
    expect(Array.from(bytes.slice(44, 44 + first.byteLength))).toEqual(
      Array.from(new Uint8Array(first)),
    );
    expect(Array.from(bytes.slice(44 + first.byteLength))).toEqual(
      Array.from(new Uint8Array(second)),
    );
  });

  it('honors a custom sample rate in the header fields', async () => {
    const view = await headerOf(encodePcm16FramesToWav([pcm16Frame([1])], 48_000));
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(28, true)).toBe(96_000);
  });
});
