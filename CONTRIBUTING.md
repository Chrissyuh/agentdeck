# Contributing

AgentDeck is a TypeScript monorepo built around a provider-neutral protocol. Provider integrations
belong behind `AgentProvider`; dashboard code should never import a provider implementation.

## Local development

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev`.
4. Scan the QR code shown by the desktop host, or open its pairing URL on a LAN device.

Before opening a pull request, run `npm test`, `npm run typecheck`, and `npm run build`.
