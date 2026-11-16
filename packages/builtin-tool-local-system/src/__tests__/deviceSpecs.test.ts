import { describe, expect, it } from 'vitest';

import { formatDeviceHardware } from '../deviceSpecs';

const GB = 1024 ** 3;

describe('formatDeviceHardware', () => {
  it('describes CPU, memory and disk capacity in one line', () => {
    expect(
      formatDeviceHardware({
        cpuCount: 8,
        cpuModel: 'Acme X1 Processor',
        diskTotalBytes: 512 * GB,
        memoryTotalBytes: 16 * GB,
      }),
    ).toBe('Acme X1 Processor (8 logical cores), 16 GB RAM, 512 GB disk');
  });

  it('keeps the reported parts when the device omits some specs', () => {
    expect(formatDeviceHardware({ cpuCount: 8 })).toBe('8 logical cores');
    expect(formatDeviceHardware({ memoryTotalBytes: 32 * GB })).toBe('32 GB RAM');
  });

  it('switches to TB for volumes that large', () => {
    expect(formatDeviceHardware({ diskTotalBytes: 2 * 1024 * GB })).toContain('2.0 TB disk');
  });

  it('renders a placeholder instead of an empty line for older devices', () => {
    expect(formatDeviceHardware({})).toBe('(not reported)');
    expect(formatDeviceHardware({ cpuModel: '   ' })).toBe('(not reported)');
  });
});
