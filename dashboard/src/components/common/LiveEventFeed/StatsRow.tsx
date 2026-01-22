import { memo } from 'react';
import { Zap, CheckCircle2, XCircle, BarChart3 } from 'lucide-react';
import { formatNumber } from '../../../utils';

interface StatsRowProps {
  pushed: number;
  completed: number;
  failed: number;
  successRate: string;
}

export const StatsRow = memo(function StatsRow({
  pushed,
  completed,
  failed,
  successRate,
}: StatsRowProps) {
  return (
    <div className="stats-row">
      <div className="stat-card stat-cyan">
        <Zap className="h-4 w-4" />
        <div className="stat-info">
          <span className="stat-value">{formatNumber(pushed)}</span>
          <span className="stat-label">Pushed</span>
        </div>
      </div>
      <div className="stat-card stat-emerald">
        <CheckCircle2 className="h-4 w-4" />
        <div className="stat-info">
          <span className="stat-value">{formatNumber(completed)}</span>
          <span className="stat-label">Completed</span>
        </div>
      </div>
      <div className="stat-card stat-rose">
        <XCircle className="h-4 w-4" />
        <div className="stat-info">
          <span className="stat-value">{formatNumber(failed)}</span>
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
  );
});
