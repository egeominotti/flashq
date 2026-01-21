import type { ReactNode } from 'react';
import { Badge } from '@tremor/react';
import { GlowCard } from './GlowCard';
import { AnimatedCounter, formatCompact } from './AnimatedCounter';
import { Sparkline } from './Sparkline';

interface MetricGlowCardProps {
  title: string;
  value: number;
  icon: ReactNode;
  glowColor: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose';
  formatter?: (value: number) => string;
  decimals?: number;
  suffix?: string;
  badge?: {
    text: string;
    color?: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose' | 'amber' | 'zinc';
    icon?: ReactNode;
  };
  sparkline?: {
    data: number[];
    color: string;
  };
  className?: string;
}

const iconColorClasses: Record<string, string> = {
  cyan: 'icon-cyan',
  blue: 'icon-blue',
  emerald: 'icon-emerald',
  violet: 'icon-violet',
  rose: 'icon-rose',
};

export function MetricGlowCard({
  title,
  value,
  icon,
  glowColor,
  formatter = formatCompact,
  decimals,
  suffix,
  badge,
  sparkline,
  className = '',
}: MetricGlowCardProps) {
  return (
    <GlowCard glowColor={glowColor} className={`metric-glow-card ${className}`}>
      <div className="metric-glow-header">
        <span className="metric-glow-title">{title}</span>
        <div className={`metric-glow-icon ${iconColorClasses[glowColor]}`}>{icon}</div>
      </div>
      <div className="metric-glow-value">
        <AnimatedCounter
          value={value}
          formatter={decimals === undefined && !suffix ? formatter : undefined}
          decimals={decimals}
          suffix={suffix}
        />
      </div>
      <div className="metric-glow-footer">
        {badge && (
          <Badge color={badge.color || glowColor} size="xs">
            {badge.icon}
            {badge.text}
          </Badge>
        )}
        {sparkline && (
          <Sparkline data={sparkline.data} width={60} height={24} color={sparkline.color} />
        )}
      </div>
    </GlowCard>
  );
}
