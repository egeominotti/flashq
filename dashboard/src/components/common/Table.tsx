import { type ReactNode } from 'react';
import { cn } from '../../utils';
import './Table.css';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className }: TableProps) {
  return (
    <div className="table-wrapper">
      <table className={cn('table', className)}>{children}</table>
    </div>
  );
}

interface TableHeadProps {
  children: ReactNode;
}

export function TableHead({ children }: TableHeadProps) {
  return <thead>{children}</thead>;
}

interface TableBodyProps {
  children: ReactNode;
}

export function TableBody({ children }: TableBodyProps) {
  return <tbody>{children}</tbody>;
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
}

export function TableRow({ children, className }: TableRowProps) {
  return <tr className={className}>{children}</tr>;
}

interface TableHeaderProps {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableHeader({ children, className, align = 'left' }: TableHeaderProps) {
  return (
    <th className={cn(`text-${align}`, className)}>
      {children}
    </th>
  );
}

interface TableCellProps {
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
}

export function TableCell({ children, className, align = 'left', mono }: TableCellProps) {
  return (
    <td className={cn(`text-${align}`, mono && 'font-mono', className)}>
      {children}
    </td>
  );
}

interface TableEmptyProps {
  colSpan: number;
  message?: string;
}

export function TableEmpty({ colSpan, message = 'No data found' }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-empty">
        {message}
      </td>
    </tr>
  );
}
