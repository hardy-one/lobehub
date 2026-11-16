/**
 * Static hardware capacity of the device the local-system tools act on.
 *
 * Only values that stay constant for a connection belong here: current CPU
 * load, free memory and free disk change minute to minute, and a system role
 * that quoted them would produce a different prompt on every send, losing the
 * cached prefix. Live numbers come from `runCommand` or the device metrics
 * view instead.
 */
export interface DeviceHardwareSpecs {
  cpuCount?: number;
  cpuModel?: string;
  diskTotalBytes?: number;
  memoryTotalBytes?: number;
}

/** Binary gigabytes, rounded the way an OS quotes memory and disk sizes. */
const formatCapacity = (bytes: number): string => {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`;
  return `${Math.round(gb)} GB`;
};

/**
 * One line describing the machine's capacity, e.g.
 * `Acme X1 Processor (8 logical cores), 16 GB RAM, 512 GB disk`.
 * Fields the device did not report are left out; nothing reported at all
 * renders as `(not reported)` so the prompt keeps its shape.
 */
export const formatDeviceHardware = (specs: DeviceHardwareSpecs): string => {
  const model = specs.cpuModel?.trim();
  const cores = specs.cpuCount ? `${specs.cpuCount} logical cores` : undefined;
  const cpu = model && cores ? `${model} (${cores})` : (model ?? cores);

  const parts = [
    cpu,
    specs.memoryTotalBytes ? `${formatCapacity(specs.memoryTotalBytes)} RAM` : undefined,
    specs.diskTotalBytes ? `${formatCapacity(specs.diskTotalBytes)} disk` : undefined,
  ].filter(Boolean);

  if (parts.length === 0) return '(not reported)';

  return parts.join(', ');
};
