export interface ConnectionCheck {
  checked_at: string;
  succeeded: boolean;
  provider: string;
  model: string;
  configuration_match: 'current' | 'previous' | 'draft';
}

export interface AssistantQueueEvidence {
  scope: 'visible_tasks';
  snapshot: 'sequential_reads';
  observed_at: string;
  worker_connection: 'not_checked';
  counts: { queued: number; running: number; failed: number };
  lease_seconds: number;
  latest_task_update_at: string | null;
  pending: {
    inspected: number; total: number; limit: number; truncated: boolean;
    stale_queued: number; stale_running: number;
    invalid_timestamps: number; future_timestamps: number;
    oldest_queued_at: string | null; oldest_started_at: string | null;
  };
}

export interface Diagnostics {
  checked_at: string;
  time_zone: string;
  database: { state: string; last_recorded_migration: string | null; migration_recorded_at: string | null };
  ai: { state: 'configured' | 'disabled'; provider: string; model: string; updated_at: string | null;
    connectivity: 'not_checked'; last_check?: ConnectionCheck | null };
  ai_queue?: AssistantQueueEvidence;
  digital_twin?: { state: 'unknown'; last_success_at: null; last_export_at?: null; acknowledgement?: 'not_recorded';
    catalog_import?: { state: 'not_recorded' | 'recorded' | 'invalid'; recorded_at: string | null;
      export_id: string | null; bundle_sha256: string | null } };
  release: { state: 'declared' | 'unknown'; revision: string | null; installation_verified: false };
}
