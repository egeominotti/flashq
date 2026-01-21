import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
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
  Volume2,
  VolumeX,
  Filter,
  Clock,
  AlertTriangle,
  Thermometer,
  X,
  Copy,
  Check,
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

// Sound notification hook
function useSoundNotification() {
  const audioContextRef = useRef<AudioContext | null>(null);

  const playSound = useCallback((type: 'error' | 'burst') => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
    }
    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (type === 'error') {
      oscillator.frequency.value = 220;
      oscillator.type = 'sine';
    } else {
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
    }

    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  }, []);

  return playSound;
}

// Animated area chart component
function ThroughputChart({ data, maxValue }: { data: number[]; maxValue: number }) {
  const max = Math.max(maxValue, Math.max(...data), 1);

  // Create smooth path for area
  const createPath = (values: number[], height: number) => {
    const width = 100;
    const points = values.map((v, i) => ({
      x: (i / (values.length - 1)) * width,
      y: height - (v / max) * height,
    }));

    if (points.length < 2) return '';

    // Smooth curve using bezier
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      path += ` Q ${prev.x + (curr.x - prev.x) / 4} ${prev.y}, ${cpx} ${(prev.y + curr.y) / 2}`;
      path += ` Q ${curr.x - (curr.x - prev.x) / 4} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    return path;
  };

  const linePath = createPath(data, 100);
  const areaPath = linePath + ` L 100 100 L 0 100 Z`;

  return (
    <svg className="throughput-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="1" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      {/* Area fill */}
      <path d={areaPath} fill="url(#areaGradient)" />
      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke="url(#lineGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Current value dot */}
      {data.length > 0 && (
        <circle
          cx="100"
          cy={100 - (data[data.length - 1] / max) * 100}
          r="3"
          fill="#00d4ff"
          className="pulse-dot"
        />
      )}
    </svg>
  );
}

// Queue health indicator
function QueueHealth({
  queue,
  events,
  totalEvents,
}: {
  queue: string;
  events: number;
  totalEvents: number;
}) {
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
}

// Particle system for visual effects
function ParticleEffect({
  active,
  type,
}: {
  active: boolean;
  type: 'pushed' | 'completed' | 'failed';
}) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const newParticles = Array.from({ length: 5 }, () => ({
      id: idRef.current++,
      x: Math.random() * 100,
      y: Math.random() * 100,
    }));

    setParticles((prev) => [...prev, ...newParticles].slice(-20));

    const timer = setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 1000);

    return () => clearTimeout(timer);
  }, [active]);

  const colorClass =
    type === 'pushed'
      ? 'particle-cyan'
      : type === 'completed'
        ? 'particle-emerald'
        : 'particle-rose';

  return (
    <div className="particle-container">
      {particles.map((p) => (
        <div
          key={p.id}
          className={cn('particle', colorClass)}
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        />
      ))}
    </div>
  );
}

// Animated event item
function AnimatedEvent({
  event,
  isNew,
  onClick,
}: {
  event: JobEvent;
  isNew?: boolean;
  onClick?: () => void;
}) {
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
}

// Latency display component
function LatencyMetric({
  avgLatency,
  minLatency,
  maxLatency,
}: {
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
}) {
  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const latencyColor = avgLatency < 100 ? 'emerald' : avgLatency < 500 ? 'amber' : 'rose';

  return (
    <div className="latency-metric">
      <div className="latency-header">
        <Clock className="h-4 w-4" />
        <span>Latency</span>
      </div>
      <div className="latency-values">
        <div className={cn('latency-main', `latency-${latencyColor}`)}>
          {formatLatency(avgLatency)}
        </div>
        <div className="latency-range">
          <span className="latency-min">{formatLatency(minLatency)}</span>
          <span className="latency-sep">-</span>
          <span className="latency-max">{formatLatency(maxLatency)}</span>
        </div>
      </div>
    </div>
  );
}

// Event Detail Modal
function EventDetailModal({ event, onClose }: { event: JobEvent; onClose: () => void }) {
  const config = eventConfig[event.event_type] || eventConfig.pushed;
  const Icon = config.icon;
  const [copied, setCopied] = useState(false);

  const formatTimestamp = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  const handleCopyId = async () => {
    await navigator.clipboard.writeText(String(event.job_id));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="event-modal-overlay" onClick={onClose}>
      <div className="event-modal" onClick={(e) => e.stopPropagation()}>
        <div className="event-modal-header">
          <div className="event-modal-title">
            <div className={cn('event-modal-icon', `icon-${config.color}`)}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h3>Job #{event.job_id}</h3>
              <Badge size="sm" color={config.color as 'cyan'}>
                {config.label}
              </Badge>
            </div>
          </div>
          <button className="event-modal-close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="event-modal-content">
          <div className="event-detail-grid">
            <div className="event-detail-item">
              <span className="event-detail-label">Job ID</span>
              <div className="event-detail-value-row">
                <span className="event-detail-value font-mono">{event.job_id}</span>
                <button className="copy-btn" onClick={handleCopyId} title="Copy Job ID">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="event-detail-item">
              <span className="event-detail-label">Queue</span>
              <Badge size="xs" color="cyan">
                {event.queue}
              </Badge>
            </div>
            <div className="event-detail-item">
              <span className="event-detail-label">Event Type</span>
              <span className="event-detail-value">{config.label}</span>
            </div>
            <div className="event-detail-item">
              <span className="event-detail-label">Timestamp</span>
              <span className="event-detail-value">{formatTimestamp(event.timestamp)}</span>
            </div>
            {event.data !== undefined && event.data !== null && (
              <div className="event-detail-item full-width">
                <span className="event-detail-label">Data</span>
                <pre className="event-detail-code">
                  {typeof event.data === 'string'
                    ? event.data
                    : JSON.stringify(event.data, null, 2)}
                </pre>
              </div>
            )}
            {event.error && (
              <div className="event-detail-item full-width">
                <span className="event-detail-label">Error</span>
                <pre className="event-detail-code error">{event.error}</pre>
              </div>
            )}
            {event.result !== undefined && event.result !== null && (
              <div className="event-detail-item full-width">
                <span className="event-detail-label">Result</span>
                <pre className="event-detail-code">
                  {typeof event.result === 'string'
                    ? event.result
                    : JSON.stringify(event.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="event-modal-footer">
          <button className="event-modal-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function LiveEventFeed({ isConnected, recentEvents, eventCounts }: LiveEventFeedProps) {
  // State
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

  // Refs
  const lastCountRef = useRef(0);
  const processedIdsRef = useRef<Set<string>>(new Set());
  const lastEventTimeRef = useRef<Record<number, number>>({});
  const maxThroughputRef = useRef(10);

  // Hooks
  const playSound = useSoundNotification();

  // Track throughput with 60-second history
  useEffect(() => {
    const total = eventCounts.pushed + eventCounts.completed + eventCounts.failed;
    const diff = total - lastCountRef.current;

    if (diff > 0) {
      setThroughput(diff);
      setThroughputHistory((prev) => [...prev.slice(1), diff]);
      maxThroughputRef.current = Math.max(maxThroughputRef.current, diff);

      // Trigger particle effect
      if (diff > 5) {
        setParticleTrigger({ active: true, type: 'pushed' });
        setTimeout(() => setParticleTrigger((p) => ({ ...p, active: false })), 100);
      }

      // Sound for burst activity
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

  // Decay max throughput over time
  useEffect(() => {
    const interval = setInterval(() => {
      maxThroughputRef.current = Math.max(10, maxThroughputRef.current * 0.95);
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

        // Track queue stats
        queueCounts[event.queue] = (queueCounts[event.queue] || 0) + 1;

        // Calculate latency for completed events
        if (event.event_type === 'completed' && lastEventTimeRef.current[event.job_id]) {
          const latency = event.timestamp - lastEventTimeRef.current[event.job_id];
          // Only track positive, reasonable latencies (< 5 minutes)
          if (latency > 0 && latency < 300000) {
            latencies.push(latency);
          }
          // Clean up after calculation
          delete lastEventTimeRef.current[event.job_id];
        }

        // Track push time for latency calculation
        if (event.event_type === 'pushed') {
          lastEventTimeRef.current[event.job_id] = event.timestamp;
        }

        // Sound notification for failures
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

      // Update latency stats
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

  // Periodic cleanup of old tracking data (every 30 seconds)
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      // Cleanup old processed IDs
      if (processedIdsRef.current.size > 500) {
        const keys = Array.from(processedIdsRef.current);
        keys.slice(0, 250).forEach((k) => processedIdsRef.current.delete(k));
      }

      // Cleanup old latency tracking (older than 60 seconds)
      const now = Date.now();
      Object.keys(lastEventTimeRef.current).forEach((key) => {
        if (now - lastEventTimeRef.current[Number(key)] > 60000) {
          delete lastEventTimeRef.current[Number(key)];
        }
      });
    }, 30000);

    return () => clearInterval(cleanupInterval);
  }, []);

  // Computed values
  const totalEvents = eventCounts.pushed + eventCounts.completed + eventCounts.failed;
  const successRate = useMemo(() => {
    const total = eventCounts.completed + eventCounts.failed;
    return total > 0 ? ((eventCounts.completed / total) * 100).toFixed(1) : '100';
  }, [eventCounts]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return eventHistory.filter((e) => {
      if (filterQueue !== 'all' && e.queue !== filterQueue) return false;
      if (filterType !== 'all' && e.event_type !== filterType) return false;
      return true;
    });
  }, [eventHistory, filterQueue, filterType]);

  // Get unique queues for filter
  const uniqueQueues = useMemo(() => {
    return Array.from(new Set(eventHistory.map((e) => e.queue)));
  }, [eventHistory]);

  // Top queues by activity
  const topQueues = useMemo(() => {
    return Object.entries(queueStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [queueStats]);

  const totalQueueEvents = Object.values(queueStats).reduce((a, b) => a + b, 0);

  return (
    <div className="live-feed-wrapper">
      {/* Main Monitor Box */}
      <div className={cn('live-feed-advanced', isConnected && throughput > 0 && 'feed-active')}>
        {/* Particle effects */}
        <ParticleEffect active={particleTrigger.active} type={particleTrigger.type} />

        {/* Header */}
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

        {/* Main content grid - 2 columns now */}
        <div className="feed-grid">
          {/* Left: Large throughput chart */}
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

          {/* Right: Stats + Queue breakdown */}
          <div className="feed-stats-section">
            {/* Stats row */}
            <div className="stats-row">
              <div className="stat-card stat-cyan">
                <Zap className="h-4 w-4" />
                <div className="stat-info">
                  <span className="stat-value">{formatNumber(eventCounts.pushed)}</span>
                  <span className="stat-label">Pushed</span>
                </div>
              </div>
              <div className="stat-card stat-emerald">
                <CheckCircle2 className="h-4 w-4" />
                <div className="stat-info">
                  <span className="stat-value">{formatNumber(eventCounts.completed)}</span>
                  <span className="stat-label">Completed</span>
                </div>
              </div>
              <div className="stat-card stat-rose">
                <XCircle className="h-4 w-4" />
                <div className="stat-info">
                  <span className="stat-value">{formatNumber(eventCounts.failed)}</span>
                  <span className="stat-label">Failed</span>
                </div>
              </div>
              <div className="stat-card stat-success">
                <BarChart3 className="h-4 w-4" />
                <div className="stat-info">
                  <span className="stat-value">{successRate}%</span>
                  <span className="stat-label">Success</span>
                </div>
              </div>
            </div>

            {/* Queue breakdown */}
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

            {/* Latency metric */}
            <LatencyMetric
              avgLatency={latencyStats.avg || 0}
              minLatency={latencyStats.min === Infinity ? 0 : latencyStats.min}
              maxLatency={latencyStats.max || 0}
            />
          </div>
        </div>
      </div>

      {/* Event Stream - Separate section below */}
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
                />
              );
            })
          )}
        </div>
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}
