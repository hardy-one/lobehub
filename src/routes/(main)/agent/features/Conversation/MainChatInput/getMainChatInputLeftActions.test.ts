import { describe, expect, it } from 'vitest';

import { getMainChatInputLeftActions } from './getMainChatInputLeftActions';

describe('getMainChatInputLeftActions', () => {
  it('keeps advanced parameters inside the plus menu', () => {
    expect(getMainChatInputLeftActions()).toEqual(['plus', 'voiceDictation']);
  });
});
