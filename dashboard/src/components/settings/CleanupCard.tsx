import { useState } from 'react';
import { Card, Title, Text, NumberInput, Button, Flex, Grid } from '@tremor/react';
import { Clock, Save, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useToast } from '../../hooks';

interface Props {
  onRefetch: () => void;
}

export function CleanupCard({ onRefetch }: Props) {
  const { showToast } = useToast();
  const [maxCompletedJobs, setMaxCompletedJobs] = useState<number>(50000);
  const [maxJobResults, setMaxJobResults] = useState<number>(5000);
  const [cleanupInterval, setCleanupInterval] = useState<number>(60);
  const [metricsHistorySize, setMetricsHistorySize] = useState<number>(1000);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await api.saveCleanupSettings({
      max_completed_jobs: maxCompletedJobs,
      max_job_results: maxJobResults,
      cleanup_interval_secs: cleanupInterval,
      metrics_history_size: metricsHistorySize,
    });
    setSaving(false);
    showToast('Cleanup settings saved', 'success');
    onRefetch();
  };

  const handleRunNow = async () => {
    await api.runCleanup();
    showToast('Cleanup executed', 'success');
  };

  return (
    <Card className="settings-card">
      <Flex alignItems="center" className="mb-4">
        <div className="card-icon violet">
          <Clock className="h-5 w-5" />
        </div>
        <div className="ml-3">
          <Title className="text-base">Cleanup & Retention</Title>
          <Text className="text-xs">Automatic cleanup settings</Text>
        </div>
      </Flex>

      <Grid numItemsSm={2} className="mb-4 gap-3">
        <div className="form-group">
          <label className="form-label">Max Completed</label>
          <NumberInput
            value={maxCompletedJobs}
            onValueChange={setMaxCompletedJobs}
            min={1000}
            step={1000}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Max Results</label>
          <NumberInput
            value={maxJobResults}
            onValueChange={setMaxJobResults}
            min={100}
            step={100}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Interval (sec)</label>
          <NumberInput
            value={cleanupInterval}
            onValueChange={setCleanupInterval}
            min={10}
            step={10}
          />
        </div>
        <div className="form-group">
          <label className="form-label">History Size</label>
          <NumberInput
            value={metricsHistorySize}
            onValueChange={setMetricsHistorySize}
            min={100}
            step={100}
          />
        </div>
      </Grid>

      <Flex className="gap-2">
        <Button size="xs" icon={Save} onClick={handleSave} loading={saving}>
          Save
        </Button>
        <Button size="xs" variant="secondary" icon={Trash2} onClick={handleRunNow}>
          Run Now
        </Button>
      </Flex>
    </Card>
  );
}
