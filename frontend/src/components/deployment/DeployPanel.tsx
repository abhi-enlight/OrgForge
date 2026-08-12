'use client';

import React, { useState, useEffect } from 'react';
import { UploadCloud, Lock, ShieldCheck, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import ErrorBanner, { ErrorBannerDetail } from '@/components/ui/ErrorBanner';
import ApproverInput from '@/components/gates/ApproverInput';
import { ChangeRecord } from '@/components/records/ChangeRecordCard';
import { getAccessToken } from '@/lib/supabase';
import { apiFetch, getErrorMessage } from '@/lib/api';

interface Artifact {
  filePath: string;
  content: string;
  metadataType?: string;
  fullName?: string;
  skillUsed?: string;
}

interface ImpactBrief {
  blastRadiusClassification?: string;
  summaryNarrative?: string;
  dependencyImpact?: { referencingComponentsCount?: number };
  dataImpact?: { violatingRecordsCount?: number };
  permissionImpact?: { affectedUsersCount?: number };
}

interface GateResultSummary {
  gateCode: string;
  outcome: 'PASS' | 'REFUSED';
  plainLanguageReason?: string;
}

interface ComponentFailure {
  fileName?: string;
  problem?: string;
  componentType?: string;
  fullName?: string;
  lineNumber?: string;
  columnNumber?: string;
}

interface DeployPanelProps {
  onDeploySuccess: (record: ChangeRecord) => void;
  intentId: string;
  orgId: string;
  orgAlias?: string;
  intent: string;
  businessRationale: string;
  artifacts: Artifact[];
  changeSetId?: string;
  // Evidence captured earlier in the pipeline (PRD Hard Rule 1): the change
  // record stores what was shown to the human operator.
  dryRunId?: string | null;
  impactBrief?: ImpactBrief | null;
  gateResults?: GateResultSummary[] | null;
  skillsUsed?: string[];
  // Inherited from a Stage-6 REF-07 clearance so the operator does not
  // re-enter production mode twice.
  initialIsProdMode?: boolean;
  initialApprover?: string;
}

export default function DeployPanel({
  onDeploySuccess,
  intentId,
  orgId,
  orgAlias = '',
  intent,
  businessRationale,
  artifacts,
  changeSetId = '',
  dryRunId = null,
  impactBrief = null,
  gateResults = null,
  skillsUsed = [],
  initialIsProdMode = false,
  initialApprover = 'governance-lead@enlightlab.com'
}: DeployPanelProps) {
  const [isProdMode, setIsProdMode] = useState(initialIsProdMode);
  const [approverEmail, setApproverEmail] = useState(initialApprover);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<string>('Not Started');
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployFailureDetails, setDeployFailureDetails] = useState<ErrorBannerDetail[]>([]);

  /** Normalizes componentFailures (object | array | undefined) to a UI list. */
  const toFailureDetails = (failures: unknown): ErrorBannerDetail[] => {
    const list: ComponentFailure[] = Array.isArray(failures)
      ? (failures as ComponentFailure[])
      : failures
        ? [failures as ComponentFailure]
        : [];
    return list.map((f, idx) => ({
      title: f.fileName || f.fullName || `Component ${idx + 1}`,
      message: f.problem || 'Metadata API rejected this component without a reported reason.',
      meta: [f.componentType, f.fullName && f.fullName !== f.fileName ? f.fullName : null]
        .filter(Boolean)
        .join(' · ') || undefined,
    }));
  };

  useEffect(() => {
    // Clean up event source if unmounted
    return () => {
      // Nothing needed explicitly unless we store eventSource in state
    };
  }, []);

  const handleExecuteDeploy = async () => {
    setIsConfirmOpen(false);
    setIsDeploying(true);
    setDeployError(null);
    setDeployStatus('Starting...');

    try {
      // 1. POST to execute
      const data = await apiFetch<{ deploymentId: string }>('/api/v1/deployments/execute', {
        method: 'POST',
        body: JSON.stringify({
          changeSetId,
          approverIdentity: isProdMode ? approverEmail : undefined,
          productionMode: isProdMode,
          artifacts,
          intent,
          businessRationale,
          orgId,
          intentId,
          dryRunId,
          impactBrief,
          gateResults
        })
      });

      const deploymentId = data.deploymentId;

      // 2. Open SSE stream with orgId + access token (EventSource cannot set headers)
      const token = (await getAccessToken()) || '';
      const eventSource = new EventSource(
        `/api/v1/deployments/status-stream/${deploymentId}?orgId=${encodeURIComponent(orgId)}&access_token=${encodeURIComponent(token)}`
      );

      eventSource.onmessage = (event) => {
        try {
          const statusData = JSON.parse(event.data);
          setDeployStatus(statusData.status);

          if (statusData.status === 'Succeeded') {
            eventSource.close();
            setIsDeploying(false);
            const raw = statusData.changeRecord;
            if (raw && raw.id) {
              onDeploySuccess({
                id: raw.id,
                changeSetId: raw.changeSetId || changeSetId,
                orgAlias,
                orgId,
                intent: raw.intent || intent,
                businessRationale: raw.businessRationale || businessRationale,
                approverIdentity: raw.approverIdentity || approverEmail,
                deploymentId: raw.deploymentId || deploymentId,
                gitCommitHash: raw.gitCommitHash || 'local-write (no git push)',
                signatureHash: raw.signatureHash || '',
                dryRunId: raw.dryRunId || dryRunId || null,
                impactBrief: raw.impactBrief || impactBrief || null,
                gateResults: raw.gateResults || gateResults || null,
                skillsUsed: raw.skillsUsed || skillsUsed || [],
                createdAt: raw.timestamp || new Date().toISOString()
              });
            } else {
              setDeployError('Deployment succeeded but the change record was not created.');
            }
          } else if (statusData.status === 'Failed' || statusData.status === 'Canceled') {
            eventSource.close();
            const failures = toFailureDetails(statusData.componentFailures);
            setDeployFailureDetails(failures);
            setDeployError(
              statusData.status === 'Canceled'
                ? 'The deployment was canceled by Salesforce.'
                : failures.length > 0
                  ? `Metadata API rejected ${failures.length} component${failures.length === 1 ? '' : 's'} during the live deploy.`
                  : 'Deployment failed. Review the target org for details, or re-run the dry-run check.'
            );
            setIsDeploying(false);
          } else if (statusData.status === 'Error') {
            eventSource.close();
            setDeployError(
              getErrorMessage(statusData.error, 'The deployment status stream failed mid-flight.')
            );
            setIsDeploying(false);
          }
        } catch (e) {
          console.error('Error parsing SSE data', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('SSE connection error:', err);
        eventSource.close();
        setDeployError('Lost connection to deployment stream');
        setIsDeploying(false);
      };

    } catch (err: unknown) {
      setDeployError(getErrorMessage(err, 'Deployment could not be started.'));
      setIsDeploying(false);
    }
  };

  return (
    <Card variant="glass" className="space-y-6 border-brand-border p-6 md:p-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-brand-blue">
            <UploadCloud className="w-3.5 h-3.5 text-brand-blue" />
            STAGE 9: LIVE METADATA DEPLOYMENT
          </span>
          <Badge variant={isProdMode ? 'warning' : 'pass'} isMono size="sm">
            {isProdMode ? 'PRODUCTION GATED' : 'SANDBOX TARGET'}
          </Badge>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">Execute Metadata API Deploy</h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          Submits the verified metadata package to the target Salesforce org via Metadata API transport.
        </p>
      </div>

      {deployError && (
        <ErrorBanner
          variant="error"
          title="Deployment Failed"
          message={deployError}
          details={deployFailureDetails.length > 0 ? deployFailureDetails : undefined}
          onRetry={isDeploying ? undefined : () => {
            setDeployError(null);
            setDeployFailureDetails([]);
            setDeployStatus('Not Started');
          }}
          retryLabel="Reset & Review"
        />
      )}

      {/* Production Toggle Warning */}
      <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-300 space-y-3">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isProdMode}
              onChange={(e) => setIsProdMode(e.target.checked)}
              className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
              disabled={isDeploying}
            />
            <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-amber-700" />
              Enable Production Deployment Gate Mode
            </span>
          </label>
          {isProdMode && (
            <Badge variant="warning" size="sm" isMono>
              REF-07 ACTIVE
            </Badge>
          )}
        </div>
        {isProdMode && (
          <p className="text-xs text-amber-800 leading-normal pl-7 font-mono">
            <strong>WARNING:</strong> Target environment is marked as PRODUCTION. Requires mandatory approver identity and zero refused gates.
          </p>
        )}
      </div>

      {/* Approver Input if needed */}
      <ApproverInput value={approverEmail} onChange={setApproverEmail} />

      {isDeploying && (
        <div className="p-4 bg-brand-surface/70 rounded-xl border border-brand-border flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-brand-blue animate-spin" />
          <div>
            <div className="text-xs font-bold text-brand-dark">Deployment Status: {deployStatus}</div>
            <div className="text-[10px] text-slate-500">Streaming updates via Server-Sent Events...</div>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          variant={isProdMode ? 'danger' : 'pass'}
          size="lg"
          isLoading={isDeploying}
          disabled={isDeploying}
          onClick={() => setIsConfirmOpen(true)}
          rightIcon={<UploadCloud className="w-5 h-5" />}
        >
          {isProdMode ? 'Deploy to Production Org' : 'Deploy to Sandbox Org'}
        </Button>
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title="Confirm Live Salesforce Metadata Deployment"
        description="Review change set payload before executing Metadata API deploy"
      >
        <div className="space-y-4 py-2">
          <div className="p-3 bg-brand-surface/70 rounded-xl border border-brand-border space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-500">Target Org:</span>
              <span className="font-bold text-brand-dark">
                {orgAlias || orgId} ({orgId})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Target Components:</span>
              <span className="font-bold text-brand-blue">{artifacts.length} modified files</span>
            </div>
            {isProdMode && (
              <div className="flex justify-between">
                <span className="text-slate-500">Approver Identity:</span>
                <span className="font-bold text-emerald-700">{approverEmail}</span>
              </div>
            )}
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>All 10 Refusal Gates evaluated and passed. SHA-256 change record will be signed.</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="ghost" size="md" onClick={() => setIsConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="pass" size="md" onClick={handleExecuteDeploy}>
              Confirm & Deploy Now
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
