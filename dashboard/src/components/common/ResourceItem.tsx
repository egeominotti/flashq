import type { ReactNode } from 'react';
import { Text, ProgressBar } from '@tremor/react';

interface ResourceItemProps {
  icon: ReactNode;
  label: string;
  value: string;
  percent: number;
  percentLabel?: string;
  color?: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose' | 'amber';
  className?: string;
}

function getAutoColor(percent: number): 'cyan' | 'amber' | 'rose' {
  if (percent > 80) return 'rose';
  if (percent > 60) return 'amber';
  return 'cyan';
}

export function ResourceItem({
  icon,
  label,
  value,
  percent,
  percentLabel,
  color,
  className = '',
}: ResourceItemProps) {
  // Clamp percent between 0 and 100 to prevent display issues
  const safePercent = Math.min(100, Math.max(0, percent));
  const barColor = color || getAutoColor(safePercent);

  return (
    <div className={`resource-item ${className}`}>
      <div className="resource-item-header">
        <div className="resource-item-info">
          {icon}
          <Text>{label}</Text>
        </div>
        <Text className="resource-item-value">{value}</Text>
      </div>
      <ProgressBar value={safePercent} color={barColor} />
      {percentLabel && <Text className="resource-item-percent">{percentLabel}</Text>}
    </div>
  );
}
