import { type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="app-layout dark">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
