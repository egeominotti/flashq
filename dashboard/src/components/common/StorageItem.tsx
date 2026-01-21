import type { ReactNode } from 'react';

interface StorageItemProps {
  icon: ReactNode;
  iconColor: 'cyan' | 'blue' | 'emerald' | 'violet' | 'rose';
  label: string;
  value: string | number;
  className?: string;
}

const iconColorClasses: Record<string, string> = {
  cyan: 'icon-cyan',
  blue: 'icon-blue',
  emerald: 'icon-emerald',
  violet: 'icon-violet',
  rose: 'icon-rose',
};

export function StorageItem({ icon, iconColor, label, value, className = '' }: StorageItemProps) {
  return (
    <div className={`storage-item ${className}`}>
      <div className={`storage-item-icon ${iconColorClasses[iconColor]}`}>{icon}</div>
      <div className="storage-item-info">
        <span className="storage-item-label">{label}</span>
        <span className="storage-item-value">{value}</span>
      </div>
    </div>
  );
}
