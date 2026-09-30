import { describe, expect, it } from 'vitest';
import { isNewer, parseBuildNumber } from './update';

describe('atualização', () => {
  it('lê o número do build do texto da release', () => {
    expect(parseBuildNumber('Build #12 do commit abc')).toBe(12);
    expect(parseBuildNumber('sem número')).toBeNull();
    expect(parseBuildNumber(undefined)).toBeNull();
  });
  it('só avisa quando o remoto é maior e o build local é conhecido', () => {
    expect(isNewer(10, 9)).toBe(true);
    expect(isNewer(9, 9)).toBe(false);
    expect(isNewer(8, 9)).toBe(false);
    expect(isNewer(null, 9)).toBe(false);
    expect(isNewer(50, 0)).toBe(false);
  });
});
