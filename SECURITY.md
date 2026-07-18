# Security

AgentDeck is intentionally local-first. The host binds to your LAN so paired devices can connect,
but it does not use a cloud relay or analytics service.

Pairing links contain a per-process four-digit code. This is a convenience boundary against
accidental connections, not strong authentication. Restart the desktop host to rotate the code.
AgentDeck is designed for trusted home and office networks; do not expose its port to the public
internet.

Please report security issues privately through GitHub's security advisory feature rather than a
public issue.
