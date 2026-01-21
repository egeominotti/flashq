import { type ReactNode } from 'react';
import { cn } from '../../utils';
import './Badge.css';

type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'completed'
  | 'failed'
  | 'paused';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

export function Badge({ variant = 'default', children, className }: BadgeProps) {
  return <span className={cn('badge', `badge-${variant}`, className)}>{children}</span>;
}
