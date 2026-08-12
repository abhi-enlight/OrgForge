'use client';

import React, { useState } from 'react';
import { RotateCcw, ArrowRight, FileArchive, RefreshCw, AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { apiFetch, getErrorMessage } from '@/lib/api';

interface Artifact {
  filePath: string;
  content: string;
}

interface RollbackPanelProps {
  onProceedToDeploy: () => void;
  intentId: string;
  orgId: string;
  artifacts: Artifact[];
}

interface RollbackInfo {
  fileName: string;
  sizeKB: string;
  hash: string;
  filePath: string;
}

export default function RollbackPanel({ onProceedToDeploy, intentId, orgId, artifacts }: RollbackPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [status, setStatus] = useState<string>('Pending');
  const [isDestructive, setIsDestructive] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [rollbackInfo, setRollbackInfo] = useState<RollbackInfo | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const handleRunBackup = async () => {
    setIsRunning(true);
    try {
      const data = await apiFetch<{ retrieveId: string; isDestructive: boolean }>('/api/v1/deployments/backup', {
        method: 'POST',
        body: JSON.stringify({ intentId, orgId, artifacts })
      });
      setIsDestructive(data.isDestructive);
      // Auto-acknowledge if not destructive
      if (!data.isDestructive) setAcknowledged(true);
      setBackupError(null);
      pollStatus(data.retrieveId);
    } catch (err) {
      console.error(err);
      setIsRunning(false);
      setHasRun(true);
      setStatus('Failed');
      setBackupError(getErrorMessage(err, 'Rollback snapshot request failed.'));
    }
  };

  const pollStatus = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<{ status: string; rollbackInfo?: RollbackInfo }>(
          `/api/v1/deployments/backup/status/${id}`,
          {
            method: 'POST',
            body: JSON.stringify({ intentId, orgId })
          }
        );

        if (data.status === 'Succeeded' || data.status === 'Failed') {
          clearInterval(interval);
          setRollbackInfo(data.rollbackInfo || null);
          setStatus(data.status);
          setIsRunning(false);
          setHasRun(true);
        } else {
          setStatus(data.status || 'InProgress');
        }
      } catch (err) {
        console.error(err);
        clearInterval(interval);
        setIsRunning(false);
        setHasRun(true);
        setStatus('Failed');
        setBackupError(getErrorMessage(err, 'Rollback status check failed.'));
      }
    }, 2000);
  };

  const isSuccess = status === 'Succeeded';

  return (
    <Card variant="glass" className="space-y-6 border-brand-border p-6 md:p-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-[0.14em] text-brand-blue">
            <RotateCcw className="w-3.5 h-3.5 text-brand-blue" />
            STAGE 8: PRE-CHANGE ROLLBACK BUNDLE CAPTURE
          </span>
          <Badge variant={hasRun ? (isSuccess ? 'pass' : 'refused') : 'info'} isMono size="sm">
            {hasRun ? (isSuccess ? 'SNAPSHOT CAPTURED' : 'BACKUP FAILED') : 'PENDING CAPTURE'}
          </Badge>
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-brand-dark">Capture Pre-Change Metadata State</h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          OrgForge queries the target org via Metadata API <code className="font-mono bg-brand-surface px-1 py-0.5 rounded border border-brand-border">retrieve()</code> to capture the pre-change state before deployment.
        </p>
      </div>

      {!hasRun ? (
        <div className="p-8 rounded-2xl bg-white border border-brand-border text-center space-y-4 shadow-soft">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-brand-blue mx-auto">
            {isRunning ? <RefreshCw className="w-6 h-6 animate-spin" /> : <FileArchive className="w-6 h-6" />}
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h4 className="text-sm font-bold text-brand-dark">Ready to Capture Rollback Bundle</h4>
            <p className="text-xs text-slate-500">
              Retrieves the current state of targeted components from the org and securely archives them.
            </p>
            {isRunning && <p className="text-xs text-brand-blue animate-pulse">Polling retrieve status: {status}...</p>}
          </div>
          <Button
            variant="primary"
            size="lg"
            isLoading={isRunning}
            onClick={handleRunBackup}
            rightIcon={<RotateCcw className="w-4 h-4" />}
          >
            Retrieve Pre-Change State
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {backupError && (
            <ErrorBanner
              variant="error"
              title="Rollback Snapshot Failed"
              message={backupError}
              onRetry={() => {
                setHasRun(false);
                setStatus('Pending');
                setBackupError(null);
                setRollbackInfo(null);
              }}
              retryLabel="Retry Backup"
            />
          )}

          {isSuccess && rollbackInfo && (
            <div className="p-4 rounded-xl bg-white border border-brand-border space-y-3 shadow-soft">
              <div className="flex items-center justify-between border-b border-brand-border pb-3">
                <div className="flex items-center gap-2">
                  <FileArchive className="w-5 h-5 text-brand-blue" />
                  <div>
                    <span className="block text-xs font-bold text-brand-dark font-mono">
                      {rollbackInfo.fileName}
                    </span>
                    <span className="block text-[10px] text-slate-500 font-mono">
                      Size: {rollbackInfo.sizeKB} KB · Saved locally
                    </span>
                  </div>
                </div>
                <Badge variant="pass" size="sm" isMono>
                  READY FOR ONE-CLICK REVERT
                </Badge>
              </div>

              <div className="p-3 bg-brand-surface/70 rounded-lg text-xs font-mono text-slate-600 space-y-1">
                <div className="flex justify-between">
                  <span>Target Components:</span>
                  <span className="font-bold text-brand-dark">{artifacts.length} modified files</span>
                </div>
                <div className="flex justify-between">
                  <span>Snapshot Hash:</span>
                  <span className="text-brand-blue">sha256:{rollbackInfo.hash}</span>
                </div>
              </div>
            </div>
          )}

          {isDestructive && (
            <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 space-y-3">
              <div className="flex gap-2 text-orange-800 mb-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold">REF-06: Destructive Change Warning</h4>
                  <p className="text-xs">
                    This deployment includes destructive changes (e.g. dropping data/fields).
                    A metadata rollback cannot restore deleted data.
                  </p>
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer p-2 bg-white rounded-lg border border-orange-200">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 rounded text-orange-600 focus:ring-orange-600 w-4 h-4"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-brand-dark">
                    I acknowledge that dropping data is irreversible.
                  </span>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    I have verified that a full org data backup exists if needed.
                  </p>
                </div>
              </label>
            </div>
          )}

          {!isDestructive && isSuccess && (
             <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 rounded text-brand-blue focus:ring-brand-blue w-4 h-4"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-brand-dark">
                    Acknowledge Pre-Change State Snapshot Saved
                  </span>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    Confirm that a single-command rollback bundle has been safely archived in the database vault.
                  </p>
                </div>
              </label>
            </div>
          )}

          <div className="flex justify-end pt-2 gap-2">
            {!isSuccess && !backupError && (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => { setHasRun(false); setStatus('Pending'); setBackupError(null); setRollbackInfo(null); }}
                rightIcon={<RefreshCw className="w-5 h-5" />}
              >
                Retry Backup
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              disabled={!acknowledged || !isSuccess}
              onClick={onProceedToDeploy}
              rightIcon={<ArrowRight className="w-5 h-5" />}
            >
              Proceed to Stage 9: Final Deployment
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
