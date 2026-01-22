import { memo } from 'react';
import { Badge } from '@tremor/react';
import { cn } from '../../../utils';
import { eventConfig, formatTimeAgo } from './types';
import type { JobEvent } from './types';

interface AnimatedEventProps {
  event: JobEvent;
  isNew?: boolean;
  onClick?: () => void;
  tick: number;
}

export const AnimatedEvent = memo(function AnimatedEvent({
  event,
  isNew,
  onClick,
  tick,
}: AnimatedEventProps) {
  const config = eventConfig[event.event_type] || eventConfig.pushed;
  const Icon = config.icon;
  const timeAgo = formatTimeAgo(event.timestamp);
  void tick; // Used to trigger re-render

  return (
    <div
      className={cn(
        'live-event-item',
        `event-${config.color}`,
        isNew && 'event-new',
        onClick && 'event-clickable'
      )}
      onClick={onClick}
    >
      <div className="event-icon">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="event-info">
        <span className="event-type">{config.label}</span>
        <span className="event-job">#{event.job_id}</span>
      </div>
      <Badge size="xs" color={config.color as 'cyan'}>
        {event.queue}
      </Badge>
      <span className="event-time">{timeAgo}</span>
    </div>
  );
});
