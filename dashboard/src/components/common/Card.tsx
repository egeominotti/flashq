import { type ReactNode } from 'react';
import { cn } from '../../utils';
import './Card.css';

interface CardProps {
  children: ReactNode;
  className?: string;
  danger?: boolean;
}

export function Card({ children, className, danger }: CardProps) {
  return <div className={cn('card', danger && 'card-danger', className)}>{children}</div>;
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className }: CardHeaderProps) {
  return <div className={cn('card-header', className)}>{children}</div>;
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className }: CardTitleProps) {
  return <h3 className={cn('card-title', className)}>{children}</h3>;
}

interface CardSubtitleProps {
  children: ReactNode;
  className?: string;
}

export function CardSubtitle({ children, className }: CardSubtitleProps) {
  return <span className={cn('card-subtitle', className)}>{children}</span>;
}

interface CardBodyProps {
  children: ReactNode;
  className?: string;
}

export function CardBody({ children, className }: CardBodyProps) {
  return <div className={cn('card-body', className)}>{children}</div>;
}
