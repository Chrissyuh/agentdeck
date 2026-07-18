# AgentDeck

AgentDeck is an open-source, software-defined alternative to the Codex Micro: it turns an old phone
or tablet into a dedicated touchscreen control surface for AI coding agents. A lightweight Electron
host runs on your computer; the dashboard pairs over local Wi-Fi and stays synchronized over
WebSocket. AgentDeck adds no account, cloud service, telemetry, or chat-client UI; Codex continues
to use the OpenAI account already authenticated on the desktop.

AgentDeck is an independent project. It is not affiliated with or endorsed by OpenAI or Work Louder.

![AgentDeck running in a 667 by 375 phone-sized landscape viewport](docs/agentdeck-phone.png)

The interaction model is inspired by the official [Codex Micro concept](https://openai.com/supply/co-lab/work-louder/):
six glanceable chat keys, instant workflow launchers, dedicated command controls, push-to-talk,
and adjustable reasoning effort. AgentDeck translates those ideas into software that existing
touchscreen hardware can run.

> **Current provider:** Codex through the official local `codex app-server` interface. A realistic
> simulator remains available explicitly with `AGENTDECK_PROVIDER=mock`. The same provider boundary
> remains ready for Claude Code, Gemini CLI, OpenCode, and custom adapters.

## What is included

- Six illuminated Chat Keys with an explicit chat-to-physical-button mapping workflow
- Landscape-first, always-on surface for old iPhones, Android phones, and tablets
- Tactile live status, elapsed time, event history, and approval state
- Instant skill launcher, local push-to-talk capture where browser security permits it, and hold-drag reasoning control
- Large approve, reject, interrupt, send, voice, and reasoning controls
- Hold-to-confirm gestures for dangerous actions and haptics where supported
- Persistent key bindings and an opinionated always-dark, high-visibility mounted layout
- Native haptics where available, with synthesized mechanical clicks and important chat-update cues as a fallback
- QR or four-digit LAN pairing, automatic reconnect, heartbeat, offline detection, and device unpairing
- Fullscreen mounted mode with screen wake lock while work is active and ambient sleep when quiet
- Authoritative local state in the desktop host
- Real Codex conversation history, live turns, streamed messages, interrupts, and approvals
- Provider-neutral TypeScript contracts plus `CodexAdapter` and a realistic `MockAdapter`

## Quick start

```bash
npm install --global @openai/codex@latest
codex login
npm install
npm run dev
```

The Electron host launches a private Codex app-server subprocess, imports the most recently updated
Codex tasks, and opens with a QR code. Scan it from a device on the same Wi-Fi network. For a
production-like run, use `npm run build` followed by `npm start`.

Codex is the default and failures are surfaced rather than silently replaced with fake tasks. For
UI development without a Codex login, set `AGENTDECK_PROVIDER=mock`. Set
`AGENTDECK_CODEX_COMMAND` when `codex` is installed somewhere outside the host's `PATH`.

## Monorepo map

```text
apps/
  dashboard/       React/Vite touchscreen interface
  desktop-host/    Electron lifecycle, auto-start, and QR host window
packages/
  protocol/        Runtime-validated WebSocket protocol and domain types
  shared/          Provider-neutral status and formatting utilities
  server/          Authoritative host, Codex app-server client, CodexAdapter, and MockAdapter
  client/          Reconnecting React client and external store
```

## Provider contract

Every integration implements the same frontend-independent interface:

```ts
interface AgentProvider {
  readonly name: string;
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | undefined>;
  subscribe(listener: AgentProviderListener): () => void;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  interrupt(id: string): Promise<void>;
  sendMessage(id: string, message: string, options?: AgentMessageOptions): Promise<void>;
  createAgent(request: CreateAgentRequest): Promise<Agent>;
  dispose?(): Promise<void> | void;
}
```

Provider events are normalized into the shared protocol. The dashboard never imports a provider,
which keeps future integrations isolated from UI code.

## LAN security model

The host listens on the LAN and generates a four-digit pairing code on every launch. The code is
placed in the QR fragment and required during the WebSocket upgrade. It is a convenience boundary
for trusted local networks, not strong authentication. HTTP responses use a strict content-security
policy and no state-changing HTTP endpoints are exposed. Do not port-forward or publicly host it.

Browsers only grant microphone access in a secure context. Local recording activates on localhost
or a trusted HTTPS origin; recorded audio never leaves the device in this release. On plain LAN
HTTP, the real Codex provider explains that microphone access is unavailable instead of sending a
fake message. Only the explicit MockAdapter development mode simulates a voice note.

## Packaging

`npm run package:desktop` builds an unpacked/installer-ready Electron application with the dashboard
included as a local resource. The desktop host enables launch-at-login in packaged builds. Platform
targets are configured in `apps/desktop-host/package.json`.

## License

MIT
