export interface S3Backup {
  key: string;
  size: number;
  last_modified?: string;
}

export interface SqliteStats {
  enabled: boolean;
  path?: string;
  file_size_bytes: number;
  file_size_mb: number;
  total_jobs: number;
  queued_jobs: number;
  processing_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  delayed_jobs: number;
  async_writer_enabled: boolean;
  async_writer_queue_len: number;
  async_writer_ops_queued: number;
  async_writer_ops_written: number;
  async_writer_batches_written: number;
  async_writer_batch_interval_ms: number;
  async_writer_max_batch_size: number;
}

export interface ConfirmModalState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
  variant: 'danger' | 'warning' | 'info';
  confirmText: string;
}
