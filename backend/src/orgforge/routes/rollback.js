import express from 'express';
import { z } from 'zod';
import { createAuthMiddleware, tenantIsolation } from '@orgforge/auth';
const requireAuth = createAuthMiddleware();
import { rollbackService } from '../services/rollbackService.js';
import { getOrgCredentials } from '@orgforge/org-connections';

const router = express.Router();
router.use(requireAuth, tenantIsolation);

const rollbackSchema = z.object({
  changeRecordId: z.string().uuid(),
  orgId: z.string().min(1)
});

router.post('/', async (req, res) => {
  try {
    const { changeRecordId, orgId } = rollbackSchema.parse(req.body);

    // Verify the change record belongs to this tenant
    const { data: record, error: fetchError } = await req.supabaseClient
      .from('change_records')
      .select('id, org_id, rollback_bundle_ref')
      .eq('id', changeRecordId)
      .eq('user_id', req.tenantId)
      .single();

    if (fetchError || !record) {
      return res.status(404).json({ error: 'Change record not found' });
    }

    // Load org credentials for the rollback deployment
    const { accessToken, instanceUrl, orgType } = await getOrgCredentials(
      req.supabaseClient,
      req.user.id,
      orgId
    );

    const result = await rollbackService.executeRollback(
      changeRecordId,
      record.rollback_bundle_ref,
      accessToken,
      instanceUrl,
      orgType
    );

    res.json({ status: result.status, deploymentId: result.deploymentId });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', issues: err.errors });
    }
    // getOrgCredentials throws 401 when the stored refresh token is dead
    // (EC-10) — discriminate so the frontend shows "Reconnect Salesforce"
    // instead of treating the 401 as session expiry and signing the user out.
    if (err.status === 401) {
      return res.status(401).json({
        error: 'Reconnect this org. Salesforce access could not be refreshed',
        code: 'ORG_RECONNECT_REQUIRED',
      });
    }
    console.error('Rollback error:', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: status >= 500 ? 'Rollback failed' : err.message });
  }
});

export default router;
