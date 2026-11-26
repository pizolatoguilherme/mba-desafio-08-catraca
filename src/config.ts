export interface Config {
  port: number;
  databaseUrl: string;
  gatewayDelayScale: number;
  gatewayPollMs: number;
  partnerApiKey: string;
}

const DEFAULTS: Config = {
  port: 3000,
  databaseUrl: 'postgres://catraca:catraca@localhost:5432/catraca',
  gatewayDelayScale: 1,
  gatewayPollMs: 250,
  partnerApiKey: 'catraca-parceiro-2026',
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? fallback : value;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: num(env.PORT, DEFAULTS.port),
    databaseUrl: str(env.DATABASE_URL, DEFAULTS.databaseUrl),
    gatewayDelayScale: num(env.GATEWAY_DELAY_SCALE, DEFAULTS.gatewayDelayScale),
    gatewayPollMs: num(env.GATEWAY_POLL_MS, DEFAULTS.gatewayPollMs),
    partnerApiKey: str(env.PARTNER_API_KEY, DEFAULTS.partnerApiKey),
  };
}

export const config: Config = loadConfig(process.env);
