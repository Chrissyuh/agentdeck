import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Radio, Smartphone, Wifi } from 'lucide-react';
import type { AgentDeckActions } from '@agentdeck/client';

export function PairingScreen({ actions }: { actions: AgentDeckActions }) {
  const [serverOrigin, setServerOrigin] = useState(() =>
    window.location.protocol.startsWith('http')
      ? window.location.origin
      : 'http://192.168.1.10:4317',
  );
  const [token, setToken] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    actions.pair({ serverOrigin: serverOrigin.replace(/\/$/, ''), token: token.trim() });
  };

  return (
    <main className="pairing-screen">
      <motion.div
        className="pairing-card"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="pairing-radar">
          <span />
          <span />
          <Radio />
        </div>
        <span className="eyebrow">Local control surface</span>
        <h1>Pair with your desktop</h1>
        <p>Scan the QR code or enter the four-digit code shown by the AgentDeck desktop host.</p>
        <div className="pairing-steps">
          <div>
            <Smartphone />
            <span>
              <strong>Open AgentDeck</strong>
              <small>On your desktop computer</small>
            </span>
          </div>
          <div>
            <Wifi />
            <span>
              <strong>Use the same Wi-Fi</strong>
              <small>No cloud or account required</small>
            </span>
          </div>
        </div>
        <details open>
          <summary>Pair manually</summary>
          <form onSubmit={submit}>
            <label>
              <span>Host address</span>
              <input value={serverOrigin} onChange={(e) => setServerOrigin(e.target.value)} />
            </label>
            <label>
              <span>Four-digit code</span>
              <input
                value={token}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                autoComplete="one-time-code"
                onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </label>
            <button type="submit">Connect</button>
          </form>
        </details>
      </motion.div>
    </main>
  );
}
