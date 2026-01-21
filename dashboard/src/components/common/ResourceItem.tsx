import { ReactNode } from 'react';
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
  const barColor = color || getAutoColor(percent);

  return (
    <div className={`resource-item ${className}`}>
      <div className="resource-item-header">
        <div className="resource-item-info">
          {icon}
          <Text>{label}</Text>
        </div>
        <Text className="resource-item-value">{value}</Text>
      </div>
      <ProgressBar value={percent} color={barColor} />
      {percentLabel && (
        <Text className="resource-item-percent">{percentLabel}</Text>
      )}
    </div>
  );
}
