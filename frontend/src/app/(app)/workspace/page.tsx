'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import StageTimeline, { Stage } from '@/components/workspace/StageTimeline';
import OrgSelector from '@/components/workspace/OrgSelector';
import IntentEditor from '@/components/workspace/IntentEditor';
import AmbiguityCard from '@/components/workspace/AmbiguityCard';
import ArtifactViewer from '@/components/workspace/ArtifactViewer';
import BlastRadiusCard from '@/components/impact/BlastRadiusCard';
import RefusalGateCard, { GateResult } from '@/components/gates/RefusalGateCard';
import DryRunPanel from '@/components/deployment/DryRunPanel';
import RollbackPanel from '@/components/deployment/RollbackPanel';
import DeployPanel from '@/components/deployment/DeployPanel';
import ChangeRecordCard, { ChangeRecord } from '@/components/records/ChangeRecordCard';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ErrorBanner from '@/components/ui/ErrorBanner';
import PackageHealthChip from '@/components/org/PackageHealthChip';
import PackageInstallModal from '@/components/org/PackageInstallModal';
import { useOrgPackageHealthFor } from '@/lib/orgHealth';
import type { PackageHealth } from '@/lib/orgHealth';
import { Cpu, ArrowRight, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { apiFetch, getErrorMessage, HEAVY_REQUEST_TIMEOUT_MS } from '@/lib/api';
import { useToast } from '@/components/providers/ToastProvider';
import { EASE_REVEAL } from '@/lib/motion';
import UnblockActionModal, { UnblockEvidence } from '@/components/gates/UnblockActionModal';
import { ToastProvider } from '@/components/providers/ToastProvider';

interface RedirectNotice {
  type: 'error' | 'success';
  message: string;
  /**
   * ECA-not-installed flow (auth.js /salesforce/callback): when Salesforce
   * refused sign-in because the OrgForge Connector ECA is missing from the
   * org, the backend redirects with error=ECANotInstalled plus the org-aware
   * install link. The install-steps popup opens instead of a bare error line.
   */
  installUrl?: string;
  orgType?: string;
  instanceUrl?: string;
}

/**
 * Maps the OAuth callback error codes the backend redirects with
 * (auth.js /salesforce/callback) to actionable copy.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  MissingAuthData:
    'Salesforce returned an incomplete connection response. Please retry connecting your org.',
  InvalidOrExpiredState:
    'The connection request expired. Please retry connecting your org.',
  DatabaseError:
    'Your org connected, but saving it to the vault failed. Please retry the connection.',
  ExchangeFailed:
    'Salesforce rejected the connection handshake (invalid or revoked credentials). Please retry.',
  // Shown only when the backend could NOT resolve an install link (e.g.
  // expired PKCE state); with a link the install-steps popup opens instead.
  ECANotInstalled:
    'The OrgForge Connector is not installed in this org. Install it, then retry connecting.',
};

function readRedirectNotice(): RedirectNotice | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');
  if (errorCode) {
    // params.get already decodes percent-encoding, so use it verbatim —
    // re-decoding could throw URIError on a literal '%' (e.g. "100%").
    const message = OAUTH_ERROR_MESSAGES[errorCode] || errorCode;
    if (errorCode === 'ECANotInstalled') {
      return {
        type: 'error',
        message,
        installUrl: params.get('installUrl') || undefined,
        orgType: params.get('orgType') || 'production',
        instanceUrl: params.get('instanceUrl') || undefined,
      };
    }
    return { type: 'error', message };
  }
  if (params.get('success') === 'true') {
    return {
      type: 'success',
      message: 'Salesforce org connected successfully. Your metadata is being indexed. You can begin a governed session now.',
    };
  }
  return null;
}

interface ApiOrg {
  id: string;
  alias: string;
  type: string;
  instanceUrl: string;
}

interface AmbiguityOption {
  id: string;
  title: string;
  desc: string;
  recommended: boolean;
}

interface GeneratedArtifact {
  filePath: string;
  metadataType: string;
  fullName?: string;
  skillUsed: string;
  skillVersion: string;
  content: string;
}

interface ImpactMetrics {
  blastRadiusClassification: 'Low' | 'Medium' | 'High' | 'Blocked';
  summaryNarrative?: string;
  dependencyImpact: {
    referencingComponentsCount: number;
    components?: Array<{ type: string; name: string }>;
    analysisComplete?: boolean;
    reason?: string;
  };
  dataImpact: {
    violatingRecordsCount: number;
    sampleRecordIds?: string[];
    analysisComplete?: boolean;
    reason?: string;
  };
  permissionImpact: {
    affectedUsersCount: number;
    affectedPermissionSets?: string[];
    analysisComplete?: boolean;
    reason?: string;
  };
  integrationImpact?: {
    connectedApps?: string[];
    namedCredentials?: string[];
    analysisComplete?: boolean;
    reason?: string;
  };
  analysisComplete?: boolean;
}

/**
 * Turns the backend's incomplete-dimension reasons (REF-01: the brief is only
 * trustworthy when every dimension completed) into a user-readable sentence.
 * The reasons were previously returned by the API but never surfaced.
 */
function collectIncompleteReasons(m: ImpactMetrics): string {
  const dims: Array<[string, { analysisComplete?: boolean; reason?: string } | undefined]> = [
    ['Dependency analysis', m.dependencyImpact],
    ['Data analysis', m.dataImpact],
    ['Permission analysis', m.permissionImpact],
    ['Integration analysis', m.integrationImpact],
  ];
  const reasons = dims
    .filter(([, dim]) => dim?.analysisComplete === false)
    .map(([name, dim]) => `${name} could not complete${dim?.reason ? `: ${dim.reason}` : '.'}`);
  if (reasons.length === 0) {
    return 'One or more impact dimensions did not complete, so this brief is partial and the refusal gates may refuse it.';
  }
  return reasons.join(' ');
}

interface GateEvaluation {
  gateOutcome: 'PASS' | 'REFUSED';
  results: GateResult[];
}

function getQueryOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('orgId');
}



function WorkspaceSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header bar skeleton */}
      <div className="rounded-2xl border border-brand-border bg-white p-6 shadow-soft">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="skeleton h-10 w-10 rounded-xl" />
            <div className="space-y-2">
              <div className="skeleton h-4 w-44 rounded-md" />
              <div className="skeleton h-3 w-64 rounded-md" />
            </div>
          </div>
          <div className="skeleton h-11 w-48 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-3">
          <div className="skeleton h-3 w-32 rounded-md" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
        <div className="lg:col-span-8 space-y-4">
          <div className="skeleton h-3 w-40 rounded-md" />
          <div className="skeleton h-6 w-72 rounded-md" />
          <div className="skeleton h-32 rounded-xl" />
          <div className="skeleton h-40 rounded-xl" />
          <div className="skeleton h-11 w-56 rounded-xl ml-auto" />
        </div>
      </div>
    </div>
  );
}

/**
 * Unified-app entry: the Forge shell mounted ToastProvider at the layout
 * level; the unified `(app)` layout has no global provider, so the workspace
 * wraps itself so useToast() inside the 10-stage flow works unchanged.
 */
export default function WorkspacePage() {
  return (
    <ToastProvider>
      <WorkspaceFlow />
    </ToastProvider>
  );
}

function WorkspaceFlow() {
  const router = useRouter();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const [currentStage, setCurrentStage] = useState(2);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [orgs, setOrgs] = useState<ApiOrg[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<{ id: string; alias: string } | null>(null);

  const [intentId, setIntentId] = useState<string | null>(null);
  const [intentText, setIntentText] = useState('');
  const [rationaleText, setRationaleText] = useState('');
  const [changeSetId, setChangeSetId] = useState('');
  const [dryRunId, setDryRunId] = useState<string | null>(null);
  // REF-07: production mode cleared via the UnblockActionModal at Stage 6 is
  // carried through to the Stage-9 deploy so the operator does not re-enter it.
  const [prodModeEnabled, setProdModeEnabled] = useState(false);
  const [prodApprover, setProdApprover] = useState('');

  const [ambiguities, setAmbiguities] = useState<AmbiguityOption[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isResolving, setIsResolving] = useState(false);

  const [artifacts, setArtifacts] = useState<GeneratedArtifact[]>([]);
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);

  const [impactMetrics, setImpactMetrics] = useState<ImpactMetrics | null>(null);
  const [isAnalyzingImpact, setIsAnalyzingImpact] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const [stages, setStages] = useState<Stage[]>([
    { number: 1, title: 'Connect Org', shortDesc: 'Dev2 Sandbox', status: 'complete' },
    { number: 2, title: 'State Intent', shortDesc: 'Prompt & Rationale', status: 'active' },
    { number: 3, title: 'Clarify', shortDesc: '1 Ambiguity', status: 'pending' },
    { number: 4, title: 'Generate XML', shortDesc: 'XSD v64.0 OK', status: 'pending' },
    { number: 5, title: 'Analyze Impact', shortDesc: 'High Blast Radius', status: 'pending' },
    { number: 6, title: 'Refusal Gates', shortDesc: '1 Gate Refused', status: 'pending' },
    { number: 7, title: 'Dry-Run Check', shortDesc: 'MDAPI checkOnly', status: 'pending' },
    { number: 8, title: 'Rollback Snapshot', shortDesc: 'Pre-change Archive', status: 'pending' },
    { number: 9, title: 'Deploy Change', shortDesc: 'Production Gate', status: 'pending' },
    { number: 10, title: 'Signed Audit', shortDesc: 'SHA-256 HMAC', status: 'pending' }
  ]);

  const [gateEvaluation, setGateEvaluation] = useState<GateEvaluation | null>(null);
  const [isEvaluatingGates, setIsEvaluatingGates] = useState(false);
  const [changeRecord, setChangeRecord] = useState<ChangeRecord | undefined>(undefined);
  const [selectedGateToUnblock, setSelectedGateToUnblock] = useState<GateResult | null>(null);
  const [isUnblockModalOpen, setIsUnblockModalOpen] = useState(false);
  const [redirectNotice, setRedirectNotice] = useState<RedirectNotice | null>(null);
  // ECA-not-installed popup: auto-opens when the OAuth callback came back with
  // error=ECANotInstalled AND an install link (mirrors the login flow).
  const [ecaInstallPopupOpen, setEcaInstallPopupOpen] = useState(false);

  const queryOrgId = getQueryOrgId();

  // Package-install health: auto-check after connect/org-switch (Redis-cached
  // 10 min), re-check on demand, popup once per org per session. Standalone
  // hook — the workspace tracks its OWN selected org, which may differ from
  // the app's active org (the shared provider is keyed to the active org).
  const {
    status: pkgStatus,
    health: pkgHealth,
    showModal: showPkgModal,
    forceRecheck: recheckPackage,
    dismissModal: dismissPkgModal,
    reopenModal: reopenPkgModal
  } = useOrgPackageHealthFor(selectedOrg?.id || queryOrgId || null);

  // Surface OAuth callback outcomes (?error= / ?success=true) the backend
  // redirects with after the Salesforce round-trip, then scrub the query
  // string so the notice isn't re-shown on every reload. Deferred with a
  // timeout so state isn't set synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const notice = readRedirectNotice();
      if (!notice || cancelled) return;
      setRedirectNotice(notice);
      if (notice.installUrl) setEcaInstallPopupOpen(true);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('error');
        url.searchParams.delete('success');
        // ECA-not-installed params were consumed into the notice/popup — scrub
        // them too so a refresh doesn't re-trigger the popup.
        url.searchParams.delete('installUrl');
        url.searchParams.delete('orgType');
        url.searchParams.delete('instanceUrl');
        window.history.replaceState({}, '', url.toString());
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Authenticate + load the org list once.
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const isE2E = typeof window !== 'undefined' && window.location.search.includes('mockAuth=true');
      if (!data.session && !isE2E) {
        router.push('/login');
        return;
      }

      try {
        const body = await apiFetch<{ orgs: ApiOrg[] }>('/api/v1/orgs');
        const list = body.orgs || [];
        setOrgs(list);
        if (list.length === 0) {
          router.push('/dashboard');
          return;
        }
        const target = list.find((o) => o.id === queryOrgId) || list[0];
        setSelectedOrg({ id: target.id, alias: target.alias || target.id });
      } catch (err) {
        toast.error('Failed to load orgs', err instanceof Error ? err.message : undefined);
        console.error('Failed to load orgs:', err);
      }
      setIsAuthReady(true);
    };
    init();
  }, [router, queryOrgId, toast]);

  const handleSelectOrg = (id: string) => {
    const target = orgs.find((o) => o.id === id);
    if (!target) return;
    setSelectedOrg({ id: target.id, alias: target.alias || target.id });
    // Reset the in-progress workflow so artifacts generated for one org can
    // never be deployed against a different org.
    setIntentId(null);
    setIntentText('');
    setRationaleText('');
    setChangeSetId('');
    setDryRunId(null);
    setProdModeEnabled(false);
    setProdApprover('');
    setAmbiguities([]);
    setArtifacts([]);
    setImpactMetrics(null);
    setImpactError(null);
    setGateEvaluation(null);
    setChangeRecord(undefined);
    setCurrentStage(2);
    setStages((prev) =>
      prev.map((s, i) => ({
        ...s,
        status: i === 0 ? 'complete' : i === 1 ? 'active' : 'pending'
      }))
    );
  };

  const updateStageStatus = (stageNum: number, status: 'pending' | 'active' | 'complete' | 'refused') => {
    setStages((prev) => prev.map((s) => (s.number === stageNum ? { ...s, status } : s)));
  };

  const advanceStage = (nextStage: number) => {
    updateStageStatus(currentStage, 'complete');
    updateStageStatus(nextStage, 'active');
    setCurrentStage(nextStage);
  };

  const handleGenerateMetadata = async (currentIntentId: string) => {
    setIsGeneratingMetadata(true);
    try {
      const data = await apiFetch<{ changeSetId: string; artifacts: GeneratedArtifact[] }>(
        '/api/v1/changes/generate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intentId: currentIntentId })
        },
        HEAVY_REQUEST_TIMEOUT_MS
      );
      if (data.artifacts && data.artifacts.length > 0) {
        setArtifacts(data.artifacts);
        setChangeSetId(data.changeSetId || '');
        advanceStage(4);
      }
    } catch (err) {
      updateStageStatus(4, 'refused');
      toast.error(
        'Metadata generation failed',
        err instanceof Error ? err.message : 'Unknown error'
      );
      console.error('Metadata generation failed:', err);
    } finally {
      setIsGeneratingMetadata(false);
    }
  };

  const handleAnalyzeImpact = async (currentIntentId: string) => {
    advanceStage(5);
    setIsAnalyzingImpact(true);
    setImpactError(null);
    try {
      const data = await apiFetch<ImpactMetrics>(
        `/api/v1/impact/${currentIntentId}/impact-brief`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        HEAVY_REQUEST_TIMEOUT_MS
      );
      setImpactMetrics(data);
    } catch (err) {
      updateStageStatus(5, 'refused');
      setImpactMetrics(null);
      const message = getErrorMessage(err, 'Impact analysis failed');
      setImpactError(message);
      toast.error('Impact analysis failed', message);
      console.error('Impact analysis failed:', err);
    } finally {
      setIsAnalyzingImpact(false);
    }
  };

  const handleEvaluateGates = async (
    currentIntentId: string,
    evidence?: UnblockEvidence
  ) => {
    advanceStage(6);
    setIsEvaluatingGates(true);
    try {
      const data = await apiFetch<{
        gateOutcome: 'PASS' | 'REFUSED';
        results: Array<{
          gateCode: string;
          name: string;
          outcome: 'PASS' | 'REFUSED';
          plainLanguageReason: string;
          missingEvidence?: string;
          unblockPath?: string;
        }>;
      }>('/api/v1/gates/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intentId: currentIntentId,
          // Stage-4 artifacts are shipped so REF-03 can statically analyze any
          // generated Apex; productionMode feeds REF-07.
          artifacts,
          productionMode: evidence?.productionMode === true || prodModeEnabled,
          ...(evidence?.approverIdentity
            ? { approverIdentity: evidence.approverIdentity }
            : {}),
          ...(evidence?.rollbackAcknowledged ? { rollbackAcknowledged: true } : {})
        })
      }, HEAVY_REQUEST_TIMEOUT_MS);

      const mappedResults: GateResult[] = data.results.map((r) => ({
        code: r.gateCode,
        name: r.name,
        outcome: r.outcome,
        plainReason: r.plainLanguageReason,
        missingEvidence: r.missingEvidence,
        unblockPath: r.unblockPath
      }));

      const evaluation: GateEvaluation = {
        gateOutcome: data.gateOutcome,
        results: mappedResults
      };
      setGateEvaluation(evaluation);
      if (data.gateOutcome === 'REFUSED') {
        updateStageStatus(6, 'refused');
      } else {
        updateStageStatus(6, 'complete');
      }
      return evaluation;
    } catch (err) {
      updateStageStatus(6, 'refused');
      toast.error(
        'Refusal gate evaluation failed',
        err instanceof Error ? err.message : 'Unknown error'
      );
      console.error('Gates evaluation failed:', err);
      return null;
    } finally {
      setIsEvaluatingGates(false);
    }
  };

  const handleGenerateIntent = async (intent: string, rationale: string) => {
    if (!selectedOrg) return;
    setIntentText(intent);
    setRationaleText(rationale);
    setIsGenerating(true);
    try {
      const data = await apiFetch<{ intentId: string; ambiguities?: AmbiguityOption[] }>(
        '/api/v1/changes/intent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: selectedOrg.id,
            prompt: intent,
            businessRationale: rationale
          })
        }
      );
      setIntentId(data.intentId);

      if (data.ambiguities && data.ambiguities.length > 0) {
        setAmbiguities(data.ambiguities);
        advanceStage(3);
      } else {
        await handleGenerateMetadata(data.intentId);
      }
    } catch (error) {
      toast.error(
        'Intent generation failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
      console.error('Intent generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleResolveAmbiguity = async (selectedOption: string) => {
    if (!intentId) return;
    setIsResolving(true);
    try {
      await apiFetch(`/api/v1/changes/intent/${intentId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedOption: selectedOption })
      });
      await handleGenerateMetadata(intentId);
    } catch (error) {
      toast.error('Ambiguity clarification failed', getErrorMessage(error, 'Clarification failed'));
      console.error('Clarification failed:', error);
    } finally {
      setIsResolving(false);
    }
  };

  /**
   * Free-text escape hatch: the AI's options didn't cover the user's real
   * intent. The backend stores `resolvedOption` verbatim into the structured
   * intent and the metadata generator sees it, so a custom resolution flows
   * straight into Stage 4 generation — no backend changes needed.
   */
  const handleCustomResolve = async (customText: string) => {
    if (!intentId) return;
    setIsResolving(true);
    try {
      await apiFetch(`/api/v1/changes/intent/${intentId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedOption: customText })
      });
      await handleGenerateMetadata(intentId);
    } catch (error) {
      // Same failure behavior as handleResolveAmbiguity: keep the stage active
      // so the user can retry — a transient failure is not a governance refusal.
      toast.error('Clarification failed', getErrorMessage(error, 'Could not save your custom resolution'));
      console.error('Custom clarification failed:', error);
    } finally {
      setIsResolving(false);
    }
  };

  /**
   * Rephrase escape hatch: return to Stage 2 with the user's original intent
   * and rationale preserved in the editor (intentText/rationaleText are kept
   * in state), discarding everything downstream so no stale artifacts survive.
   */
  const handleRephraseIntent = () => {
    setAmbiguities([]);
    setArtifacts([]);
    setImpactMetrics(null);
    setImpactError(null);
    setGateEvaluation(null);
    setChangeRecord(undefined);
    setChangeSetId('');
    setDryRunId(null);
    setCurrentStage(2);
    setStages((prev) =>
      prev.map((s) => {
        if (s.number === 2) return { ...s, status: 'active' };
        if (s.number > 2) return { ...s, status: 'pending' };
        return s;
      })
    );
  };

  if (!isAuthReady) {
    return <WorkspaceSkeleton />;
  }

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: EASE_REVEAL };

  // Refusal-reason treatment (same as the Copilot card): refused gates lead
  // the dashboard with their causes; passed gates collapse into one compact
  // row instead of burying the refusals in a wall of 10 equal cards.
  const refusedGates = gateEvaluation?.results.filter((g) => g.outcome === 'REFUSED') ?? [];
  const passedGates = gateEvaluation?.results.filter((g) => g.outcome === 'PASS') ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* OAuth / connection flow notices (survive the redirect round-trip).
          The ECA-not-installed case is surfaced by the install-steps popup
          below instead of the raw error banner (mirrors the login flow). */}
      {redirectNotice && !ecaInstallPopupOpen && (
        <ErrorBanner
          variant={redirectNotice.type === 'error' ? 'error' : 'success'}
          title={
            redirectNotice.type === 'error' ? 'Org Connection Failed' : 'Org Connected'
          }
          message={redirectNotice.message}
          onDismiss={() => setRedirectNotice(null)}
        />
      )}

      {/* Workspace Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 md:p-6 rounded-2xl border border-brand-border shadow-soft">
        <div className="flex items-center gap-4 min-w-0">
          <div className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-white shadow-md shadow-brand-blue/25">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-brand-dark">
                Operator Workspace
              </h1>
              <Badge variant="pass" size="sm" isMono>
                SESSION ACTIVE
              </Badge>
            </div>
            <p className="text-sm text-slate-500 leading-snug">
              Skills-grounded AI customization session with 10-stage refusal governance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-surface/70 border border-brand-border text-xs font-semibold text-slate-600">
            <span className="font-mono text-brand-blue font-bold">{currentStage}</span>
            <span className="text-slate-400">/</span>
            <span className="font-mono">10</span>
            <span className="text-slate-400 ml-1">STAGES</span>
          </div>
          {selectedOrg && (
            /* flex-wrap lets the chip and the full-width org selector stack on
               mobile instead of overflowing the header card (the selector is
               w-full below sm, so a non-wrapping row would exceed the viewport). */
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <PackageHealthChip
                status={pkgStatus}
                onRecheck={recheckPackage}
                onShowModal={reopenPkgModal}
              />
              <OrgSelector orgId={selectedOrg.id} orgs={orgs} onSelectOrg={handleSelectOrg} />
            </div>
          )}
        </div>
      </div>

      {/* Workspace Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Timeline (4 cols) */}
        <div className="lg:col-span-4">
          <StageTimeline
            stages={stages}
            currentStage={currentStage}
            onSelectStage={(num) => setCurrentStage(num)}
          />
        </div>

        {/* Right Active Stage Workspace (8 cols) */}
        <div className="lg:col-span-8 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStage}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
              transition={transition}
            >
              <div className="space-y-6">
                {/* Stage 1 Content */}
                {currentStage === 1 && (
                  <div className="p-8 bg-white rounded-2xl border border-brand-border shadow-soft space-y-4">
                    <h3 className="text-xl font-bold tracking-tight text-brand-dark">Stage 1: Target Org Connected</h3>
                    <p className="text-sm text-slate-600">
                      Connected to <strong className="font-semibold text-brand-dark">{selectedOrg?.alias || 'Org'}</strong>.
                    </p>
                    <Button variant="primary" onClick={() => advanceStage(2)}>
                      Proceed to Stage 2: State Intent
                    </Button>
                  </div>
                )}

                {/* Stage 2 Content */}
                {currentStage === 2 && (
                  <IntentEditor
                    onGenerate={handleGenerateIntent}
                    isGenerating={isGenerating}
                    initialIntent={intentText}
                    initialRationale={rationaleText}
                  />
                )}

                {/* Stage 3 Content */}
                {currentStage === 3 && (
                  <AmbiguityCard
                    ambiguities={ambiguities}
                    onResolve={handleResolveAmbiguity}
                    onCustomResolve={handleCustomResolve}
                    onRephrase={handleRephraseIntent}
                    isResolving={isResolving}
                  />
                )}

                {/* Stage 4 Content */}
                {currentStage === 4 &&
                  (isGeneratingMetadata ? (
                    <div className="p-8 bg-white rounded-2xl border border-brand-border shadow-soft">
                      <div className="space-y-4">
                        <div className="skeleton h-4 w-40 rounded-md" />
                        <div className="skeleton h-8 w-72 rounded-md" />
                        <div className="skeleton h-64 rounded-xl" />
                      </div>
                    </div>
                  ) : (
                    <ArtifactViewer
                      onProceedToImpact={() => {
                        if (intentId) handleAnalyzeImpact(intentId);
                      }}
                      artifacts={artifacts}
                    />
                  ))}

                {/* Stage 5 Content */}
                {currentStage === 5 && (
                  <div className="space-y-6">
                    {isAnalyzingImpact ? (
                      <div className="p-8 bg-white rounded-2xl border border-brand-border shadow-soft">
                        <div className="space-y-4">
                          <div className="skeleton h-4 w-44 rounded-md" />
                          <div className="skeleton h-8 w-64 rounded-md" />
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="skeleton h-28 rounded-xl" />
                            <div className="skeleton h-28 rounded-xl" />
                            <div className="skeleton h-28 rounded-xl" />
                          </div>
                        </div>
                      </div>
                    ) : impactError ? (
                      <>
                        <ErrorBanner
                          variant="error"
                          title="Impact Analysis Failed"
                          message={impactError}
                          onRetry={intentId ? () => handleAnalyzeImpact(intentId) : undefined}
                          retryLabel="Retry Impact Analysis"
                        />
                        <div className="flex justify-end">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setImpactError(null);
                              setImpactMetrics(null);
                              setCurrentStage(4);
                            }}
                          >
                            Back to Generated Artifacts
                          </Button>
                        </div>
                      </>
                    ) : impactMetrics ? (
                      <>
                        {impactMetrics.analysisComplete === false && (
                          <ErrorBanner
                            variant="warning"
                            title="Impact Analysis Incomplete"
                            message={collectIncompleteReasons(impactMetrics)}
                          />
                        )}
                        <BlastRadiusCard
                          classification={impactMetrics.blastRadiusClassification || 'Low'}
                          summaryNarrative={impactMetrics.summaryNarrative}
                          referencingCount={impactMetrics.dependencyImpact?.referencingComponentsCount || 0}
                          violatingRecordsCount={impactMetrics.dataImpact?.violatingRecordsCount || 0}
                          affectedUsersCount={impactMetrics.permissionImpact?.affectedUsersCount || 0}
                        />
                        <div className="flex justify-end">
                          <Button
                            variant="primary"
                            size="lg"
                            onClick={() => {
                              if (intentId) handleEvaluateGates(intentId);
                            }}
                          >
                            Proceed to Stage 6: Evaluate Refusal Gates
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {/* Stage 6 Content */}
                {currentStage === 6 && (
                  <div className="space-y-6">
                    {isEvaluatingGates || !gateEvaluation ? (
                      <div className="p-8 bg-white rounded-2xl border border-brand-border shadow-soft">
                        <div className="space-y-4">
                          <div className="skeleton h-4 w-40 rounded-md" />
                          <div className="skeleton h-8 w-64 rounded-md" />
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="skeleton h-32 rounded-xl" />
                            <div className="skeleton h-32 rounded-xl" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-brand-border shadow-soft">
                          <div>
                            <h3 className="text-lg font-bold tracking-tight text-brand-dark">Stage 6: Refusal Gate Radar</h3>
                            <p className="text-sm text-slate-500">10 hard governance gates evaluated</p>
                          </div>
                          <Badge variant={gateEvaluation.gateOutcome === 'PASS' ? 'pass' : 'refused'} size="sm" isMono>
                            {refusedGates.length} REFUSED
                          </Badge>
                        </div>

                        {/* Refusal summary — names the gates that refused and
                            why, so the blocking issues are legible at a glance
                            (mirrors the Copilot refusal bubble treatment). */}
                        {refusedGates.length > 0 && (
                          <div className="rounded-xl border border-brand-danger/25 bg-brand-danger/5 p-4 space-y-2.5">
                            <p className="flex items-center gap-2 text-sm font-bold text-brand-danger">
                              <ShieldAlert className="w-4 h-4 shrink-0" />
                              Blocked by {refusedGates.length} refusal gate{refusedGates.length === 1 ? '' : 's'}
                            </p>
                            <ul className="space-y-1.5">
                              {refusedGates.map((g) => (
                                <li key={g.code} className="text-xs text-slate-700 leading-relaxed">
                                  <span className="font-mono font-semibold text-brand-danger">{g.code}</span>
                                  <span className="text-slate-400">: </span>
                                  {g.plainReason}
                                </li>
                              ))}
                            </ul>
                            <p className="text-[11px] text-slate-500 leading-snug">
                              Complete each gate&apos;s unblock path (via the Fix action on its card) or re-run the
                              evaluation after resolving the underlying issue.
                            </p>
                          </div>
                        )}

                        {/* Refused gates first — full cards with reason / evidence / unblock. */}
                        {refusedGates.length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {refusedGates.map((gate) => (
                              <RefusalGateCard
                                key={gate.code}
                                gate={gate}
                                onUnblockClick={(code) => {
                                  const gateToFix = gateEvaluation.results.find((g) => g.code === code);
                                  if (gateToFix) {
                                    setSelectedGateToUnblock(gateToFix);
                                    setIsUnblockModalOpen(true);
                                  }
                                }}
                              />
                            ))}
                          </div>
                        )}

                        {/* Passed gates collapse into one compact row. */}
                        {passedGates.length > 0 && (
                          <div className="flex items-start gap-2 rounded-xl border border-brand-pass/20 bg-brand-pass/5 px-4 py-3 text-xs text-slate-500">
                            <CheckCircle2 className="w-4 h-4 text-brand-pass shrink-0 mt-px" />
                            <span className="leading-snug">
                              {passedGates.length} gate{passedGates.length === 1 ? '' : 's'} passed:{' '}
                              <span className="font-mono">{passedGates.map((g) => g.code).join(', ')}</span>
                            </span>
                          </div>
                        )}

                        <div className="flex justify-end pt-2">
                          <Button
                            variant="primary"
                            size="lg"
                            onClick={() => advanceStage(7)}
                            disabled={gateEvaluation.gateOutcome === 'REFUSED'}
                            rightIcon={<ArrowRight className="w-5 h-5" />}
                          >
                            Run MDAPI Dry-Run
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Stage 7 Content */}
                {currentStage === 7 && (
                  <DryRunPanel
                    onPassDryRun={() => advanceStage(8)}
                    onDryRunComplete={(id) => setDryRunId(id)}
                    intentId={intentId || ''}
                    orgId={selectedOrg?.id || ''}
                    artifacts={artifacts}
                  />
                )}

                {/* Stage 8 Content */}
                {currentStage === 8 && (
                  <RollbackPanel
                    onProceedToDeploy={() => advanceStage(9)}
                    intentId={intentId || ''}
                    orgId={selectedOrg?.id || ''}
                    artifacts={artifacts}
                  />
                )}

                {/* Stage 9 Content */}
                {currentStage === 9 && (
                  <DeployPanel
                    onDeploySuccess={(record) => {
                      setChangeRecord(record);
                      advanceStage(10);
                    }}
                    intentId={intentId || ''}
                    orgId={selectedOrg?.id || ''}
                    orgAlias={selectedOrg?.alias || ''}
                    intent={intentText}
                    businessRationale={rationaleText}
                    artifacts={artifacts}
                    changeSetId={changeSetId}
                    dryRunId={dryRunId}
                    impactBrief={impactMetrics}
                    gateResults={
                      gateEvaluation?.results?.map((g) => ({
                        gateCode: g.code,
                        outcome: g.outcome,
                        plainLanguageReason: g.plainReason
                      })) || null
                    }
                    skillsUsed={artifacts
                      .map((a) => a.skillUsed)
                      .filter((s): s is string => Boolean(s))}
                    initialIsProdMode={prodModeEnabled}
                    initialApprover={prodApprover}
                  />
                )}

                {/* Stage 10 Content */}
                {currentStage === 10 && <ChangeRecordCard record={changeRecord} />}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Package-install popup — once per org per session, dismissible */}
      <PackageInstallModal
        isOpen={showPkgModal}
        onClose={dismissPkgModal}
        health={pkgHealth}
        orgAlias={selectedOrg?.alias || undefined}
        isRechecking={pkgStatus === 'checking'}
        onRecheck={recheckPackage}
      />

      {/* ECA-not-installed popup (OAuth callback): install link + steps
          instead of a dead-end error line. Mirrors the login flow — the
          "Re-check" action routes to the connect screen (/login?step=2) where
          the OAuth round-trip restarts; the login flow's own popup handles
          the retry with the org type preserved. */}
      {redirectNotice?.installUrl && (
        <PackageInstallModal
          isOpen={ecaInstallPopupOpen}
          onClose={() => setEcaInstallPopupOpen(false)}
          health={{
            orgId: 'pending',
            orgType: redirectNotice.orgType || 'production',
            status: 'missing',
            installUrl: redirectNotice.installUrl,
          } satisfies PackageHealth}
          isRechecking={false}
          onRecheck={() => {
            setEcaInstallPopupOpen(false);
            router.push('/login?step=2');
          }}
        />
      )}

      {/* Interactive Refusal Gate Unblock Action Modal */}
      <UnblockActionModal
        key={selectedGateToUnblock?.code ?? 'closed'}
        isOpen={isUnblockModalOpen}
        gate={selectedGateToUnblock}
        onClose={() => setIsUnblockModalOpen(false)}
        onResolve={async (evidence) => {
          if (!intentId) return;
          // Persist a REF-07 production-mode clearance so Stage 9 inherits it.
          if (evidence.productionMode) {
            setProdModeEnabled(true);
            if (evidence.approverIdentity) setProdApprover(evidence.approverIdentity);
          }
          toast.info(
            'Re-evaluating Gates',
            `Running governance evaluation for ${evidence.gateCode}...`
          );
          const evaluation = await handleEvaluateGates(intentId, evidence);
          if (!evaluation) return;
          const gateNow = evaluation.results.find((g) => g.code === evidence.gateCode);
          if (gateNow?.outcome === 'PASS') {
            toast.success(
              'Gate Cleared',
              `${evidence.gateCode} now passes. Governance gates updated.`
            );
          } else {
            toast.info(
              'Gate Still Refused',
              `${evidence.gateCode}: ${
                gateNow?.plainReason ??
                'conditions unchanged. Complete the unblock path and re-run the evaluation.'
              }`
            );
          }
        }}
      />
    </div>
  );
}
