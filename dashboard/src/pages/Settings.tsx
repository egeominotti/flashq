import { useState } from 'react';
import {
  Title,
  Text,
  Button,
  Grid,
  TabGroup,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from '@tremor/react';
import { RefreshCw, Database, Cloud, Server, Shield, AlertCircle } from 'lucide-react';
import { useSettings } from '../hooks';
import { ConfirmModal } from '../components/common/ConfirmModal';
import {
  ConnectionSettings,
  ServerInfoCard,
  QueueDefaultsCard,
  CleanupCard,
  StorageTab,
  BackupTab,
  SecurityTab,
  DangerZoneTab,
  type ConfirmModalState,
} from '../components/settings';
import './Settings.css';

export function Settings() {
  const { data: settings, refetch } = useSettings();

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: async () => {},
    variant: 'danger',
    confirmText: 'Confirm',
  });
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  const handleConfirm = async () => {
    setIsConfirmLoading(true);
    try {
      await confirmModal.onConfirm();
    } finally {
      setIsConfirmLoading(false);
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
    }
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Settings</Title>
          <Text className="page-subtitle">Configure server, persistence, and backup settings</Text>
        </div>
        <Button icon={RefreshCw} variant="secondary" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>

      <TabGroup>
        <TabList className="settings-tabs mb-6">
          <Tab icon={Server}>General</Tab>
          <Tab icon={Database}>Storage</Tab>
          <Tab icon={Cloud}>Backup</Tab>
          <Tab icon={Shield}>Security</Tab>
          <Tab icon={AlertCircle}>Advanced</Tab>
        </TabList>

        <TabPanels>
          {/* GENERAL TAB */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="gap-6">
              <ConnectionSettings onRefetch={refetch} />
              <ServerInfoCard settings={settings ?? null} setConfirmModal={setConfirmModal} />
              <QueueDefaultsCard onRefetch={refetch} />
              <CleanupCard onRefetch={refetch} />
            </Grid>
          </TabPanel>

          {/* STORAGE TAB */}
          <TabPanel>
            <StorageTab settings={settings ?? null} onRefetch={refetch} />
          </TabPanel>

          {/* BACKUP TAB */}
          <TabPanel>
            <BackupTab
              settings={settings ?? null}
              onRefetch={refetch}
              setConfirmModal={setConfirmModal}
            />
          </TabPanel>

          {/* SECURITY TAB */}
          <TabPanel>
            <SecurityTab settings={settings ?? null} onRefetch={refetch} />
          </TabPanel>

          {/* ADVANCED TAB */}
          <TabPanel>
            <DangerZoneTab onRefetch={refetch} setConfirmModal={setConfirmModal} />
          </TabPanel>
        </TabPanels>
      </TabGroup>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        isLoading={isConfirmLoading}
        confirmText={confirmModal.confirmText}
      />
    </div>
  );
}
