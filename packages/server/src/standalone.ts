import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentProvider } from './provider-factory';
import { createAgentDeckServer } from './server';

const portValue = Number(process.env.AGENTDECK_PORT ?? 4317);
const dashboardPath = process.env.AGENTDECK_DASHBOARD_PATH
  ? path.resolve(process.env.AGENTDECK_DASHBOARD_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/dashboard/dist');

const provider = await createAgentProvider();
const server = await createAgentDeckServer({ port: portValue, dashboardPath, provider });

process.stdout.write(
  `${JSON.stringify({
    service: 'AgentDeck',
    address: `${server.localAddress}:${server.port}`,
    pairingUrl: server.getDashboardUrl(),
    provider: provider.name,
  })}\n`,
);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
