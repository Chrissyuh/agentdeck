import path from 'node:path';
import { createAgentDeckServer } from './server';

const portValue = Number(process.env.AGENTDECK_PORT ?? 4317);
const dashboardPath = path.resolve(
  process.env.AGENTDECK_DASHBOARD_PATH ?? '../../apps/dashboard/dist',
);

const server = await createAgentDeckServer({ port: portValue, dashboardPath });

process.stdout.write(
  `${JSON.stringify({
    service: 'AgentDeck',
    address: `${server.localAddress}:${server.port}`,
    pairingUrl: server.getDashboardUrl(),
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
