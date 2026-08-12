import crypto from 'crypto';
import { supabaseAdmin } from './supabaseClient.js';
import { metadataTransport } from './metadataTransport.js';

const ROLLBACK_BUCKET = 'orgforge-rollbacks';

/**
 * Manages rollback bundle storage (Supabase Storage) and execution (Metadata API).
 */
class RollbackService {

  /**
   * Ensures the storage bucket exists before uploading.
   */
  async ensureBucket() {
    try {
      const { data: bucket, error: getErr } = await supabaseAdmin.storage.getBucket(ROLLBACK_BUCKET);
      if (getErr || !bucket) {
        await supabaseAdmin.storage.createBucket(ROLLBACK_BUCKET, {
          public: false,
          fileSizeLimit: 52428800,
          allowedMimeTypes: ['application/zip'],
        });
      }
    } catch (err) {
      console.warn(`[RollbackService] ensureBucket note: ${err.message}`);
    }
  }

  /**
   * Called after a successful retrieve-backup.
   * Uploads the ZIP to Supabase Storage and returns a storage reference path.
   *
   * @param {string} intentId      - change intent UUID (used for naming)
   * @param {string} zipBase64     - base64-encoded ZIP from Salesforce retrieve
   * @returns {Promise<{storagePath: string, sizeKB: string, hash: string}>}
   */
  async captureRollbackBundle(intentId, zipBase64) {
    if (!zipBase64) {
      throw new Error('No zip payload received for rollback bundle');
    }

    const zipBuffer = Buffer.from(zipBase64, 'base64');
    const hash = crypto.createHash('sha256').update(zipBuffer).digest('hex');
    const sizeKB = (zipBuffer.length / 1024).toFixed(2);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const storagePath = `rollbacks/${intentId}/${timestamp}.zip`;

    let { error } = await supabaseAdmin.storage
      .from(ROLLBACK_BUCKET)
      .upload(storagePath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (error && (error.message?.includes('not found') || error.message?.includes('bucket') || error.status === 404)) {
      console.warn(`[RollbackService] Storage upload error: '${error.message}'. Ensuring bucket '${ROLLBACK_BUCKET}' exists and retrying...`);
      await this.ensureBucket();
      const retry = await supabaseAdmin.storage
        .from(ROLLBACK_BUCKET)
        .upload(storagePath, zipBuffer, {
          contentType: 'application/zip',
          upsert: true,
        });
      error = retry.error;
    }

    if (error) {
      // Surface the failure loudly — a silent rollback-bundle loss means we
      // cannot safely roll back later.
      throw new Error(`Failed to upload rollback bundle to Supabase Storage: ${error.message}`);
    }

    return { storagePath, sizeKB, hash };
  }

  /**
   * Executes a rollback by downloading the saved bundle from Supabase Storage
   * and deploying it back to the org via the Metadata API.
   *
   * @param {string} changeRecordId       - UUID of the change record being rolled back
   * @param {string|null} storagePath     - Supabase Storage path from rollback_bundle_ref
   * @param {string} accessToken          - Salesforce access token for the target org
   * @param {string} instanceUrl          - Salesforce instance URL
   * @param {string} orgType              - 'production' | 'sandbox' | 'scratch'
   * @returns {Promise<{status: string, deploymentId: string}>}
   */
  async executeRollback(changeRecordId, storagePath, accessToken, instanceUrl, orgType) {
    if (!storagePath) {
      const err = new Error(
        `No rollback bundle found for change record ${changeRecordId}. ` +
        'Ensure a backup was captured before deployment.'
      );
      err.status = 409;
      throw err;
    }

    // 1. Download the rollback ZIP from Supabase Storage
    const { data: blobData, error: downloadError } = await supabaseAdmin.storage
      .from(ROLLBACK_BUCKET)
      .download(storagePath);

    if (downloadError || !blobData) {
      throw new Error(`Failed to download rollback bundle from storage: ${downloadError?.message}`);
    }

    // Convert Blob → ArrayBuffer → Buffer (works in Node 18+)
    const arrayBuffer = await blobData.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);

    // 2. Deploy the rollback ZIP to the org
    const { deploymentId } = await metadataTransport.deployFinal(
      accessToken,
      instanceUrl,
      zipBuffer,
      orgType === 'production' ? 'RunLocalTests' : 'NoTestRun'
    );

    return { status: 'Queued', deploymentId };
  }
}

export const rollbackService = new RollbackService();
