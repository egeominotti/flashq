import { useEffect, useRef, useState } from 'react';
import { Badge } from '@tremor/react';
import {
  Wifi,
  WifiOff,
  Zap,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Activity,
} from 'lucide-react';
import { cn, formatNumber } from '../../utils';
import type { JobEvent } from '../../hooks/useJobEvents';
import './LiveEventFeed.css';

interface LiveEventFeedProps {
  isConnected: boolean;
  recentEvents: JobEvent[];
  eventCounts: {
    pushed: number;
    completed: number;
    failed: number;
  };
}

const eventConfig: Record<string, { icon: typeof Zap; color: string; label: string }> = {
  pushed: { icon: Zap, color: 'cyan', label: 'Pushed' },
  completed: { icon: CheckCircle2, color: 'emerald', label: 'Completed' },
  failed: { icon: XCircle, color: 'rose', label: 'Failed' },
  progress: { icon: TrendingUp, color: 'blue', label: 'Progress' },
};

interface AnimatedEventProps {
  event: JobEvent;
  onAnimationEnd: () => void;
}

function AnimatedEvent({ event, onAnimationEnd }: AnimatedEventProps) {
  const config = eventConfig[event.event_type] || eventConfig.pushed;
  const Icon = config.icon;

  useEffect(() => {
    const timer = setTimeout(onAnimationEnd, 3000);
    return () => clearTimeout(timer);
  }, [onAnimationEnd]);

  return (
    <div className={cn('live-event-item', `event-${config.color}`, 'event-enter')}>
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
    </div>
  );
}

export function LiveEventFeed({ isConnected, recentEvents, eventCounts }: LiveEventFeedProps) {
  const [visibleEvents, setVisibleEvents] = useState<JobEvent[]>([]);
  const processedIdsRef = useRef<Set<string>>(new Set());

  // Handle new events
  useEffect(() => {
    if (recentEvents.length === 0) return;

    const latestEvent = recentEvents[0];
    const eventKey = `${latestEvent.job_id}-${latestEvent.event_type}-${latestEvent.timestamp}`;

    if (!processedIdsRef.current.has(eventKey)) {
      processedIdsRef.current.add(eventKey);
      setVisibleEvents((prev) => [latestEvent, ...prev].slice(0, 5));

      // Cleanup old keys
      if (processedIdsRef.current.size > 100) {
        const keys = Array.from(processedIdsRef.current);
        keys.slice(0, 50).forEach((k) => processedIdsRef.current.delete(k));
      }
    }
  }, [recentEvents]);

  const handleAnimationEnd = (eventKey: string) => {
    setVisibleEvents((prev) => prev.filter((e) =>
      `${e.job_id}-${e.event_type}-${e.timestamp}` !== eventKey
    ));
  };

  const totalEvents = eventCounts.pushed + eventCounts.completed + eventCounts.failed;

  return (
    <div className="live-event-feed">
      {/* Connection Status */}
      <div className="feed-header">
        <div className={cn('connection-status', isConnected ? 'connected' : 'disconnected')}>
          {isConnected ? (
            <>
              <Wifi className="h-3.5 w-3.5" />
              <span>Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5" />
              <span>Disconnected</span>
            </>
          )}
        </div>
        <div className="feed-stats">
          <div className="feed-stat">
            <Activity className="h-3 w-3" />
            <span>{formatNumber(totalEvents)}</span>
          </div>
        </div>
      </div>

      {/* Event Counters */}
      <div className="event-counters">
        <div className="counter counter-cyan">
          <Zap className="h-3.5 w-3.5" />
          <span className="counter-value">{formatNumber(eventCounts.pushed)}</span>
          <span className="counter-label">pushed</span>
        </div>
        <div className="counter counter-emerald">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="counter-value">{formatNumber(eventCounts.completed)}</span>
          <span className="counter-label">completed</span>
        </div>
        <div className="counter counter-rose">
          <XCircle className="h-3.5 w-3.5" />
          <span className="counter-value">{formatNumber(eventCounts.failed)}</span>
          <span className="counter-label">failed</span>
        </div>
      </div>

      {/* Live Events Stream */}
      <div className="events-stream">
        {visibleEvents.length === 0 ? (
          <div className="events-empty">
            <span>Waiting for events...</span>
          </div>
        ) : (
          visibleEvents.map((event) => {
            const key = `${event.job_id}-${event.event_type}-${event.timestamp}`;
            return (
              <AnimatedEvent
                key={key}
                event={event}
                onAnimationEnd={() => handleAnimationEnd(key)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
