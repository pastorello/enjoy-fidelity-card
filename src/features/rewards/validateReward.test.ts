import { describe, expect, it } from 'vitest';
import { REWARD_NAME_MAX, REWARD_POINTS_MAX, validateReward } from './validateReward';

const NAME_REQUIRED = 'Scrivi il nome del premio';
const NAME_TOO_LONG = 'Il nome è troppo lungo (massimo 60 caratteri)';
const POINTS_INVALID = 'Scrivi i punti: un numero intero maggiore di zero';
const POINTS_TOO_HIGH = 'Al massimo 99.999 punti';

function pointsOf(points: string) {
  return validateReward({ name: 'Spremuta', points });
}

describe('validateReward', () => {
  it('mirrors the server limits', () => {
    expect(REWARD_NAME_MAX).toBe(60);
    expect(REWARD_POINTS_MAX).toBe(99999);
  });

  it('accepts a valid reward, trimming the name', () => {
    expect(validateReward({ name: '  Spremuta  ', points: '80' })).toEqual({
      ok: true,
      reward: { name: 'Spremuta', points: 80 },
    });
  });

  it.each([
    ['1', 1],
    ['99999', 99999],
    [' 80 ', 80],
    ['007', 7],
  ])('accepts %j points as %i', (points, value) => {
    expect(pointsOf(points)).toEqual({ ok: true, reward: { name: 'Spremuta', points: value } });
  });

  it.each([
    ['0'],
    ['000'],
    [''],
    ['   '],
    ['1,5'],
    ['1.5'],
    ['-3'],
    ['+3'],
    ['1 000'],
    ['abc'],
    ['1e3'],
  ])('refuses %j points as not a whole number above zero', (points) => {
    expect(pointsOf(points)).toEqual({ ok: false, errors: { points: POINTS_INVALID } });
  });

  it.each([['100000'], ['999999999999999999999']])('refuses %j points as too many', (points) => {
    expect(pointsOf(points)).toEqual({ ok: false, errors: { points: POINTS_TOO_HIGH } });
  });

  it.each([[''], ['   ']])('refuses the name %j as missing', (name) => {
    expect(validateReward({ name, points: '80' })).toEqual({
      ok: false,
      errors: { name: NAME_REQUIRED },
    });
  });

  it('accepts a name of 60 characters and refuses one of 61', () => {
    expect(validateReward({ name: 'a'.repeat(60), points: '80' }).ok).toBe(true);
    expect(validateReward({ name: 'a'.repeat(61), points: '80' })).toEqual({
      ok: false,
      errors: { name: NAME_TOO_LONG },
    });
  });

  it('counts the name length after trimming', () => {
    expect(validateReward({ name: ` ${'a'.repeat(60)} `, points: '80' }).ok).toBe(true);
  });

  it('counts characters, not UTF-16 units, like Postgres length', () => {
    expect(validateReward({ name: '🍹'.repeat(60), points: '80' }).ok).toBe(true);
    expect(validateReward({ name: '🍹'.repeat(61), points: '80' }).ok).toBe(false);
  });

  it('reports both fields at once', () => {
    expect(validateReward({ name: '', points: '0' })).toEqual({
      ok: false,
      errors: { name: NAME_REQUIRED, points: POINTS_INVALID },
    });
  });
});
