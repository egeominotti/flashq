import type { ReactNode } from 'react';
import { cn } from '../../utils';
import './GlowCard.css';

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose' | 'amber';
  variant?: 'default' | 'glass' | 'gradient';
  hoverable?: boolean;
  onClick?: () => void;
}

export function GlowCard({
  children,
  className,
  glowColor = 'cyan',
  variant = 'default',
  hoverable = true,
  onClick,
}: GlowCardProps) {
  return (
    <div
      className={cn(
        'glow-card',
        `glow-card-${variant}`,
        `glow-${glowColor}`,
        hoverable && 'glow-card-hoverable',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="glow-card-glow" />
      <div className="glow-card-content">{children}</div>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    label?: string;
    direction: 'up' | 'down' | 'neutral';
  };
  sparkline?: number[];
  color?: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose' | 'amber';
  className?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  color = 'cyan',
  className,
}: MetricCardProps) {
  return (
    <GlowCard glowColor={color} className={cn('metric-glow-card', className)}>
      <div className="metric-glow-header">
        <span className="metric-glow-title">{title}</span>
        {icon && <div className={cn('metric-glow-icon', `icon-${color}`)}>{icon}</div>}
      </div>
      <div className="metric-glow-value">{value}</div>
      {(subtitle || trend) && (
        <div className="metric-glow-footer">
          {trend && (
            <span
              className={cn(
                'metric-glow-trend',
                trend.direction === 'up' && 'trend-up',
                trend.direction === 'down' && 'trend-down',
                trend.direction === 'neutral' && 'trend-neutral'
              )}
            >
              {trend.direction === 'up' && '↑'}
              {trend.direction === 'down' && '↓'}
              {trend.value}%{trend.label && ` ${trend.label}`}
            </span>
          )}
          {subtitle && <span className="metric-glow-subtitle">{subtitle}</span>}
        </div>
      )}
    </GlowCard>
  );
}
