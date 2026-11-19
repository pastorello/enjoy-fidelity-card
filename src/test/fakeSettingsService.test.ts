import { describe, expect, it } from 'vitest';
import { createFakeSettingsService, defaultSettings } from './fakeSettingsService';
import { SettingsLoadError } from '../features/settings/types';

describe('createFakeSettingsService', () => {
  it('starts from the initial configuration (100 / 15000 / hex) and counts calls', async () => {
    const { service } = createFakeSettingsService();
    await expect(service.load()).resolves.toEqual(defaultSettings);
    expect(defaultSettings).toMatchObject({
      centsPerPoint: 100,
      confirmThresholdCents: 15000,
      usbUidFormat: 'hex',
    });
    await service.load();
    expect(service.load).toHaveBeenCalledTimes(2);
  });

  it('a successful update changes what the next load returns, keeping the USB format', async () => {
    const { service } = createFakeSettingsService({
      settings: { ...defaultSettings, usbUidFormat: 'dec' },
    });
    const result = await service.update({ centsPerPoint: 200, confirmThresholdCents: 20000 });
    expect(result).toEqual({
      status: 'ok',
      settings: expect.objectContaining({
        centsPerPoint: 200,
        confirmThresholdCents: 20000,
        usbUidFormat: 'dec',
      }) as unknown,
    });
    await expect(service.load()).resolves.toMatchObject({
      centsPerPoint: 200,
      confirmThresholdCents: 20000,
      usbUidFormat: 'dec',
    });
    expect(service.update).toHaveBeenCalledTimes(1);
  });

  it('an update with a USB format changes it too', async () => {
    const { service, current } = createFakeSettingsService();
    await service.update({ centsPerPoint: 100, confirmThresholdCents: 15000, usbUidFormat: 'dec' });
    expect(current()).toMatchObject({ centsPerPoint: 100, usbUidFormat: 'dec' });
  });

  it('plays programmed load failures in order, then the last outcome repeats', async () => {
    const { service } = createFakeSettingsService({ loadResults: ['network', 'ok'] });
    const first: unknown = await service.load().catch((error: unknown) => error);
    expect(first).toBeInstanceOf(SettingsLoadError);
    expect(first).toMatchObject({ kind: 'network' });
    await expect(service.load()).resolves.toEqual(defaultSettings);
    await expect(service.load()).resolves.toEqual(defaultSettings);
  });

  it('a not-found load rejects with that kind', async () => {
    const { service } = createFakeSettingsService({ loadResults: ['not-found'] });
    await expect(service.load()).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('plays programmed update failures without changing the stored values', async () => {
    const { service } = createFakeSettingsService({
      updateResults: ['network', 'forbidden', 'ok'],
    });
    const input = { centsPerPoint: 300, confirmThresholdCents: 30000 };
    await expect(service.update(input)).resolves.toEqual({ status: 'network' });
    await expect(service.update(input)).resolves.toEqual({ status: 'forbidden' });
    await expect(service.load()).resolves.toEqual(defaultSettings);
    await expect(service.update(input)).resolves.toMatchObject({ status: 'ok' });
    await expect(service.load()).resolves.toMatchObject({ centsPerPoint: 300 });
  });

  it('changeElsewhere simulates another admin saving from another phone', async () => {
    const fake = createFakeSettingsService();
    fake.changeElsewhere({ confirmThresholdCents: 50000 });
    await expect(fake.service.load()).resolves.toMatchObject({
      centsPerPoint: 100,
      confirmThresholdCents: 50000,
    });
    expect(fake.current()).toMatchObject({ confirmThresholdCents: 50000 });
  });
});
