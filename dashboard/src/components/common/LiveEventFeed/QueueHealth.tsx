import { memo } from 'react';
import { Thermometer } from 'lucide-react';
import { cn } from '../../../utils';

interface QueueHealthProps {
  queue: string;
  events: number;
  totalEvents: number;
}

export const QueueHealth = memo(function QueueHealth({ queue, events, totalEvents }: QueueHealthProps) {
  const percentage = totalEvents > 0 ? (events / totalEvents) * 100 : 0;
  const isHot = percentage > 30;
  const isWarm = percentage > 15;

  return (
    <div className={cn('queue-health-item', isHot && 'hot', isWarm && !isHot && 'warm')}>
      <div className="queue-health-bar">
        <div className="queue-health-fill" style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>
      <div className="queue-health-info">
        <span className="queue-health-name">{queue}</span>
        <span className="queue-health-count">{events}</span>
      </div>
      {isHot && <Thermometer className="queue-health-icon h-3 w-3" />}
    </div>
  );
});
