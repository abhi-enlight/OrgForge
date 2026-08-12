import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { githubService } from './githubService.js';
import { supabaseAdmin } from './supabaseClient.js';

export class ChangeRecordService {
  /**
   * @param {object} [extras]  evidence required by PRD Hard Rule 1:
   *   { dryRunId, impactBrief, gateResults, skillsUsed, artifacts }
   *   Artifacts are compacted (no raw XML/Apex content) so the audit row stays
   *   small while still naming every shipped component + skill.
   */
  assembleChangeRecord(changeSetId, approverIdentity, deploymentId, gitCommitHash, intent, businessRationale, userId, orgId, changeIntentId = null, extras = {}) {
    return {
      id: `CR-${Date.now()}`,
      changeSetId,
      approverIdentity,
      deploymentId,
      gitCommitHash,
      intent: intent || 'Unknown Intent',
      businessRationale: businessRationale || 'No rationale provided',
      userId,
      orgId,
      changeIntentId,
      dryRunId: extras.dryRunId || null,
      impactBrief: extras.impactBrief || null,
      gateResults: extras.gateResults || null,
      skillsUsed: Array.isArray(extras.skillsUsed) ? extras.skillsUsed : [],
      artifacts: Array.isArray(extras.artifacts)
        ? extras.artifacts.map(a => ({
            filePath: a.filePath,
            metadataType: a.metadataType,
            fullName: a.fullName || null,
            skillUsed: a.skillUsed || null
          }))
        : [],
      timestamp: new Date().toISOString()
    };
  }

  /**
   * HMAC-SHA256 sign the full record payload. FAILS LOUDLY when the secret is
   * missing so a tamper-evident audit record is never silently unsigned.
   */
  sign(changeRecord, secret) {
    if (!secret) {
      throw new Error('HMAC_SECRET is not configured; refusing to sign audit records.');
    }
    const payloadString = JSON.stringify(changeRecord);
    const signatureHash = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
    return { ...changeRecord, signatureHash };
  }

  /**
   * Persists a signed change record to Supabase. FAILS LOUDLY: any database
   * error is thrown so an audit record can never silently disappear.
   */
  async persist(changeRecord) {
    const { error } = await supabaseAdmin.from('change_records').insert({
      user_id: changeRecord.userId,
      org_id: changeRecord.orgId,
      change_intent_id: changeRecord.changeIntentId || null,
      deployment_id: changeRecord.deploymentId,
      approver_identity: changeRecord.approverIdentity,
      git_commit_hash: changeRecord.gitCommitHash || null,
      signature_hash: changeRecord.signatureHash,
      intent: changeRecord.intent,
      business_rationale: changeRecord.businessRationale,
      status: 'DEPLOYED',
      skills_used: changeRecord.skillsUsed || [],
      impact_brief: changeRecord.impactBrief || {},
      gate_results: changeRecord.gateResults || [],
      dry_run_id: changeRecord.dryRunId || null,
      artifacts: changeRecord.artifacts || []
    });

    if (error) {
      throw new Error(`Failed to persist change record: ${error.message}`);
    }
  }

  /**
   * Full audit-record pipeline: export to git first (captures the real commit
   * sha), then sign and persist. Throws on persistence failure.
   *
   * The GitHub destination is resolved per-user from github_connections (the
   * audit repo the operator chose at connect time). When none is configured,
   * exportToGit falls back to a local file write and returns null.
   */
  async exportAndPersist(changeRecord, secret) {
    const signed = this.sign(changeRecord, secret);

    let gitHash = null;
    if (changeRecord.userId) {
      try {
        const { data: gh } = await supabaseAdmin
          .from('github_connections')
          .select('installation_id, repo_owner, repo_name')
          .eq('user_id', changeRecord.userId)
          .maybeSingle();
        if (gh) {
          gitHash = await this.exportToGit(
            signed,
            Number(gh.installation_id),
            gh.repo_owner,
            gh.repo_name
          );
        } else {
          console.log(`No GitHub connection for user ${changeRecord.userId}; falling back to local write.`);
          gitHash = await this.exportToGit(signed, null, null, null);
        }
      } catch (err) {
        console.error('GitHub destination lookup failed; falling back to local write:', err.message);
        gitHash = await this.exportToGit(signed, null, null, null);
      }
    } else {
      gitHash = await this.exportToGit(signed, null, null, null);
    }

    const finalRecord = { ...signed, gitCommitHash: gitHash || signed.gitCommitHash || null };
    await this.persist(finalRecord);
    return finalRecord;
  }

  async exportToGit(changeRecord, installationId, repoOwner, repoName) {
    const fileName = `${changeRecord.id}.md`;
    const content = `# OrgForge Change Record: ${changeRecord.id}

## Metadata
- **Timestamp:** ${changeRecord.timestamp}
- **Change Set ID:** ${changeRecord.changeSetId}
- **Deployment ID:** ${changeRecord.deploymentId}
- **Approver Identity:** ${changeRecord.approverIdentity}
- **Git Commit Hash:** ${changeRecord.gitCommitHash || 'N/A'}

## Business Context
**Intent:**
${changeRecord.intent}

**Business Rationale:**
${changeRecord.businessRationale}

## Governance Evidence
- **Blast Radius:** ${changeRecord.impactBrief?.blastRadiusClassification || 'N/A'}
- **Referencing Components:** ${changeRecord.impactBrief?.dependencyImpact?.referencingComponentsCount ?? 'N/A'}
- **Violating Records:** ${changeRecord.impactBrief?.dataImpact?.violatingRecordsCount ?? 'N/A'}
- **Gate Results:** ${Array.isArray(changeRecord.gateResults) && changeRecord.gateResults.length > 0 ? `${changeRecord.gateResults.filter(g => g.outcome === 'REFUSED').length} refused / ${changeRecord.gateResults.length} evaluated` : 'N/A'}
- **Skills Used:** ${Array.isArray(changeRecord.skillsUsed) && changeRecord.skillsUsed.length > 0 ? changeRecord.skillsUsed.join(', ') : 'N/A'}
- **Dry-Run ID:** ${changeRecord.dryRunId || 'N/A'}

## Tamper-Evident Verification
**HMAC SHA-256 Signature:**
\`${changeRecord.signatureHash}\`
`;

    // If GitHub App is configured and repo context is available, push it
    if (installationId && repoOwner && repoName) {
      try {
        const commitSha = await githubService.pushChangeRecord(
          installationId,
          repoOwner,
          repoName,
          fileName,
          content
        );
        return commitSha;
      } catch (err) {
        console.error('GitHub push failed, fallback to local write', err);
      }
    }

    // Fallback local write for dev. Return null (no fabricated hash) so the
    // tamper-evident audit log never records a fake-looking git commit SHA.
    const changesDir = path.resolve(process.cwd(), '..', 'orgforge-changes');
    if (!fs.existsSync(changesDir)) {
      fs.mkdirSync(changesDir, { recursive: true });
    }

    fs.writeFileSync(path.join(changesDir, fileName), content);
    console.log('GitHub App not configured; change record written locally (no commit hash).');
    return null;
  }
}

export const changeRecordService = new ChangeRecordService();
