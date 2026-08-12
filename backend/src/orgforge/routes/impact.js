import express from 'express';
import { createAuthMiddleware, tenantIsolation } from '@forge/auth';
const requireAuth = createAuthMiddleware();
import { impactAnalyzer } from '../services/impactAnalyzer.js';
import { getOrgCredentials } from '../services/orgCredentials.js';

const router = express.Router();
router.use(requireAuth, tenantIsolation);

router.post('/:intentId/impact-brief', async (req, res) => {
  try {
    const { intentId } = req.params;
    
    // 1. Fetch intent from Supabase (tables live in the public schema).
    // Tenant-scoped: req.supabaseClient uses the service role key, so RLS is
    // not a backstop — the user filter comes from the verified token.
    const { data: intentData, error: intentError } = await req.supabaseClient
      .from('change_intents')
      .select('*')
      .eq('id', intentId)
      .eq('user_id', req.tenantId)
      .single();

    if (intentError || !intentData) {
      return res.status(404).json({ error: 'Intent not found' });
    }

    // 2+3. Load org credentials (with transparent token refresh)
    const { accessToken, instanceUrl } = await getOrgCredentials(
      req.supabaseClient,
      req.user.id,
      intentData.org_id
    );
    
    // 4. Compute impact
    const impactBrief = await impactAnalyzer.computeImpact(intentData, accessToken, instanceUrl);
    
    res.json(impactBrief);
  } catch (error) {
    console.error('Impact Error:', error);
    // Never leak internal error details (messages, stacks, Salesforce
    // internals) to the client. Known client-class failures (err.status set)
    // keep their message; everything else gets a sanitized generic response.
    const status = error.status || 500;
    if (status >= 500) {
      return res.status(500).json({ error: 'Failed to compute impact' });
    }
    res.status(status).json({ error: error.message || 'Failed to compute impact' });
  }
});

export default router;
