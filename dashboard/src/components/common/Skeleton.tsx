import { cn } from '../../utils';
import './Skeleton.css';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({ className, variant = 'text', width, height, lines = 1 }: SkeletonProps) {
  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  if (lines > 1) {
    return (
      <div className="skeleton-lines">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn('skeleton', `skeleton-${variant}`, className)}
            style={{ ...style, width: i === lines - 1 ? '60%' : style.width }}
          />
        ))}
      </div>
    );
  }

  return <div className={cn('skeleton', `skeleton-${variant}`, className)} style={style} />;
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
}

export function SkeletonTable({ rows = 5, columns = 6 }: SkeletonTableProps) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-header">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={16} width={80 + Math.random() * 40} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="skeleton-table-row">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} height={14} width={60 + Math.random() * 60} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface SkeletonCardProps {
  showHeader?: boolean;
  showChart?: boolean;
}

export function SkeletonCard({ showHeader = true, showChart = false }: SkeletonCardProps) {
  return (
    <div className="skeleton-card">
      {showHeader && (
        <div className="skeleton-card-header">
          <Skeleton width={120} height={20} />
          <Skeleton width={60} height={32} variant="rectangular" />
        </div>
      )}
      {showChart ? (
        <Skeleton height={200} variant="rectangular" className="skeleton-chart" />
      ) : (
        <Skeleton lines={3} />
      )}
    </div>
  );
}

export function SkeletonMetricCard() {
  return (
    <div className="skeleton-metric-card">
      <div className="skeleton-metric-header">
        <div>
          <Skeleton width={80} height={14} />
          <Skeleton width={60} height={32} className="mt-2" />
        </div>
        <Skeleton width={40} height={40} variant="circular" />
      </div>
      <Skeleton width={60} height={20} variant="rectangular" className="mt-4" />
    </div>
  );
}
