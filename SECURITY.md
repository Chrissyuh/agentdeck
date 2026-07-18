# Security

AgentDeck is intentionally local-first. The host binds to your LAN so paired devices can connect,
but it does not use a cloud relay or analytics service.

Pairing links contain a random, per-process token. Treat the QR code like a local password. Restart
the desktop host to rotate the token. AgentDeck is designed for trusted home and office networks;
do not expose its port to the public internet.

Please report security issues privately through GitHub's security advisory feature rather than a
public issue.
