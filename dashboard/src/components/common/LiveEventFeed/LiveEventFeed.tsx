import { useEffect, useRef, useState, useMemo } from 'react';
import { Badge } from '@tremor/react';
import { Wifi, WifiOff, Flame, Radio, Volume2, VolumeX, Filter, AlertTriangle, Activity } from 'lucide-react';
import { cn, formatNumber } from '../../../utils';
import { useSoundNotification } from './useSoundNotification';
import { ThroughputChart } from './ThroughputChart';
import { QueueHealth } from './QueueHealth';
import { ParticleEffect } from './ParticleEffect';
import { AnimatedEvent } from './AnimatedEvent';
import { LatencyMetric } from './LatencyMetric';
import { EventDetailModal } from './EventDetailModal';
import { StatsRow } from './StatsRow';
import type { LiveEventFeedProps, JobEvent } from './types';
import '../LiveEventFeed.css';

export function LiveEventFeed({ isConnected, recentEvents, eventCounts }: LiveEventFeedProps) {
  const [selectedEvent, setSelectedEvent] = useState<JobEvent | null>(null);
  const [eventHistory, setEventHistory] = useState<JobEvent[]>([]);
  const [throughput, setThroughput] = useState(0);
  const [throughputHistory, setThroughputHistory] = useState<number[]>(new Array(60).fill(0));
  const [queueStats, setQueueStats] = useState<Record<string, number>>({});
  const [latencyStats, setLatencyStats] = useState({ avg: 0, min: Infinity, max: 0 });
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [filterQueue, setFilterQueue] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [particleTrigger, setParticleTrigger] = useState<{
    active: boolean;
    type: 'pushed' | 'completed' | 'failed';
  }>({ active: false, type: 'pushed' });
  const [timeTick, setTimeTick] = useState(0);

  const lastCountRef = useRef(0);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const lastEventTimeRef = useRef<Record<number, number>>({});
  const maxThroughputRef = useRef(10);

  const playSound = useSoundNotification();

  // Track throughput with 60-second history
  useEffect(() => {
    const total = eventCounts.pushed + eventCounts.completed + eventCounts.failed;
    const diff = total - lastCountRef.current;

    if (diff > 0) {
      setThroughput(diff);
      setThroughputHistory((prev) => [...prev.slice(1), diff]);
      maxThroughputRef.current = Math.max(maxThroughputRef.current, diff);

      if (diff > 5) {
        setParticleTrigger({ active: true, type: 'pushed' });
        setTimeout(() => setParticleTrigger((p) => ({ ...p, active: false })), 100);
      }

      if (soundEnabled && diff > 10) {
        playSound('burst');
      }
    }
    lastCountRef.current = total;
  }, [eventCounts, soundEnabled, playSound]);

  // Reset throughput after inactivity
  useEffect(() => {
    const timer = setTimeout(() => setThroughput(0), 2000);
    return () => clearTimeout(timer);
  }, [throughput]);

  // Decay max throughput over time AND update time tick for AnimatedEvent
  useEffect(() => {
    const interval = setInterval(() => {
      maxThroughputRef.current = Math.max(10, maxThroughputRef.current * 0.95);
      setTimeTick((t) => t + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle new events
  useEffect(() => {
    if (recentEvents.length === 0) return;

    const newEvents: JobEvent[] = [];
    const queueCounts: Record<string, number> = { ...queueStats };
    const latencies: number[] = [];

    for (const event of recentEvents) {
      const eventKey = `${event.job_id}-${event.event_type}-${event.timestamp}`;
      if (!processedIdsRef.current.has(eventKey)) {
        processedIdsRef.current.add(eventKey);
        newEvents.push(event);

        queueCounts[event.queue] = (queueCounts[event.queue] || 0) + 1;

        if (event.event_type === 'completed' && lastEventTimeRef.current[event.job_id]) {
          const latency = event.timestamp - lastEventTimeRef.current[event.job_id];
          if (latency > 0 && latency < 300000) {
            latencies.push(latency);
          }
          delete lastEventTimeRef.current[event.job_id];
        }

        if (event.event_type === 'pushed') {
          lastEventTimeRef.current[event.job_id] = event.timestamp;
        }

        if (event.event_type === 'failed' && soundEnabled) {
          playSound('error');
          setParticleTrigger({ active: true, type: 'failed' });
          setTimeout(() => setParticleTrigger((p) => ({ ...p, active: false })), 100);
        }
      }
    }

    if (newEvents.length > 0) {
      setEventHistory((prev) => [...newEvents, ...prev].slice(0, 50));
      setQueueStats(queueCounts);

      if (latencies.length > 0) {
        setLatencyStats((prev) => {
          const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
          const prevAvg = prev.avg > 0 ? prev.avg : avg;
          return {
            avg: (prevAvg + avg) / 2,
            min: Math.min(prev.min, ...latencies),
            max: Math.max(prev.max, ...latencies),
          };
        });
      }
    }
  }, [recentEvents, soundEnabled, playSound, queueStats]);

  // Periodic cleanup of old tracking data
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      if (processedIdsRef.current.size > 500) {
        const keys = Array.from(processedIdsRef.current);
        keys.slice(0, 250).forEach((k) => processedIdsRef.current.delete(k));
      }

      const now = Date.now();
      Object.keys(lastEventTimeRef.current).forEach((key) => {
        if (now - lastEventTimeRef.current[Number(key)] > 60000) {
          delete lastEventTimeRef.current[Number(key)];
        }
      });
    }, 30000);

    return () => clearInterval(cleanupInterval);
  }, []);

  const totalEvents = eventCounts.pushed + eventCounts.completed + eventCounts.failed;
  const successRate = useMemo(() => {
    const total = eventCounts.completed + eventCounts.failed;
    return total > 0 ? ((eventCounts.completed / total) * 100).toFixed(1) : '100';
  }, [eventCounts]);

  const filteredEvents = useMemo(() => {
    return eventHistory.filter((e) => {
      if (filterQueue !== 'all' && e.queue !== filterQueue) return false;
      if (filterType !== 'all' && e.event_type !== filterType) return false;
      return true;
    });
  }, [eventHistory, filterQueue, filterType]);

  const uniqueQueues = useMemo(() => {
    return Array.from(new Set(eventHistory.map((e) => e.queue)));
  }, [eventHistory]);

  const topQueues = useMemo(() => {
    return Object.entries(queueStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [queueStats]);

  const totalQueueEvents = Object.values(queueStats).reduce((a, b) => a + b, 0);

  return (
    <div className="live-feed-wrapper">
      <div className={cn('live-feed-advanced', isConnected && throughput > 0 && 'feed-active')}>
        <ParticleEffect active={particleTrigger.active} type={particleTrigger.type} />

        <div className="feed-header-row">
          <div className="feed-title-section">
            <Radio className={cn('h-5 w-5', isConnected && 'icon-pulse')} />
            <span className="feed-title">Live Monitor</span>
            <div className={cn('connection-badge', isConnected ? 'connected' : 'disconnected')}>
              {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span>{isConnected ? 'Connected' : 'Offline'}</span>
            </div>
          </div>

          <div className="feed-controls">
            <button
              className={cn('sound-toggle', soundEnabled && 'enabled')}
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Disable sound' : 'Enable sound'}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="feed-grid">
          <div className="feed-chart-section">
            <div className="chart-header">
              <div className="chart-title">
                <Flame className={cn('h-5 w-5', throughput > 0 && 'icon-fire')} />
                <span>Throughput</span>
              </div>
              <div className="chart-value">
                <span className="throughput-number">{formatNumber(throughput)}</span>
                <span className="throughput-unit">/s</span>
              </div>
            </div>
            <div className="chart-container">
              <ThroughputChart data={throughputHistory} maxValue={maxThroughputRef.current} />
              <div className="chart-labels">
                <span>60s ago</span>
                <span>now</span>
              </div>
            </div>
          </div>

          <div className="feed-stats-section">
            <StatsRow
              pushed={eventCounts.pushed}
              completed={eventCounts.completed}
              failed={eventCounts.failed}
              successRate={successRate}
            />
            <div className="queue-breakdown">
              <div className="breakdown-header">
                <Activity className="h-4 w-4" />
                <span>Queue Activity</span>
                {topQueues.length > 0 && topQueues[0][1] > totalQueueEvents * 0.3 && (
                  <Badge size="xs" color="amber" className="ml-auto">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Hot
                  </Badge>
                )}
              </div>
              <div className="queue-list">
                {topQueues.length === 0 ? (
                  <div className="queue-empty">No activity yet</div>
                ) : (
                  topQueues.map(([queue, count]) => (
                    <QueueHealth
                      key={queue}
                      queue={queue}
                      events={count}
                      totalEvents={totalQueueEvents}
                    />
                  ))
                )}
              </div>
            </div>

            <LatencyMetric
              avgLatency={latencyStats.avg || 0}
              minLatency={latencyStats.min === Infinity ? 0 : latencyStats.min}
              maxLatency={latencyStats.max || 0}
            />
          </div>
        </div>
      </div>

      <div className="event-stream-section">
        <div className="event-stream-header">
          <div className="event-stream-title">
            <Activity className="h-5 w-5" />
            <span>Event Stream</span>
            <span className="event-stream-count">{formatNumber(totalEvents)} events</span>
          </div>
          <div className="event-stream-filters">
            <Filter className="h-4 w-4" />
            <select
              value={filterQueue}
              onChange={(e) => setFilterQueue(e.target.value)}
              className="stream-filter-select"
            >
              <option value="all">All Queues</option>
              {uniqueQueues.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="stream-filter-select"
            >
              <option value="all">All Types</option>
              <option value="pushed">Pushed</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div className="event-stream-list">
          {filteredEvents.length === 0 ? (
            <div className="events-empty-large">
              <Radio className="h-8 w-8 opacity-30" />
              <span>Waiting for events...</span>
            </div>
          ) : (
            filteredEvents.slice(0, 15).map((event, index) => {
              const key = `${event.job_id}-${event.event_type}-${event.timestamp}`;
              return (
                <AnimatedEvent
                  key={key}
                  event={event}
                  isNew={index === 0}
                  onClick={() => setSelectedEvent(event)}
                  tick={timeTick}
                />
              );
            })
          )}
        </div>
      </div>

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
