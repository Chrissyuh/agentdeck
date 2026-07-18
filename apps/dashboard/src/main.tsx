import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentDeckProvider } from '@agentdeck/client';
import { App } from './App';
import './styles.css';
import './console.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgentDeckProvider>
      <App />
    </AgentDeckProvider>
  </StrictMode>,
);
