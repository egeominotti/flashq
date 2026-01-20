import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../common';
import './Header.css';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries();
  };

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="page-title">{title}</h1>
        {subtitle && <span className="page-subtitle">{subtitle}</span>}
      </div>
      <div className="header-right">
        <Button variant="ghost" onClick={handleRefresh} icon={<RefreshCw size={16} />}>
          Refresh
        </Button>
      </div>
    </header>
  );
}
