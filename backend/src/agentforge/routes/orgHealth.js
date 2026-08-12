'use strict';

import express from 'express'
const router = express.Router();
import { runPreFlightCheck } from '../services/orgConfigService.js'
import { getCredentialsFromToken } from './auth.js'

// Resolves credentials via JWT bearer token or session
router.get('/health-check', async (req, res) => {
  try {
    const creds = await getCredentialsFromToken(req);
    if (!creds || !creds.accessToken || !creds.instanceUrl) {
      return res.status(401).json({ error: 'Unauthorized: No active Salesforce session found.' });
    }

    const healthStatus = await runPreFlightCheck(creds.accessToken, creds.instanceUrl);
    res.json(healthStatus);
  } catch (err) {
    console.error('[orgHealth] Error running health check:', err);
    res.status(500).json({ error: 'Internal server error during health check.' });
  }
});

// Returns the authenticated user's instance URL for generating Setup links
router.get('/instance', async (req, res) => {
  try {
    const creds = await getCredentialsFromToken(req);
    if (!creds || !creds.instanceUrl) {
      return res.status(401).json({ error: 'Unauthorized: No active Salesforce session found.' });
    }
    res.json({ instanceUrl: creds.instanceUrl });
  } catch (err) {
    console.error('[orgHealth] Error getting instance URL:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;

