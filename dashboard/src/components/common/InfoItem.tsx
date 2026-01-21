import { ReactNode } from 'react';

interface InfoItemProps {
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

export function InfoItem({ icon, iconColor, label, value, className = '' }: InfoItemProps) {
  return (
    <div className={`info-item ${className}`}>
      <div className={`info-item-icon ${iconColorClasses[iconColor]}`}>
        {icon}
      </div>
      <div className="info-item-content">
        <span className="info-item-label">{label}</span>
        <span className="info-item-value">{value}</span>
      </div>
    </div>
  );
}
