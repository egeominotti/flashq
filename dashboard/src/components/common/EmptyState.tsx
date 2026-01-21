import type { ReactNode } from 'react';
import { cn } from '../../utils';
import './EmptyState.css';

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  variant?: 'default' | 'chart' | 'compact';
  className?: string;
}

export function EmptyState({
  icon,
  title = 'No data available',
  description,
  action,
  variant = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('empty-state', `empty-state-${variant}`, className)}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      {!icon && variant === 'chart' && (
        <div className="empty-state-chart-icon">
          <svg viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M10 45 Q25 30, 40 35 T70 25 T90 40"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="4 4"
              className="empty-chart-line"
            />
            <circle cx="10" cy="45" r="4" fill="currentColor" className="empty-chart-dot" />
            <circle cx="40" cy="35" r="4" fill="currentColor" className="empty-chart-dot" />
            <circle cx="70" cy="25" r="4" fill="currentColor" className="empty-chart-dot" />
            <circle cx="90" cy="40" r="4" fill="currentColor" className="empty-chart-dot" />
          </svg>
        </div>
      )}
      <div className="empty-state-content">
        <h4 className="empty-state-title">{title}</h4>
        {description && <p className="empty-state-description">{description}</p>}
      </div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

// Animated loading placeholder for charts
export function ChartLoading({ height = 280 }: { height?: number }) {
  return (
    <div className="chart-loading" style={{ height }}>
      <div className="chart-loading-bars">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="chart-loading-bar"
            style={{
              height: `${30 + Math.random() * 60}%`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
      <div className="chart-loading-line" />
    </div>
  );
}
