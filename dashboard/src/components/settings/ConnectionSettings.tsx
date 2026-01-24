import { useState, useEffect } from 'react';
import { Card, Title, Text, TextInput, Button, Flex, Badge } from '@tremor/react';
import { Link, TestTube, Save, X } from 'lucide-react';
import { getConnectionConfig, setApiUrl, setAuthToken, testConnection } from '../../api/client';
import { useToast } from '../../hooks';

interface Props {
  onRefetch: () => void;
}

export function ConnectionSettings({ onRefetch }: Props) {
  const { showToast } = useToast();
  const [serverUrl, setServerUrl] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    const config = getConnectionConfig();
    setServerUrl(config.url);
    setAuthTokenInput(config.token);
  }, []);

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    const result = await testConnection(serverUrl);
    if (result.success) {
      setConnectionStatus('success');
      showToast('Connection successful', 'success');
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error || 'Connection failed');
      showToast('Connection failed', 'error');
    }
  };

  const handleSaveConnection = () => {
    setApiUrl(serverUrl);
    setAuthToken(authTokenInput);
    showToast('Connection settings saved', 'success');
    onRefetch();
    window.location.reload();
  };

  return (
    <Card className="settings-card">
      <Flex alignItems="center" className="mb-4">
        <div className="card-icon amber">
          <Link className="h-5 w-5" />
        </div>
        <div className="ml-3">
          <Title className="text-base">Connection</Title>
          <Text className="text-xs">Server URL and authentication</Text>
        </div>
        <Badge
          className="ml-auto"
          color={
            connectionStatus === 'success'
              ? 'emerald'
              : connectionStatus === 'error'
                ? 'rose'
                : 'zinc'
          }
        >
          {connectionStatus === 'success'
            ? 'Connected'
            : connectionStatus === 'error'
              ? 'Failed'
              : 'Not Tested'}
        </Badge>
      </Flex>

      <div className="space-y-4">
        <div className="form-group">
          <label className="form-label">Server URL</label>
          <TextInput
            placeholder="http://localhost:6790"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Auth Token</label>
          <TextInput
            placeholder="Optional"
            type="password"
            value={authTokenInput}
            onChange={(e) => setAuthTokenInput(e.target.value)}
          />
        </div>

        {connectionStatus === 'error' && connectionError && (
          <div className="info-box warning">
            <X className="h-4 w-4 flex-shrink-0" />
            <Text className="text-sm">{connectionError}</Text>
          </div>
        )}

        <Flex className="gap-2">
          <Button
            size="xs"
            variant="secondary"
            icon={TestTube}
            onClick={handleTestConnection}
            loading={connectionStatus === 'testing'}
          >
            Test
          </Button>
          <Button size="xs" icon={Save} onClick={handleSaveConnection}>
            Save
          </Button>
        </Flex>
      </div>
    </Card>
  );
}
