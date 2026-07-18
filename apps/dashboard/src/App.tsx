import { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAgentDeck } from '@agentdeck/client';
import { usePreferences } from './preferences';
import { useMountedDisplay } from './hooks';
import { HomeScreen } from './screens/HomeScreen';
import { AgentScreen } from './screens/AgentScreen';
import { PairingScreen } from './screens/PairingScreen';
import { AmbientScreen } from './screens/AmbientScreen';

export function App() {
  const { snapshot, actions } = useAgentDeck();
  const preferences = usePreferences();
  const hasActiveAgent = snapshot.agents.some((agent) =>
    ['thinking', 'working', 'awaiting_approval'].includes(agent.status),
  );
  const mountedDisplay = useMountedDisplay(
    preferences.preferences.mountedMode,
    hasActiveAgent,
    (mountedMode) => preferences.patch({ mountedMode }),
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [composeOnOpen, setComposeOnOpen] = useState(false);
  const [ambientSleeping, setAmbientSleeping] = useState(false);
  const [sleepCycle, setSleepCycle] = useState(0);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId);

  useEffect(() => {
    if (selectedAgentId && snapshot.agents.length > 0 && !selectedAgent) setSelectedAgentId(null);
  }, [selectedAgent, selectedAgentId, snapshot.agents.length]);

  useEffect(() => {
    if (hasActiveAgent || snapshot.status !== 'connected') {
      setAmbientSleeping(false);
      return;
    }
    const timer = window.setTimeout(() => setAmbientSleeping(true), 90_000);
    return () => window.clearTimeout(timer);
  }, [hasActiveAgent, sleepCycle, snapshot.status]);

  if (snapshot.status === 'unpaired') return <PairingScreen actions={actions} />;
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
      {selectedAgent ? (
        <AgentScreen
          key={selectedAgent.id}
          agent={selectedAgent}
          actions={actions}
          preferences={preferences}
          initialComposerOpen={composeOnOpen}
          onBack={() => {
            setSelectedAgentId(null);
            setComposeOnOpen(false);
          }}
        />
      ) : (
        <HomeScreen
          key="home"
          snapshot={snapshot}
          actions={actions}
          preferences={preferences}
          mountedDisplay={mountedDisplay}
          onOpenAgent={(agentId, compose = false) => {
            setComposeOnOpen(compose);
            setSelectedAgentId(agentId);
          }}
        />
      )}
    </AnimatePresence>
  );
}
