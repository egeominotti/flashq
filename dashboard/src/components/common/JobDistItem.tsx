import { Badge, ProgressBar } from '@tremor/react';
import { formatNumber } from '../../utils';

interface JobDistItemProps {
  label: string;
  count: number;
  total: number;
  color: 'cyan' | 'blue' | 'emerald' | 'amber' | 'rose';
  className?: string;
}

export function JobDistItem({ label, count, total, color, className = '' }: JobDistItemProps) {
  // Ensure no negative values and clamp percent between 0 and 100
  const safeCount = Math.max(0, count);
  const safeTotal = Math.max(0, total);
  const percent = Math.min(100, Math.max(0, safeTotal > 0 ? (safeCount / safeTotal) * 100 : 0));

  return (
    <div className={`job-dist-item ${className}`}>
      <div className="job-dist-header">
        <Badge color={color} size="xs">
          {label}
        </Badge>
        <span className="job-dist-count">{formatNumber(safeCount)}</span>
      </div>
      <ProgressBar value={percent} color={color} />
    </div>
  );
}
