'use client';

import React, { useState } from 'react';
import { PlayCircle, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ErrorBanner, { ErrorBannerDetail } from '@/components/ui/ErrorBanner';
import { apiFetch, getErrorMessage } from '@/lib/api';

interface Artifact {
  filePath: string;
  content: string;
}

interface ComponentFailure {
  fileName: string;
  problem: string;
  componentType?: string;
  fullName?: string;
  lineNumber?: string;
  columnNumber?: string;
}

interface DeployResult {
  status: string;
  numberComponentsDeployed?: number;
  numberComponentErrors?: number;
  componentFailures?: ComponentFailure[];
}

interface DryRunPanelProps {
  onPassDryRun: () => void;
  /** Reports the MDAPI dry-run deployment id so it can feed the change record. */
  onDryRunComplete?: (deploymentId: string | null) => void;
  intentId: string;
  orgId: string;
  artifacts: Artifact[];
}

export default function DryRunPanel({ onPassDryRun, onDryRunComplete, intentId, orgId, artifacts }: DryRunPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Pending');
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [packageEntries, setPackageEntries] = useState<string[] | null>(null);

  const handleRunDryRun = async () => {
    setIsRunning(true);
    try {
      const data = await apiFetch<{ deploymentId: string; packageEntries?: string[] }>('/api/v1/deployments/dry-run', {
        method: 'POST',
        body: JSON.stringify({ changeSetId: intentId, orgId, artifacts })
      });
      setDryRunError(null);
      setPackageEntries(data.packageEntries || null);
      setDeploymentId(data.deploymentId);
      pollStatus(data.deploymentId);
    } catch (err) {
      console.error(err);
      setIsRunning(false);
      setHasRun(true);
      setStatus('Failed');
      setDryRunError(getErrorMessage(err, 'Dry-run request failed.'));
      onDryRunComplete?.(null);
    }
  };

  const pollStatus = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<DeployResult>(`/api/v1/deployments/status/${id}?orgId=${encodeURIComponent(orgId)}`);
        if (data.status === 'Succeeded' || data.status === 'Failed') {
          clearInterval(interval);
          setDeployResult(data);
          setStatus(data.status);
          setIsRunning(false);
          setHasRun(true);
          onDryRunComplete?.(data.status === 'Succeeded' ? id : null);
        } else {
          setStatus(data.status || 'InProgress');
        }
      } catch (err) {
        console.error(err);
        clearInterval(interval);
        setIsRunning(false);
        setHasRun(true);
        setStatus('Failed');
        setDryRunError(getErrorMessage(err, 'Dry-run status check failed.'));
        onDryRunComplete?.(null);
      }
    }, 2000);
  };

  const isSuccess = status === 'Succeeded';

  /** Normalizes MDAPI componentFailures (object | array | undefined) for display. */
  const toFailureDetails = (failures: ComponentFailure[] | undefined): ErrorBannerDetail[] => {
    const list: ComponentFailure[] = Array.isArray(failures)
      ? failures
      : failures
        ? [failures]
        : [];
    return list.map((f, idx) => ({
      title: f.fileName || f.fullName || `Component ${idx + 1}`,
      message: f.problem || 'Metadata API rejected this component without a reported reason.',
      meta: [f.componentType, f.lineNumber ? `Line ${f.lineNumber}` : null, f.columnNumber ? `Col ${f.columnNumber}` : null]
        .filter(Boolean)
        .join(' · ') || undefined,
    }));
  };

  return (
    <Card variant="glass" className="space-y-6 border-brand-border p-6 md:p-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-brand-blue">
            <PlayCircle className="w-3.5 h-3.5 text-brand-blue" />
            STAGE 7: METADATA API DRY-RUN VALIDATION
          </span>
          <Badge variant={hasRun ? (isSuccess ? 'pass' : 'refused') : 'info'} isMono size="sm">
            {hasRun ? `DRY-RUN ${isSuccess ? 'PASSED' : 'FAILED'}` : 'CHECK-ONLY MODE'}
          </Badge>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">Execute In-Memory MDAPI Validation</h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          Submits an in-memory ZIP package to Salesforce with <code className="font-mono bg-brand-surface px-1 py-0.5 rounded border border-brand-border">checkOnly=true</code> flag. No org state is mutated.
        </p>
      </div>

      {!hasRun ? (
        <div className="p-8 rounded-2xl bg-white border border-brand-border text-center space-y-4 shadow-soft">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-brand-blue mx-auto">
            {isRunning ? <RefreshCw className="w-6 h-6 animate-spin" /> : <PlayCircle className="w-6 h-6" />}
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h4 className="text-sm font-bold text-brand-dark">Ready for Dry-Run Deployment</h4>
            <p className="text-xs text-slate-500">
              Validates XML syntax, dependency references, and field-level metadata against target org schema.
            </p>
            {isRunning && <p className="text-xs text-brand-blue animate-pulse">Polling status: {status}...</p>}
          </div>
          <Button
            variant="primary"
            size="lg"
            isLoading={isRunning}
            onClick={handleRunDryRun}
            rightIcon={<PlayCircle className="w-4 h-4" />}
          >
            Run MDAPI Validation
          </Button>
        </div>
      ) : isSuccess ? (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border space-y-2 bg-emerald-50 border-emerald-300 text-emerald-900">
            <div className="flex items-center justify-between font-mono text-xs font-bold">
              <span className="flex items-center gap-1.5 text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Metadata Deployment Check Succeeded
              </span>
              <span className="text-slate-600">Deployment ID: {deploymentId || 'N/A'}</span>
            </div>
            <p className="text-xs text-emerald-700">
              All {deployResult?.numberComponentsDeployed || artifacts?.length || 0} components passed Salesforce Metadata API validation without errors.
            </p>
          </div>

          <div className="p-3 bg-white rounded-xl border border-brand-border space-y-2 text-xs font-mono shadow-soft">
            <div className="flex items-center justify-between text-slate-500 font-semibold">
              <span>Component Result</span>
              <span>Status</span>
            </div>

            {packageEntries && packageEntries.length > 0 && (
              <div className="p-2 rounded bg-brand-surface border border-slate-200 text-[10px] text-slate-500 break-all">
                <span className="font-bold text-slate-600">Packaged entries: </span>
                {packageEntries.join(', ')}
              </div>
            )}

            {artifacts.map((a, idx) => (
              <div key={idx} className="p-2 rounded bg-brand-surface border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-brand-dark">{a.filePath}</span>
                <span className="text-emerald-600 font-bold">SUCCEEDED</span>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              variant="primary"
              size="lg"
              onClick={onPassDryRun}
              rightIcon={<ArrowRight className="w-5 h-5" />}
            >
              Proceed to Rollback Snapshot
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ErrorBanner
            variant="error"
            title="Metadata Deployment Check Failed"
            message={
              dryRunError
                ? dryRunError
                : `${deployResult?.numberComponentErrors || 0} component failure${deployResult?.numberComponentErrors === 1 ? '' : 's'} detected during validation.`
            }
            details={toFailureDetails(deployResult?.componentFailures)}
            onRetry={() => {
              setHasRun(false);
              setStatus('Pending');
              setDryRunError(null);
              setDeploymentId(null);
              setDeployResult(null);
              setPackageEntries(null);
            }}
            retryLabel="Retry Validation"
          />

          <div className="flex justify-end pt-2">
            <Button
              variant="primary"
              size="lg"
              onClick={onPassDryRun}
              disabled
              rightIcon={<ArrowRight className="w-5 h-5" />}
            >
              Proceed to Rollback Snapshot
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
