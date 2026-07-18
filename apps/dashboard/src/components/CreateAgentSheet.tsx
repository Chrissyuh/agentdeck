import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import type { AgentDeckActions } from '@agentdeck/client';
import { haptic } from '../hooks';

export function CreateAgentSheet({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: AgentDeckActions;
}) {
  const [name, setName] = useState('Nova');
  const [projectName, setProjectName] = useState('New project');
  const [initialMessage, setInitialMessage] = useState(
    'Inspect the workspace and report what you find.',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await actions.createAgent({ name, projectName, initialMessage });
      haptic([10, 20, 15]);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not create the agent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="sheet-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.form
            className="bottom-sheet compact-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Spawn a mock agent"
            initial={{ y: '105%' }}
            animate={{ y: 0 }}
            exit={{ y: '105%' }}
            transition={{ type: 'spring', stiffness: 310, damping: 34 }}
            onSubmit={(event) => void submit(event)}
          >
            <div className="sheet-header">
              <div>
                <span className="eyebrow">Mock provider</span>
                <h2>Spawn an agent</h2>
              </div>
              <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
                <X />
              </button>
            </div>
            <div className="form-grid">
              <label>
                <span>Agent name</span>
                <input
                  value={name}
                  maxLength={48}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>Project</span>
                <input
                  value={projectName}
                  maxLength={80}
                  onChange={(event) => setProjectName(event.target.value)}
                  required
                />
              </label>
            </div>
            <label>
              <span>First direction</span>
              <textarea
                value={initialMessage}
                maxLength={500}
                rows={3}
                onChange={(event) => setInitialMessage(event.target.value)}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="primary-submit" type="submit" disabled={busy}>
              <Plus /> {busy ? 'Spawning…' : 'Spawn agent'}
            </button>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
