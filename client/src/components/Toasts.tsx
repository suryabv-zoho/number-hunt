import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { cn } from 'cn';
import { iconFound, iconInfo, iconWrong } from '@/icons';
import { useStore } from '../store.js';

const TONE = {
  good: { cls: 'border-success/50 text-success', icon: iconFound },
  bad: { cls: 'border-destructive/50 text-destructive', icon: iconWrong },
  info: { cls: 'border-border text-foreground', icon: iconInfo },
} as const;

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            className={cn(
              'animate-pop flex items-center gap-2.5 rounded-full border bg-popover px-4 py-2 text-sm font-medium shadow-xl shadow-black/40',
              tone.cls,
            )}
          >
            <FontAwesomeIcon icon={tone.icon} />
            {t.text}
          </div>
        );
      })}
    </div>
  );
}
