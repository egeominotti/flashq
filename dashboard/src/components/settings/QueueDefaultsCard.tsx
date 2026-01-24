import { useState } from 'react';
import { Card, Title, Text, NumberInput, Button, Flex, Grid } from '@tremor/react';
import { Zap, Save } from 'lucide-react';
import { api } from '../../api/client';
import { useToast } from '../../hooks';

interface Props {
  onRefetch: () => void;
}

export function QueueDefaultsCard({ onRefetch }: Props) {
  const { showToast } = useToast();
  const [queueTimeout, setQueueTimeout] = useState<number>(30000);
  const [queueMaxAttempts, setQueueMaxAttempts] = useState<number>(3);
  const [queueBackoff, setQueueBackoff] = useState<number>(1000);
  const [queueTtl, setQueueTtl] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await api.saveQueueDefaults({
      default_timeout: queueTimeout,
      default_max_attempts: queueMaxAttempts,
      default_backoff: queueBackoff,
      default_ttl: queueTtl || undefined,
    });
    setSaving(false);
    showToast('Queue defaults saved', 'success');
    onRefetch();
  };

  return (
    <Card className="settings-card">
      <Flex alignItems="center" className="mb-4">
        <div className="card-icon blue">
          <Zap className="h-5 w-5" />
        </div>
        <div className="ml-3">
          <Title className="text-base">Queue Defaults</Title>
          <Text className="text-xs">Default settings for new jobs</Text>
        </div>
      </Flex>

      <Grid numItemsSm={2} className="mb-4 gap-3">
        <div className="form-group">
          <label className="form-label">Timeout (ms)</label>
          <NumberInput value={queueTimeout} onValueChange={setQueueTimeout} min={1000} step={1000} />
        </div>
        <div className="form-group">
          <label className="form-label">Max Attempts</label>
          <NumberInput
            value={queueMaxAttempts}
            onValueChange={setQueueMaxAttempts}
            min={1}
            max={100}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Backoff (ms)</label>
          <NumberInput value={queueBackoff} onValueChange={setQueueBackoff} min={100} step={100} />
        </div>
        <div className="form-group">
          <label className="form-label">TTL (ms)</label>
          <NumberInput value={queueTtl} onValueChange={setQueueTtl} min={0} step={1000} />
        </div>
      </Grid>

      <Button size="xs" icon={Save} onClick={handleSave} loading={saving}>
        Save Defaults
      </Button>
    </Card>
  );
}
