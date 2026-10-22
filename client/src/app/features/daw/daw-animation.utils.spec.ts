import { describe, expect, it } from 'vitest';
import { shouldUpdateDawUi } from './daw-animation.utils';

describe('shouldUpdateDawUi', () => {
  it('limits Angular UI updates to ten per second', () => {
    expect(shouldUpdateDawUi(99, 0)).toBe(false);
    expect(shouldUpdateDawUi(100, 0)).toBe(true);
    expect(shouldUpdateDawUi(150, 100)).toBe(false);
  });
});
