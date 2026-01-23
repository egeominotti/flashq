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
  /** Use compact notation (K/M) even when decimals/suffix are specified */
  compact?: boolean;
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

/**
 * Creates a compact formatter that appends a suffix
 * Example: formatCompactWithSuffix('/s')(74617) => "74.6K/s"
 */
function formatCompactWithSuffix(suffix: string, decimals = 1): (value: number) => string {
  return (value: number) => {
    const safeValue = Math.max(0, value);
    if (safeValue >= 1_000_000_000) {
      return `${(safeValue / 1_000_000_000).toFixed(decimals)}B${suffix}`;
    }
    if (safeValue >= 1_000_000) {
      return `${(safeValue / 1_000_000).toFixed(decimals)}M${suffix}`;
    }
    if (safeValue >= 1_000) {
      return `${(safeValue / 1_000).toFixed(decimals)}K${suffix}`;
    }
    return `${safeValue.toFixed(decimals)}${suffix}`;
  };
}

export function MetricGlowCard({
  title,
  value,
  icon,
  glowColor,
  formatter = formatCompact,
  decimals,
  suffix,
  compact = false,
  badge,
  sparkline,
  className = '',
}: MetricGlowCardProps) {
  // Determine which formatter to use
  let effectiveFormatter: ((value: number) => string) | undefined;
  let effectiveSuffix: string | undefined;
  let effectiveDecimals: number | undefined;

  if (compact && suffix) {
    // Use compact notation with suffix (e.g., "74.6K/s")
    effectiveFormatter = formatCompactWithSuffix(suffix, decimals ?? 1);
    effectiveSuffix = undefined;
    effectiveDecimals = undefined;
  } else if (decimals === undefined && !suffix) {
    // Default: use compact formatter
    effectiveFormatter = formatter;
  } else {
    // Use decimals/suffix without compact notation
    effectiveSuffix = suffix;
    effectiveDecimals = decimals;
  }

  return (
    <GlowCard glowColor={glowColor} className={`metric-glow-card ${className}`}>
      <div className="metric-glow-header">
        <span className="metric-glow-title">{title}</span>
        <div className={`metric-glow-icon ${iconColorClasses[glowColor]}`}>{icon}</div>
      </div>
      <div className="metric-glow-value">
        <AnimatedCounter
          value={value}
          formatter={effectiveFormatter}
          decimals={effectiveDecimals}
          suffix={effectiveSuffix}
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
