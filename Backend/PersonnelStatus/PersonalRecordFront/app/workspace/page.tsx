import { OpsPermissionBoundary } from '@/components/ops-permission-boundary';
import { PortalWorkspace } from '@/features/portal-workspace/workspace';

export default function WorkspacePage() {
  return <OpsPermissionBoundary><PortalWorkspace /></OpsPermissionBoundary>;
}
