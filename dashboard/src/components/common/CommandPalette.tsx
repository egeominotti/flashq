import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, Combobox, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Layers,
  FileStack,
  BarChart3,
  Clock,
  Server,
  Settings,
  Play,
  Pause,
  RefreshCw,
  Trash2,
  Download,
} from 'lucide-react';
import { useQueues } from '../../hooks';
import { api } from '../../api/client';
import type { Queue } from '../../api/types';
import './CommandPalette.css';

interface CommandItem {
  id: string;
  name: string;
  icon: typeof Search;
  category: 'navigation' | 'queue' | 'action';
  action: () => void;
  keywords?: string[];
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { data: queuesData, refetch: refetchQueues } = useQueues();

  const queues: Queue[] = useMemo(() => queuesData || [], [queuesData]);

  // Listen for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const navigationCommands: CommandItem[] = useMemo(
    () => [
      {
        id: 'nav-overview',
        name: 'Go to Overview',
        icon: LayoutDashboard,
        category: 'navigation',
        action: () => {
          navigate('/');
          handleClose();
        },
        keywords: ['home', 'dashboard'],
      },
      {
        id: 'nav-queues',
        name: 'Go to Queues',
        icon: Layers,
        category: 'navigation',
        action: () => {
          navigate('/queues');
          handleClose();
        },
      },
      {
        id: 'nav-jobs',
        name: 'Go to Jobs',
        icon: FileStack,
        category: 'navigation',
        action: () => {
          navigate('/jobs');
          handleClose();
        },
      },
      {
        id: 'nav-analytics',
        name: 'Go to Analytics',
        icon: BarChart3,
        category: 'navigation',
        action: () => {
          navigate('/analytics');
          handleClose();
        },
        keywords: ['metrics', 'stats'],
      },
      {
        id: 'nav-crons',
        name: 'Go to Cron Jobs',
        icon: Clock,
        category: 'navigation',
        action: () => {
          navigate('/crons');
          handleClose();
        },
        keywords: ['scheduled', 'recurring'],
      },
      {
        id: 'nav-workers',
        name: 'Go to Workers',
        icon: Server,
        category: 'navigation',
        action: () => {
          navigate('/workers');
          handleClose();
        },
      },
      {
        id: 'nav-settings',
        name: 'Go to Settings',
        icon: Settings,
        category: 'navigation',
        action: () => {
          navigate('/settings');
          handleClose();
        },
        keywords: ['config', 'configuration'],
      },
    ],
    [navigate, handleClose]
  );

  const queueCommands: CommandItem[] = useMemo(
    () =>
      queues.flatMap((queue) => [
        {
          id: `pause-${queue.name}`,
          name: `Pause queue: ${queue.name}`,
          icon: Pause,
          category: 'queue' as const,
          action: async () => {
            await api.pauseQueue(queue.name);
            refetchQueues();
            handleClose();
          },
        },
        {
          id: `resume-${queue.name}`,
          name: `Resume queue: ${queue.name}`,
          icon: Play,
          category: 'queue' as const,
          action: async () => {
            await api.resumeQueue(queue.name);
            refetchQueues();
            handleClose();
          },
        },
      ]),
    [queues, refetchQueues, handleClose]
  );

  const actionCommands: CommandItem[] = useMemo(
    () => [
      {
        id: 'refresh-all',
        name: 'Refresh all data',
        icon: RefreshCw,
        category: 'action',
        action: () => {
          window.location.reload();
        },
      },
      {
        id: 'export-csv',
        name: 'Export queues to CSV',
        icon: Download,
        category: 'action',
        action: () => {
          const csv = [
            'Queue,Pending,Processing,Completed,Failed,Paused',
            ...queues.map(
              (q) => `${q.name},${q.pending},${q.processing},${q.completed},${q.dlq},${q.paused}`
            ),
          ].join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `flashq-queues-${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          handleClose();
        },
        keywords: ['download'],
      },
      {
        id: 'clear-completed',
        name: 'Clean completed jobs (all queues)',
        icon: Trash2,
        category: 'action',
        action: async () => {
          for (const queue of queues) {
            await api.cleanQueue(queue.name, { grace: 0, state: 'completed', limit: 1000 });
          }
          handleClose();
        },
      },
    ],
    [queues, handleClose]
  );

  const allCommands = useMemo(
    () => [...navigationCommands, ...queueCommands, ...actionCommands],
    [navigationCommands, queueCommands, actionCommands]
  );

  const filteredCommands = useMemo(() => {
    if (!query) return allCommands;
    const lowerQuery = query.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lowerQuery) ||
        cmd.keywords?.some((kw) => kw.includes(lowerQuery))
    );
  }, [query, allCommands]);

  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {
      navigation: [],
      queue: [],
      action: [],
    };
    for (const cmd of filteredCommands) {
      groups[cmd.category].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="command-palette-container" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="command-palette-backdrop" />
        </Transition.Child>

        <div className="command-palette-wrapper">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="command-palette-panel">
              <Combobox
                onChange={(item: CommandItem | null) => {
                  if (item) item.action();
                }}
              >
                <div className="command-palette-input-wrapper">
                  <Search className="command-palette-search-icon" size={20} />
                  <Combobox.Input
                    className="command-palette-input"
                    placeholder="Type a command or search..."
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                  <kbd className="command-palette-kbd">ESC</kbd>
                </div>

                <Combobox.Options className="command-palette-options" static>
                  {filteredCommands.length === 0 ? (
                    <div className="command-palette-empty">No results found</div>
                  ) : (
                    <>
                      {groupedCommands.navigation.length > 0 && (
                        <div className="command-palette-group">
                          <div className="command-palette-group-label">Navigation</div>
                          {groupedCommands.navigation.map((cmd) => (
                            <Combobox.Option key={cmd.id} value={cmd} as={Fragment}>
                              {({ active }) => (
                                <li className={`command-palette-option ${active ? 'active' : ''}`}>
                                  <cmd.icon size={16} />
                                  <span>{cmd.name}</span>
                                </li>
                              )}
                            </Combobox.Option>
                          ))}
                        </div>
                      )}

                      {groupedCommands.queue.length > 0 && (
                        <div className="command-palette-group">
                          <div className="command-palette-group-label">Queue Actions</div>
                          {groupedCommands.queue.map((cmd) => (
                            <Combobox.Option key={cmd.id} value={cmd} as={Fragment}>
                              {({ active }) => (
                                <li className={`command-palette-option ${active ? 'active' : ''}`}>
                                  <cmd.icon size={16} />
                                  <span>{cmd.name}</span>
                                </li>
                              )}
                            </Combobox.Option>
                          ))}
                        </div>
                      )}

                      {groupedCommands.action.length > 0 && (
                        <div className="command-palette-group">
                          <div className="command-palette-group-label">Actions</div>
                          {groupedCommands.action.map((cmd) => (
                            <Combobox.Option key={cmd.id} value={cmd} as={Fragment}>
                              {({ active }) => (
                                <li className={`command-palette-option ${active ? 'active' : ''}`}>
                                  <cmd.icon size={16} />
                                  <span>{cmd.name}</span>
                                </li>
                              )}
                            </Combobox.Option>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Combobox.Options>

                <div className="command-palette-footer">
                  <span>
                    <kbd>↑↓</kbd> Navigate
                  </span>
                  <span>
                    <kbd>↵</kbd> Select
                  </span>
                  <span>
                    <kbd>ESC</kbd> Close
                  </span>
                </div>
              </Combobox>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
