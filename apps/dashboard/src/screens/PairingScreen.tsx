import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Radio, Smartphone, Wifi } from 'lucide-react';
import type { AgentDeckActions } from '@agentdeck/client';

export function PairingScreen({ actions }: { actions: AgentDeckActions }) {
  const [serverOrigin, setServerOrigin] = useState('http://192.168.1.10:4317');
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
        <p>
          Scan the QR code in the AgentDeck desktop host. This device will reconnect automatically.
        </p>
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
        <details>
          <summary>Pair manually</summary>
          <form onSubmit={submit}>
            <label>
              <span>Host address</span>
              <input value={serverOrigin} onChange={(e) => setServerOrigin(e.target.value)} />
            </label>
            <label>
              <span>Pairing token</span>
              <input value={token} onChange={(e) => setToken(e.target.value)} required />
            </label>
            <button type="submit">Connect</button>
          </form>
        </details>
      </motion.div>
    </main>
  );
}
