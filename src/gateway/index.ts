import { config } from '../config.js';
import { createDispatcher, type Dispatcher } from './dispatcher.js';
import { SimulatedGateway } from './simulated.js';

/** Singleton do processo: gateway simulado com GATEWAY_DELAY_SCALE e polling de GATEWAY_POLL_MS. */
export const dispatcher: Dispatcher = createDispatcher({
  gateway: new SimulatedGateway({ scale: config.gatewayDelayScale }),
  pollMs: config.gatewayPollMs,
});
