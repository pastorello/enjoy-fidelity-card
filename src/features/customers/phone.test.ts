import { describe, expect, it } from 'vitest';
import {
  classifyQuery,
  formatPhoneForCard,
  formatPhoneForEdit,
  maskPhone,
  normalizePhone,
} from './phone';

describe('normalizePhone', () => {
  it.each([
    ['333 123 4521', '+393331234521'],
    ['3331234521', '+393331234521'],
    ['0039 333 123 4521', '+393331234521'],
    ['+39 333 123 4521', '+393331234521'],
    ['+39 333-123.4521', '+393331234521'],
    ['+44 20 7946 0958', '+442079460958'],
    ['0044 20 7946 0958', '+442079460958'],
    ['0771 123456', '+390771123456'],
    ['(0771) 123/456', '+390771123456'],
    ['+39 333 000 0001', '+393330000001'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['abc'],
    ['333 abc 4521'],
    ['1234'],
    ['+0123456789'],
    ['+39 333 123 4521 1111'],
    ['++39 333 123 4521'],
    ['+'],
  ])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('maskPhone', () => {
  it.each([
    ['+393331234521', '••• 4521'],
    ['+442079460958', '••• 0958'],
    ['+390771123456', '••• 3456'],
  ])('masks %j as %j', (phone, expected) => {
    expect(maskPhone(phone)).toBe(expected);
  });
});

describe('formatPhoneForCard', () => {
  it.each([
    ['+393331234521', '333 ••• 4521'],
    ['+390771123456', '077 ••• 3456'],
    ['+442079460958', '+44 ••• 0958'],
    ['+12025550143', '+1 ••• 0143'],
    ['+3524912345', '+352 ••• 2345'],
  ])('shows %j as %j', (phone, expected) => {
    expect(formatPhoneForCard(phone)).toBe(expected);
  });

  it('never shows the whole number when the national part is too short to hide anything', () => {
    expect(formatPhoneForCard('+393331234')).toBe('••• 1234');
  });
});

describe('formatPhoneForEdit', () => {
  it.each([
    ['+393331234521', '333 123 4521'],
    ['+390771123456', '077 112 3456'],
    ['+3933312', '333 12'],
    ['+442079460958', '+442079460958'],
  ])('shows %j as %j', (phone, expected) => {
    expect(formatPhoneForEdit(phone)).toBe(expected);
  });

  it('round-trips through normalizePhone', () => {
    expect(normalizePhone(formatPhoneForEdit('+393331234521'))).toBe('+393331234521');
    expect(normalizePhone(formatPhoneForEdit('+442079460958'))).toBe('+442079460958');
  });
});

describe('classifyQuery', () => {
  it.each([
    ['4521', 'phone'],
    ['+39 333 1', 'phone'],
    ['333-123', 'phone'],
    ['333 123', 'phone'],
    ['0039 333', 'phone'],
    ['3.3.3', 'phone'],
    ['45', 'none'],
    ['+4', 'none'],
    ['ro', 'name'],
    ['rossi mari', 'name'],
    ['50%', 'name'],
    ['a_b', 'name'],
    ['r', 'none'],
    ['', 'none'],
    ['   ', 'none'],
    [' r ', 'none'],
    ['ò', 'none'],
    ['--', 'none'],
    ['+ -', 'none'],
  ])('classifies %j as %s', (text, kind) => {
    expect(classifyQuery(text)).toBe(kind);
  });
});
