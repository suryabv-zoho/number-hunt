import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from 'cn';
import { iconAccept, iconSoundOff, iconSoundOn, iconTheme } from '@/icons';
import { THEMES, applyTheme } from '../themes.js';
import { useStore } from '../store.js';

/**
 * Personal settings, as opposed to the room's match settings in the lobby: these are
 * this player's own preferences and never touch anybody else's game.
 */
export default function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const speak = useStore((s) => s.speak);
  const speechBlocked = useStore((s) => s.speechBlocked);
  const toggleSpeak = useStore((s) => s.toggleSpeak);

  function choose(id: string) {
    applyTheme(id);
    setTheme(id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Just for you — nothing here changes the match for anyone else.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2.5">
          <h3 className="flex items-center gap-2 text-xs font-extrabold tracking-[0.15em] text-muted-foreground uppercase">
            <FontAwesomeIcon icon={iconTheme} />
            colour theme
          </h3>

          <div className="grid gap-2">
            {THEMES.map((t) => {
              const active = t.id === theme;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => choose(t.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors',
                    active
                      ? 'border-primary bg-tint-primary'
                      : 'border-border bg-surface hover:border-primary/50',
                  )}
                >
                  {/* Real colours from the theme, so the preview can't drift from it. */}
                  <span
                    className="flex size-10 shrink-0 overflow-hidden rounded-full border border-border"
                    aria-hidden
                  >
                    {t.swatch.map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-extrabold">{t.name}</span>
                    <span className="block text-sm text-muted-foreground">{t.blurb}</span>
                  </span>
                  {active && (
                    <FontAwesomeIcon icon={iconAccept} className="shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2.5">
          <h3 className="flex items-center gap-2 text-xs font-extrabold tracking-[0.15em] text-muted-foreground uppercase">
            <FontAwesomeIcon icon={speak ? iconSoundOn : iconSoundOff} />
            sound
          </h3>
          <button
            type="button"
            onClick={toggleSpeak}
            aria-pressed={speak}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors',
              speak ? 'border-primary bg-tint-primary' : 'border-border bg-surface',
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base font-extrabold">
                Read called numbers aloud
              </span>
              <span className="block text-sm text-muted-foreground">
                {speak && speechBlocked
                  ? "Your browser blocked the voice — you'll still hear the chime."
                  : 'A chime, then the number spoken, each time someone calls.'}
              </span>
            </span>
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border-2',
                speak ? 'border-primary text-primary' : 'border-border text-transparent',
              )}
            >
              <FontAwesomeIcon icon={iconAccept} className="text-xs" />
            </span>
          </button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
