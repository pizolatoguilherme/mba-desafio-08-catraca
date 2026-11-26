import { describe, expect, it } from 'vitest';
import { cancelEvent } from '../../src/cancel/service.js';

describe('F08 cancelEvent', () => {
  it('exporta cancelEvent', () => {
    expect(typeof cancelEvent).toBe('function');
  });
});
