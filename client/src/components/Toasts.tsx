import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { cn } from 'cn';
import { iconFound, iconInfo, iconWrong } from '@/icons';
import { useStore } from '../store.js';

const TONE = {
  good: { cls: 'bg-mint-100 text-success', icon: iconFound },
  bad: { cls: 'bg-danger-100 text-destructive', icon: iconWrong },
  info: { cls: 'bg-brand-100 text-foreground', icon: iconInfo },
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
              'animate-pop card-shadow flex items-center gap-2.5 rounded-full px-5 py-2.5 text-base font-extrabold',
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
