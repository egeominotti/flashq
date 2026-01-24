import { useState } from 'react';
import { Card, Title, Text, TextInput, Button, Flex, Badge, Divider } from '@tremor/react';
import { Shield, Save } from 'lucide-react';
import { api } from '../../api/client';
import { useToast } from '../../hooks';

interface Settings {
  auth_enabled?: boolean;
  auth_token_count?: number;
}

interface Props {
  settings: Settings | null;
  onRefetch: () => void;
}

export function SecurityTab({ settings, onRefetch }: Props) {
  const { showToast } = useToast();
  const [authTokens, setAuthTokens] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await api.saveAuthSettings(authTokens);
    setSaving(false);
    showToast('Auth settings saved', 'success');
    onRefetch();
  };

  return (
    <Card className="settings-card">
      <Flex alignItems="center" className="mb-6">
        <div className="card-icon violet">
          <Shield className="h-5 w-5" />
        </div>
        <div className="ml-3">
          <Title className="text-base">Authentication</Title>
          <Text className="text-xs">Configure access control settings</Text>
        </div>
      </Flex>

      <div className="form-group mb-4">
        <label className="form-label">Auth Tokens (comma-separated)</label>
        <TextInput
          placeholder="token1, token2, token3"
          value={authTokens}
          onChange={(e) => setAuthTokens(e.target.value)}
        />
        <Text className="mt-1 text-xs text-zinc-500">Leave empty to disable authentication.</Text>
      </div>

      <Button size="xs" icon={Save} onClick={handleSave} loading={saving}>
        Save Auth
      </Button>

      <Divider className="my-4" />

      <Text className="mb-3 text-sm font-medium text-zinc-300">Security Status</Text>
      <div className="settings-grid compact">
        <div className="setting-item">
          <span className="setting-label">Token Auth</span>
          <Badge color={settings?.auth_enabled ? 'emerald' : 'zinc'}>
            {settings?.auth_enabled ? `Enabled (${settings.auth_token_count})` : 'Disabled'}
          </Badge>
        </div>
        <div className="setting-item">
          <span className="setting-label">Webhook Signatures</span>
          <Badge color="emerald">HMAC-SHA256</Badge>
        </div>
        <div className="setting-item">
          <span className="setting-label">Max Payload</span>
          <span className="setting-value mono">10 MB</span>
        </div>
        <div className="setting-item">
          <span className="setting-label">Rate Limiting</span>
          <Badge color="emerald">Per-Queue</Badge>
        </div>
      </div>
    </Card>
  );
}
