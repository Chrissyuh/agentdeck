import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAgentDeck } from '@agentdeck/client';
import { usePreferences } from './preferences';
import { useChatUpdateFeedback, useMountedDisplay } from './hooks';
import { HomeScreen } from './screens/HomeScreen';
import { PairingScreen } from './screens/PairingScreen';
import { ConnectionRecoveryScreen } from './screens/ConnectionRecoveryScreen';
import { AmbientScreen } from './screens/AmbientScreen';

export function App() {
  const { snapshot, actions } = useAgentDeck();
  useChatUpdateFeedback(snapshot.agents);
  const preferences = usePreferences();
  const hasActiveAgent = snapshot.agents.some((agent) =>
    ['thinking', 'working', 'awaiting_approval'].includes(agent.status),
  );
  const mountedDisplay = useMountedDisplay(
    preferences.preferences.mountedMode,
    hasActiveAgent,
    (mountedMode) => preferences.patch({ mountedMode }),
  );
  const [ambientSleeping, setAmbientSleeping] = useState(false);
  const [sleepCycle, setSleepCycle] = useState(0);

  useEffect(() => {
    if (hasActiveAgent || snapshot.status !== 'connected') {
      setAmbientSleeping(false);
      return;
    }
    const timer = window.setTimeout(() => setAmbientSleeping(true), 90_000);
    return () => window.clearTimeout(timer);
  }, [hasActiveAgent, sleepCycle, snapshot.status]);

  if (snapshot.status === 'unpaired') return <PairingScreen actions={actions} />;
  if (snapshot.status !== 'connected' && snapshot.agents.length === 0) {
    return <ConnectionRecoveryScreen snapshot={snapshot} actions={actions} />;
  }
  if (ambientSleeping) {
    return (
      <AmbientScreen
        agentCount={snapshot.agents.length}
        onWake={() => {
          setAmbientSleeping(false);
          setSleepCycle((cycle) => cycle + 1);
        }}
      />
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <HomeScreen
        key="home"
        snapshot={snapshot}
        actions={actions}
        preferences={preferences}
        mountedDisplay={mountedDisplay}
      />
    </AnimatePresence>
  );
}
