import { memo } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../../../utils';

interface LatencyMetricProps {
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export const LatencyMetric = memo(function LatencyMetric({
  avgLatency,
  minLatency,
  maxLatency,
}: LatencyMetricProps) {
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
});
