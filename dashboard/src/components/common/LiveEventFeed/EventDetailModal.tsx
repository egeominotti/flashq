import { useState } from 'react';
import { Badge } from '@tremor/react';
import { X, Copy, Check } from 'lucide-react';
import { cn } from '../../../utils';
import { eventConfig } from './types';
import type { JobEvent } from './types';

interface EventDetailModalProps {
  event: JobEvent;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const config = eventConfig[event.event_type] || eventConfig.pushed;
  const Icon = config.icon;
  const [copied, setCopied] = useState(false);

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
