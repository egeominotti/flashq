import { useEffect, useRef, useState, useMemo } from 'react';
import { Badge } from '@tremor/react';
import {
  Wifi,
  WifiOff,
  Zap,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Activity,
  Flame,
  BarChart3,
  Radio,
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

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

interface AnimatedEventProps {
  event: JobEvent;
  isNew?: boolean;
}

function AnimatedEvent({ event, isNew }: AnimatedEventProps) {
  const config = eventConfig[event.event_type] || eventConfig.pushed;
  const Icon = config.icon;
  const [timeAgo, setTimeAgo] = useState(formatTimeAgo(event.timestamp));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(event.timestamp));
    }, 5000);
    return () => clearInterval(interval);
  }, [event.timestamp]);

  return (
    <div className={cn('live-event-item', `event-${config.color}`, isNew && 'event-new')}>
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
}

function ActivityBar({ value, max, color }: { value: number; max: number; color: string }) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="activity-bar">
      <div
        className={cn('activity-bar-fill', `bar-${color}`)}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function MiniSparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - (v / max) * 100;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg className="mini-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LiveEventFeed({ isConnected, recentEvents, eventCounts }: LiveEventFeedProps) {
  const [eventHistory, setEventHistory] = useState<JobEvent[]>([]);
  const [throughput, setThroughput] = useState(0);
  const [activityData, setActivityData] = useState<number[]>(new Array(20).fill(0));
  const lastCountRef = useRef(0);
  const processedIdsRef = useRef<Set<string>>(new Set());

  // Track throughput
  useEffect(() => {
    const total = eventCounts.pushed + eventCounts.completed + eventCounts.failed;
    const diff = total - lastCountRef.current;
    if (diff > 0) {
      setThroughput(diff);
      setActivityData(prev => [...prev.slice(1), diff]);
    }
    lastCountRef.current = total;
  }, [eventCounts]);

  // Reset throughput after 2 seconds of inactivity
  useEffect(() => {
    const timer = setTimeout(() => setThroughput(0), 2000);
    return () => clearTimeout(timer);
  }, [throughput]);

  // Handle new events
  useEffect(() => {
    if (recentEvents.length === 0) return;

    const newEvents: JobEvent[] = [];
    for (const event of recentEvents) {
      const eventKey = `${event.job_id}-${event.event_type}-${event.timestamp}`;
      if (!processedIdsRef.current.has(eventKey)) {
        processedIdsRef.current.add(eventKey);
        newEvents.push(event);
      }
    }

    if (newEvents.length > 0) {
      setEventHistory(prev => [...newEvents, ...prev].slice(0, 10));
    }

    // Cleanup old keys
    if (processedIdsRef.current.size > 200) {
      const keys = Array.from(processedIdsRef.current);
      keys.slice(0, 100).forEach(k => processedIdsRef.current.delete(k));
    }
  }, [recentEvents]);

  const totalEvents = eventCounts.pushed + eventCounts.completed + eventCounts.failed;
  const successRate = useMemo(() => {
    const total = eventCounts.completed + eventCounts.failed;
    return total > 0 ? ((eventCounts.completed / total) * 100).toFixed(1) : '100';
  }, [eventCounts]);

  const maxCount = Math.max(eventCounts.pushed, eventCounts.completed, eventCounts.failed, 1);

  return (
    <div className={cn('live-event-feed', isConnected && throughput > 0 && 'feed-active')}>
      {/* Left Section: Status + Throughput */}
      <div className="feed-section feed-status">
        <div className="feed-header">
          <div className="feed-title">
            <Radio className={cn('h-4 w-4', isConnected && 'icon-pulse')} />
            <span>Live Feed</span>
          </div>
          <div className={cn('connection-badge', isConnected ? 'connected' : 'disconnected')}>
            {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span>{isConnected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
        <div className="throughput-display">
          <div className="throughput-main">
            <Flame className={cn('h-5 w-5', throughput > 0 && 'icon-fire')} />
            <span className="throughput-number">{throughput}</span>
            <span className="throughput-label">events/s</span>
          </div>
          <div className="throughput-sparkline">
            <MiniSparkline data={activityData} />
          </div>
        </div>
      </div>

      {/* Middle Section: Stats */}
      <div className="feed-section feed-stats">
        <div className="stat-item stat-cyan">
          <div className="stat-icon">
            <Zap className="h-4 w-4" />
          </div>
          <div className="stat-content">
            <span className="stat-value">{formatNumber(eventCounts.pushed)}</span>
            <span className="stat-label">Pushed</span>
          </div>
          <ActivityBar value={eventCounts.pushed} max={maxCount} color="cyan" />
        </div>

        <div className="stat-item stat-emerald">
          <div className="stat-icon">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="stat-content">
            <span className="stat-value">{formatNumber(eventCounts.completed)}</span>
            <span className="stat-label">Completed</span>
          </div>
          <ActivityBar value={eventCounts.completed} max={maxCount} color="emerald" />
        </div>

        <div className="stat-item stat-rose">
          <div className="stat-icon">
            <XCircle className="h-4 w-4" />
          </div>
          <div className="stat-content">
            <span className="stat-value">{formatNumber(eventCounts.failed)}</span>
            <span className="stat-label">Failed</span>
          </div>
          <ActivityBar value={eventCounts.failed} max={maxCount} color="rose" />
        </div>

        <div className="stat-item stat-success">
          <div className="stat-icon">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div className="stat-content">
            <span className="stat-value">{successRate}%</span>
            <span className="stat-label">Success</span>
          </div>
          <div className="success-bar">
            <div className="success-bar-fill" style={{ width: `${successRate}%` }} />
          </div>
        </div>

        <div className="stat-item stat-total">
          <div className="stat-icon">
            <Activity className="h-4 w-4" />
          </div>
          <div className="stat-content">
            <span className="stat-value">{formatNumber(totalEvents)}</span>
            <span className="stat-label">Total</span>
          </div>
        </div>
      </div>

      {/* Right Section: Recent Events */}
      <div className="feed-section feed-events">
        <div className="events-label">Recent Events</div>
        <div className="events-stream">
          {eventHistory.length === 0 ? (
            <div className="events-empty">
              <span>Waiting for events...</span>
            </div>
          ) : (
            eventHistory.slice(0, 5).map((event, index) => {
              const key = `${event.job_id}-${event.event_type}-${event.timestamp}`;
              return (
                <AnimatedEvent
                  key={key}
                  event={event}
                  isNew={index === 0}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
