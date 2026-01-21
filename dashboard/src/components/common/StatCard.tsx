import { ReactNode } from 'react';
import { Card, Badge } from '@tremor/react';
import { AnimatedCounter, formatCompact } from './AnimatedCounter';
import { Sparkline } from './Sparkline';

interface StatCardProps {
  title: string;
  value: number;
  icon: ReactNode;
  iconColor: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose';
  formatter?: (value: number) => string;
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

export function StatCard({
  title,
  value,
  icon,
  iconColor,
  formatter = formatCompact,
  badge,
  sparkline,
  className = '',
}: StatCardProps) {
  return (
    <Card className={`stat-card ${className}`}>
      <div className="stat-card-header">
        <span className="stat-card-title">{title}</span>
        <div className={`stat-card-icon ${iconColorClasses[iconColor]}`}>
          {icon}
        </div>
      </div>
      <div className="stat-card-value">
        <AnimatedCounter value={value} formatter={formatter} />
      </div>
      <div className="stat-card-footer">
        {badge && (
          <Badge color={badge.color || iconColor} size="xs">
            {badge.icon}
            {badge.text}
          </Badge>
        )}
        {sparkline && (
          <Sparkline
            data={sparkline.data}
            width={60}
            height={24}
            color={sparkline.color}
          />
        )}
      </div>
    </Card>
  );
}
