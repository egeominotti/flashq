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
  const percent = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className={`job-dist-item ${className}`}>
      <div className="job-dist-header">
        <Badge color={color} size="xs">{label}</Badge>
        <span className="job-dist-count">{formatNumber(count)}</span>
      </div>
      <ProgressBar value={percent} color={color} />
    </div>
  );
}
