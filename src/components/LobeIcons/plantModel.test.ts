import { describe, expect, it } from 'vitest';

import { getPlantModel } from './plantModel';

describe('getPlantModel', () => {
  it.each(['maple', 'sage', 'fern', 'moss'] as const)('recognizes the %s routing model', (name) => {
    expect(getPlantModel(`group/${name}`)).toBe(name);
    expect(getPlantModel(`GROUP/${name.toUpperCase()}`)).toBe(name);
  });

  it.each([
    undefined,
    '',
    'maple',
    'sage',
    'fern',
    'moss',
    'fnlp/moss-moon-003-sft',
    'provider/sage',
    'group/maple-preview',
    'group/sage/other',
    'other/group/fern',
    'group/moss-1',
    'group/toString',
    'group/__proto__',
    'gpt-4o',
    'claude-sonnet-4',
  ])('preserves the default icon resolution for %s', (model) => {
    expect(getPlantModel(model)).toBeUndefined();
  });
});
