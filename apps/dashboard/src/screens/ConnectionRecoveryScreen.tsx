import { motion } from 'framer-motion';
import { Unlink, WifiOff } from 'lucide-react';
import type { AgentDeckActions, AgentDeckSnapshot } from '@agentdeck/client';

interface ConnectionRecoveryScreenProps {
  snapshot: AgentDeckSnapshot;
  actions: AgentDeckActions;
}

export function ConnectionRecoveryScreen({ snapshot, actions }: ConnectionRecoveryScreenProps) {
  return (
    <main className="connection-recovery">
      <motion.section
        className="recovery-module"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        aria-labelledby="recovery-title"
      >
        <span className="recovery-code">LINK // 00</span>
        <div className="recovery-glyph" aria-hidden="true">
          <WifiOff />
        </div>
        <div className="recovery-copy">
          <small>{snapshot.status}</small>
          <h1 id="recovery-title">Host not responding</h1>
          <p>
            AgentDeck is retrying automatically. Unpair this device to enter the current host and
            four-digit code.
          </p>
          {snapshot.lastError ? <em>{snapshot.lastError}</em> : null}
        </div>
        <button type="button" onClick={() => actions.unpair()}>
          <Unlink />
          <span>
            <strong>Unpair this device</strong>
            <small>Forget the saved host and return to pairing</small>
          </span>
        </button>
      </motion.section>
    </main>
  );
}
