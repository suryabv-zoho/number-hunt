import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TooltipProvider } from '@/components/ui/tooltip';
import { iconOffline } from '@/icons';
import { useStore } from './store.js';
import { primeSpeech } from './speech.js';
import HomeScreen from './screens/HomeScreen.js';
import LobbyScreen from './screens/LobbyScreen.js';
import GameScreen from './screens/GameScreen.js';
import ResultsScreen from './screens/ResultsScreen.js';
import Toasts from './components/Toasts.js';
import CoachOverlay from './components/CoachOverlay.js';

export default function App() {
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);

  // Browsers won't let a page make noise until someone has interacted with it, and by
  // the time a number is called the listener hasn't touched anything. Spend their very
  // first click on unlocking audio instead.
  useEffect(() => {
    const prime = () => primeSpeech();
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
    return () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('keydown', prime);
    };
  }, []);

  let screen: ReactElement;
  let key: string;
  if (!room) {
    screen = <HomeScreen />;
    key = 'home';
  } else if (room.phase === 'lobby') {
    screen = <LobbyScreen />;
    key = 'lobby';
  } else if (room.phase === 'ended') {
    screen = <ResultsScreen />;
    key = 'results';
  } else {
    screen = <GameScreen />;
    key = 'game';
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col">
        {!connected && (
          <div className="animate-rise flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-extrabold text-on-solid">
            <FontAwesomeIcon icon={iconOffline} />
            Reconnecting — your score is safe
          </div>
        )}
        {/* Keying on the screen replays its entrance animation on every transition. */}
        <div key={key} className="animate-fade flex min-h-0 flex-1 flex-col">
          {screen}
        </div>
        <Toasts />
        <CoachOverlay />
      </div>
    </TooltipProvider>
  );
}
