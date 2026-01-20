import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Layers,
  FileStack,
  BarChart3,
  Clock,
  Server,
  Settings,
  Zap,
  Database,
} from 'lucide-react';
import { Badge } from '@tremor/react';
import { useSettings, useStats } from '../../hooks';
import { formatUptime } from '../../utils';
import './Sidebar.css';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string | number;
}

interface NavGroup {
  section: string;
  items: NavItem[];
}

export function Sidebar() {
  const location = useLocation();
  const { data: settings } = useSettings();
  const { data: stats } = useStats();

  const totalJobs = stats?.total_jobs ?? 0;
  const activeWorkers = stats?.active_connections ?? 0;

  const navGroups: NavGroup[] = [
    {
      section: 'MONITORING',
      items: [
        { to: '/', icon: LayoutDashboard, label: 'Overview' },
        { to: '/queues', icon: Layers, label: 'Queues', badge: stats?.queues?.length },
        { to: '/jobs', icon: FileStack, label: 'Jobs', badge: totalJobs > 0 ? totalJobs : undefined },
        { to: '/analytics', icon: BarChart3, label: 'Analytics' },
      ],
    },
    {
      section: 'AUTOMATION',
      items: [
        { to: '/crons', icon: Clock, label: 'Cron Jobs' },
        { to: '/workers', icon: Server, label: 'Workers', badge: activeWorkers > 0 ? activeWorkers : undefined },
      ],
    },
    {
      section: 'SYSTEM',
      items: [
        { to: '/settings', icon: Settings, label: 'Settings' },
      ],
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-container">
          <div className="logo-icon">
            <Zap className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="logo-text">
            <span className="logo-name">flashQ</span>
            <span className="logo-version">v{settings?.version || '0.2.0'}</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navGroups.map((group) => (
          <div key={group.section} className="nav-group">
            <span className="nav-section-label">{group.section}</span>
            <ul className="nav-list">
              {group.items.map((item) => {
                const isActive = location.pathname === item.to;
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={`nav-link ${isActive ? 'active' : ''}`}
                    >
                      <Icon className="nav-icon" />
                      <span className="nav-label">{item.label}</span>
                      {item.badge !== undefined && (
                        <Badge size="xs" color="cyan">
                          {item.badge}
                        </Badge>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="server-status">
          <div className="status-header">
            <Database className="w-4 h-4 text-zinc-500" />
            <span className="status-title">Server Status</span>
          </div>
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Status</span>
              <div className="status-value-container">
                <span className="status-dot online" />
                <span className="status-value text-emerald-400">Connected</span>
              </div>
            </div>
            <div className="status-item">
              <span className="status-label">Uptime</span>
              <span className="status-value mono">
                {formatUptime(settings?.uptime_seconds || 0)}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Port</span>
              <span className="status-value mono">{settings?.tcp_port || 6789}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Mode</span>
              <span className="status-value">
                {settings?.sqlite?.enabled ? 'Persistent' : 'Memory'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
