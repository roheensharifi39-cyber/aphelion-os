import { describe, expect, it } from 'vitest';
import { generate } from '../src/lib/particle-field/generators.ts';

describe('supplied Neuron field', () => {
  it('reproduces the reference seed and motion at the authored particle count', () => {
    const field = generate('neuron', 690702840, 250000);
    expect(field.aL.length / 4).toBe(250000);
    expect(field.motion.label).toBe('Neuron');
    expect(field.motion.spin).toBeCloseTo(.0908, 3);
    expect(field.motion.wobble).toBeCloseTo(.0249, 3);
    expect(field.motion.pulse).toBe(1);
    expect(field.motion.tilt[0]).toBeCloseTo(-.122, 3);
    expect(field.motion.tilt[2]).toBeCloseTo(.008, 3);
    for (const array of [field.tex, field.aL, field.aU, field.aO, field.aR]) {
      expect(array.every(Number.isFinite)).toBe(true);
    }
  });

  it('is deterministic when adapting particle count for a smaller device', () => {
    const first = generate('neuron', 690702840, 4096);
    const second = generate('neuron', 690702840, 4096);
    for (const key of ['tex', 'aL', 'aU', 'aO', 'aR']) expect(first[key]).toEqual(second[key]);
  });
});
