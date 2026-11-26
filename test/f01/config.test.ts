import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('C-F01-05 config', () => {
  it('loadConfig usa os defaults sem variáveis de ambiente', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      databaseUrl: 'postgres://catraca:catraca@localhost:5432/catraca',
      gatewayDelayScale: 1,
      gatewayPollMs: 250,
      partnerApiKey: 'catraca-parceiro-2026',
    });
    // valores vazios ou numéricos inválidos caem no default
    const c = loadConfig({ PORT: 'abc', GATEWAY_DELAY_SCALE: '', GATEWAY_POLL_MS: 'x', PARTNER_API_KEY: '' });
    expect(c.port).toBe(3000);
    expect(c.gatewayDelayScale).toBe(1);
    expect(c.gatewayPollMs).toBe(250);
    expect(c.partnerApiKey).toBe('catraca-parceiro-2026');
  });

  it('loadConfig lê as variáveis de ambiente', () => {
    expect(
      loadConfig({
        PORT: '4000',
        DATABASE_URL: 'postgres://u:p@h:5433/d',
        GATEWAY_DELAY_SCALE: '0.05',
        GATEWAY_POLL_MS: '50',
        PARTNER_API_KEY: 'outra-chave',
      }),
    ).toEqual({
      port: 4000,
      databaseUrl: 'postgres://u:p@h:5433/d',
      gatewayDelayScale: 0.05,
      gatewayPollMs: 50,
      partnerApiKey: 'outra-chave',
    });
  });
});
