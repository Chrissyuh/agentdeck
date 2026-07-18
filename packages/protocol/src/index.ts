import { z } from 'zod';

export const agentStatusSchema = z.enum([
  'idle',
  'thinking',
  'working',
  'awaiting_approval',
  'completed',
  'error',
  'interrupted',
]);

export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const agentEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  kind: z.enum(['status', 'message', 'approval', 'action', 'error', 'system']),
  title: z.string().min(1),
  detail: z.string().optional(),
});

export type AgentEvent = z.infer<typeof agentEventSchema>;

export const pendingApprovalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  requestedAt: z.string().datetime(),
  risk: z.enum(['low', 'medium', 'high']),
});

export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectName: z.string().min(1),
  status: agentStatusSchema,
  startedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  currentOperation: z.string().nullable(),
  latestMessage: z.string().nullable(),
  pendingApproval: pendingApprovalSchema.nullable(),
  events: z.array(agentEventSchema).max(100),
});

export type Agent = z.infer<typeof agentSchema>;

export const createAgentRequestSchema = z.object({
  name: z.string().trim().min(1).max(48),
  projectName: z.string().trim().min(1).max(80),
  initialMessage: z.string().trim().max(500).optional(),
});

export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

const commandBaseSchema = z.object({
  requestId: z.string().min(1),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  commandBaseSchema.extend({ type: z.literal('approve'), agentId: z.string().min(1) }),
  commandBaseSchema.extend({ type: z.literal('reject'), agentId: z.string().min(1) }),
  commandBaseSchema.extend({ type: z.literal('interrupt'), agentId: z.string().min(1) }),
  commandBaseSchema.extend({
    type: z.literal('send_message'),
    agentId: z.string().min(1),
    message: z.string().trim().min(1).max(4000),
  }),
  commandBaseSchema.extend({
    type: z.literal('create_agent'),
    agent: createAgentRequestSchema,
  }),
  z.object({ type: z.literal('heartbeat'), sentAt: z.number().int().nonnegative() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    revision: z.number().int().nonnegative(),
    serverId: z.string().min(1),
    agents: z.array(agentSchema),
  }),
  z.object({
    type: z.literal('agent_updated'),
    revision: z.number().int().nonnegative(),
    agent: agentSchema,
  }),
  z.object({
    type: z.literal('agent_removed'),
    revision: z.number().int().nonnegative(),
    agentId: z.string().min(1),
  }),
  z.object({
    type: z.literal('command_result'),
    requestId: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('heartbeat'),
    serverTime: z.number().int().nonnegative(),
    echo: z.number().int().nonnegative().optional(),
  }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function parseClientMessage(input: string): ClientMessage {
  return clientMessageSchema.parse(JSON.parse(input) as unknown);
}

export function parseServerMessage(input: string): ServerMessage {
  return serverMessageSchema.parse(JSON.parse(input) as unknown);
}
