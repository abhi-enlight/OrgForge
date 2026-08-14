import express from 'express';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
const requireAuth = createAuthMiddleware();

const router = express.Router();
router.use(requireAuth, tenantIsolation);

router.get('/', async (req, res) => {
  try {
    const { orgId, limit = 50, offset = 0 } = req.query;
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let query = req.supabaseClient
      .from('change_records')
      .select('*', { count: 'exact' })
      .eq('user_id', req.tenantId)
      .order('created_at', { ascending: false })
      .range(parsedOffset, parsedOffset + parsedLimit - 1);

    if (orgId) {
      query = query.eq('org_id', orgId);
    }

    const { data, count, error } = await query;

    if (error) throw error;

    const mappedData = (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      kind: row.kind || 'org_change',
      agentName: row.agent_name || null,
      agentSnapshot: row.agent_snapshot || null,
      intentText: row.intent,
      businessRationale: row.business_rationale,
      approverIdentity: row.approver_identity,
      // Blast radius comes from the impact brief stored in the record (there
      // is no dedicated column in the live schema).
      blastRadius: row.blast_radius || row.impact_brief?.blastRadiusClassification || null,
      status: row.status,
      signatureHash: row.signature_hash,
      deploymentId: row.deployment_id,
      gitCommitHash: row.git_commit_hash,
      dryRunId: row.dry_run_id,
      impactBrief: row.impact_brief,
      gateResults: row.gate_results,
      skillsUsed: row.skills_used,
      createdAt: row.created_at,
    }));

    res.json({ records: mappedData, total: count || 0 });
  } catch (err) {
    console.error('Failed to fetch change records:', err.message);
    res.status(500).json({ error: 'Failed to fetch change records' });
  }
});

export default router;
