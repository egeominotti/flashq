import { useMemo } from 'react';
import { Badge } from '@tremor/react';
import {
  X,
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  Calendar,
  RotateCcw,
  Timer,
  Zap,
  ArrowRight,
} from 'lucide-react';
import { cn } from '../../utils';
import type { Job } from '../../api/types';
import './JobTimeline.css';

interface JobTimelineProps {
  job: Job;
  onClose: () => void;
}

interface TimelineStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  timestamp?: string;
  duration?: string;
  status: 'completed' | 'active' | 'pending' | 'failed';
  color: string;
  details?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return '-';
  const date = new Date(ts);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function JobTimeline({ job, onClose }: JobTimelineProps) {
  const timeline = useMemo(() => {
    const steps: TimelineStep[] = [];
    const now = Date.now();
    const createdAt = job.created_at ? new Date(job.created_at).getTime() : now;
    const runAt = job.run_at ? new Date(job.run_at).getTime() : null;

    // Step 1: Created/Pushed
    steps.push({
      id: 'created',
      label: 'Created',
      icon: <Zap className="h-4 w-4" />,
      timestamp: job.created_at,
      status: 'completed',
      color: 'cyan',
      details: `Job pushed to queue "${job.queue}"`,
    });

    // Step 2: Delayed (if applicable)
    if (runAt && runAt > createdAt) {
      const isStillDelayed = job.state === 'delayed';
      const waitTime = isStillDelayed ? now - createdAt : runAt - createdAt;

      steps.push({
        id: 'delayed',
        label: 'Delayed',
        icon: <Calendar className="h-4 w-4" />,
        timestamp: job.run_at,
        duration: formatDuration(waitTime),
        status: isStillDelayed ? 'active' : 'completed',
        color: 'amber',
        details: isStillDelayed
          ? `Scheduled to run at ${formatTimestamp(job.run_at)}`
          : `Waited ${formatDuration(waitTime)} before becoming ready`,
      });
    }

    // Step 3: Waiting
    const isWaiting = job.state === 'waiting';
    const wasEverWaiting = !runAt || runAt <= createdAt || job.state !== 'delayed';

    if (wasEverWaiting) {
      steps.push({
        id: 'waiting',
        label: 'Waiting',
        icon: <Clock className="h-4 w-4" />,
        status: isWaiting ? 'active' : job.state === 'delayed' ? 'pending' : 'completed',
        color: 'cyan',
        details: isWaiting ? 'Waiting to be picked up by a worker' : 'Queued for processing',
      });
    }

    // Step 4: Active/Processing
    const isActive = job.state === 'active';
    const wasProcessed = ['completed', 'failed'].includes(job.state || '');

    if (isActive || wasProcessed) {
      steps.push({
        id: 'active',
        label: 'Processing',
        icon: <Play className="h-4 w-4" />,
        status: isActive ? 'active' : 'completed',
        color: 'blue',
        details: isActive
          ? `Currently being processed (attempt ${job.attempts}/${job.max_attempts})`
          : `Processed in attempt ${job.attempts}/${job.max_attempts}`,
      });
    }

    // Step 5: Completed or Failed
    if (job.state === 'completed') {
      steps.push({
        id: 'completed',
        label: 'Completed',
        icon: <CheckCircle2 className="h-4 w-4" />,
        status: 'completed',
        color: 'emerald',
        details: 'Job completed successfully',
      });
    } else if (job.state === 'failed') {
      steps.push({
        id: 'failed',
        label: 'Failed',
        icon: <XCircle className="h-4 w-4" />,
        status: 'failed',
        color: 'rose',
        details: job.error || `Failed after ${job.attempts} attempts`,
      });
    }

    return steps;
  }, [job]);

  // Calculate total time
  const totalTime = useMemo(() => {
    if (!job.created_at) return null;
    const createdAt = new Date(job.created_at).getTime();
    const now = Date.now();

    if (job.state === 'completed' || job.state === 'failed') {
      // Estimate based on last known time
      return formatDuration(now - createdAt);
    }
    return formatDuration(now - createdAt);
  }, [job]);

  // State color mapping
  const stateColors: Record<string, string> = {
    waiting: 'cyan',
    delayed: 'amber',
    active: 'blue',
    completed: 'emerald',
    failed: 'rose',
  };

  return (
    <div className="job-timeline-overlay" onClick={onClose}>
      <div className="job-timeline-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="job-timeline-header">
          <div className="job-timeline-title">
            <h2>Job Journey</h2>
            <span className="job-timeline-id">#{job.id}</span>
          </div>
          <button onClick={onClose} className="job-timeline-close">
            <X size={20} />
          </button>
        </div>

        {/* Summary Stats */}
        <div className="job-timeline-summary">
          <div className="summary-stat">
            <span className="summary-label">Queue</span>
            <Badge color="cyan" size="sm">
              {job.queue}
            </Badge>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Status</span>
            <Badge color={stateColors[job.state || 'waiting'] as 'cyan'} size="sm">
              {job.state || 'unknown'}
            </Badge>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Priority</span>
            <span className="summary-value">{job.priority}</span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Attempts</span>
            <span className="summary-value">
              {job.attempts}/{job.max_attempts}
            </span>
          </div>
          {totalTime && (
            <div className="summary-stat">
              <span className="summary-label">Total Time</span>
              <span className="summary-value highlight">{totalTime}</span>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="job-timeline-content">
          <div className="timeline-track">
            {timeline.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  'timeline-step',
                  `timeline-step-${step.status}`,
                  `timeline-color-${step.color}`
                )}
              >
                <div className="timeline-connector">
                  {index > 0 && <div className="connector-line connector-line-top" />}
                  <div className={cn('timeline-node', step.status === 'active' && 'node-pulse')}>
                    {step.icon}
                  </div>
                  {index < timeline.length - 1 && (
                    <div className="connector-line connector-line-bottom" />
                  )}
                </div>
                <div className="timeline-content">
                  <div className="timeline-step-header">
                    <span className="timeline-step-label">{step.label}</span>
                    {step.duration && (
                      <Badge size="xs" color="zinc">
                        <Timer className="mr-1 h-3 w-3" />
                        {step.duration}
                      </Badge>
                    )}
                  </div>
                  {step.timestamp && (
                    <span className="timeline-timestamp">{formatTimestamp(step.timestamp)}</span>
                  )}
                  {step.details && <p className="timeline-details">{step.details}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Retry History (if applicable) */}
        {job.attempts > 1 && (
          <div className="job-timeline-retries">
            <div className="retries-header">
              <RotateCcw className="h-4 w-4" />
              <span>Retry History</span>
            </div>
            <div className="retries-list">
              {Array.from({ length: job.attempts - 1 }, (_, i) => (
                <div key={i} className="retry-item">
                  <span className="retry-attempt">Attempt {i + 1}</span>
                  <ArrowRight className="h-3 w-3" />
                  <Badge size="xs" color="rose">
                    Failed
                  </Badge>
                </div>
              ))}
              <div className="retry-item">
                <span className="retry-attempt">Attempt {job.attempts}</span>
                <ArrowRight className="h-3 w-3" />
                <Badge
                  size="xs"
                  color={
                    job.state === 'completed' ? 'emerald' : job.state === 'failed' ? 'rose' : 'blue'
                  }
                >
                  {job.state === 'completed'
                    ? 'Success'
                    : job.state === 'failed'
                      ? 'Failed'
                      : 'In Progress'}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* Job Data Preview */}
        <div className="job-timeline-data">
          <div className="data-section">
            <span className="data-label">Job Data</span>
            <pre className="data-preview">{JSON.stringify(job.data, null, 2)}</pre>
          </div>
          {job.result !== undefined && job.result !== null && (
            <div className="data-section">
              <span className="data-label">Result</span>
              <pre className="data-preview result">{JSON.stringify(job.result, null, 2)}</pre>
            </div>
          )}
          {job.error && (
            <div className="data-section">
              <span className="data-label">Error</span>
              <pre className="data-preview error">{job.error}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
