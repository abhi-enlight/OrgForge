import axios from 'axios';
import crypto from 'crypto';

/**
 * Builds the deploy() SOAP envelope. singlePackage is always emitted as true
 * unless explicitly overridden: OrgForge always ships a single-package zip
 * (package.xml + components at the zip root). When singlePackage is omitted it
 * defaults to false, in which case Salesforce treats every top-level directory
 * as its own package and looks for <dir>/package.xml — the root manifest is
 * ignored, producing "No package.xml found" against the first directory and 0
 * components deployed. That is exactly the signature observed on the Stage 7
 * MDAPI dry-run.
 */
export function buildDeploySoapEnvelope(accessToken, zipBase64, deployOptions = {}) {
  const checkOnly = deployOptions.checkOnly ? 'true' : 'false';
  const testLevel = deployOptions.testLevel || 'NoTestRun';
  const singlePackage = deployOptions.singlePackage === false ? 'false' : 'true';

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${accessToken}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:deploy>
      <met:ZipFile>${zipBase64}</met:ZipFile>
      <met:DeployOptions>
        <met:checkOnly>${checkOnly}</met:checkOnly>
        <met:singlePackage>${singlePackage}</met:singlePackage>
        <met:testLevel>${testLevel}</met:testLevel>
      </met:DeployOptions>
    </met:deploy>
  </soapenv:Body>
</soapenv:Envelope>`;
}

class SalesforceClient {
  constructor() {
    this.clientId = process.env.SALESFORCE_CLIENT_ID;
    this.clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
    this.redirectUri = process.env.SALESFORCE_REDIRECT_URI;
  }

  /**
   * Resolve the OAuth base URL for the org type.
   *
   * - production → login.salesforce.com
   * - sandbox   → test.salesforce.com
   * - scratch   → the org's OWN instance URL (e.g. https://xxx-dev-ed.scratch.my.salesforce.com).
   *   Scratch orgs do not authenticate on login.salesforce.com; they only
   *   accept OAuth on their instance domain, so the caller MUST pass
   *   `instanceUrl` (the value stored in org_connections) for scratch orgs.
   */
  resolveBaseUrl(orgType = 'production', instanceUrl) {
    if (orgType === 'sandbox') return 'https://test.salesforce.com';
    if (orgType === 'scratch') {
      if (!instanceUrl) {
        const err = new Error('Scratch orgs require an instanceUrl for OAuth');
        err.status = 400;
        throw err;
      }
      return instanceUrl.replace(/\/$/, '');
    }
    return 'https://login.salesforce.com';
  }

  /**
   * Generate PKCE auth URL
   */
  generateAuthUrl(orgType = 'production', instanceUrl) {
    const baseUrl = this.resolveBaseUrl(orgType, instanceUrl);

    // PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = `${baseUrl}/services/oauth2/authorize?response_type=code` +
      `&client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&state=${state}` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`;

    return { authUrl, state, codeVerifier };
  }

  /**
   * Exchange code for tokens
   */
  async exchangeCodeForTokens(code, codeVerifier, orgType = 'production', instanceUrl) {
    const baseUrl = this.resolveBaseUrl(orgType, instanceUrl);

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      code_verifier: codeVerifier
    });

    const response = await axios.post(`${baseUrl}/services/oauth2/token`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // The `id` field is the userinfo URL: https://login.salesforce.com/id/<orgId>/<userId>
    // The org id is the second-to-last path segment, NOT the user id (last segment).
    const idParts = (response.data.id || '').split('/');
    const orgId = idParts.length >= 2 ? idParts[idParts.length - 2] : null;

    const expiresIn = Number(response.data.expires_in) || 7200;

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      instanceUrl: response.data.instance_url,
      orgId,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  /**
   * Exchange a refresh token for a fresh access token.
   */
  async refreshAccessToken(refreshToken, orgType = 'production', instanceUrl) {
    const baseUrl = this.resolveBaseUrl(orgType, instanceUrl);

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri
    });

    const response = await axios.post(`${baseUrl}/services/oauth2/token`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const expiresIn = Number(response.data.expires_in) || 7200;

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken,
      instanceUrl: response.data.instance_url,
      expiresAt: Date.now() + expiresIn * 1000
    };
  }

  /**
   * Fetch list of standard and custom objects (REST API)
   */
  async fetchOrgSchema(accessToken, instanceUrl, apiVersion = '61.0') {
    const url = `${instanceUrl}/services/data/v${apiVersion}/sobjects`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data.sobjects;
  }

  /**
   * Describe Metadata to get all metadata types
   */
  async describeMetadata(accessToken, instanceUrl, apiVersion = '61.0') {
    const url = `${instanceUrl}/services/data/v${apiVersion}/metadata`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  }

  /**
   * Tooling API generic query
   */
  async queryTooling(accessToken, instanceUrl, query, apiVersion = '61.0') {
    const url = `${instanceUrl}/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data.records;
  }

  /**
   * Tooling API query with pagination — follows nextRecordsUrl until every
   * record is returned (or a hard page cap is hit, so an unexpectedly huge
   * result set cannot stall the job). Used for dependency-map and
   * integration-impact queries that can exceed the 2000-record page limit.
   */
  async queryToolingAll(accessToken, instanceUrl, query, apiVersion = '61.0', maxPages = 50) {
    const records = [];
    let url = `${instanceUrl}/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(query)}`;
    let pages = 0;
    while (url && pages < maxPages) {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const batch = response.data?.records || [];
      records.push(...batch);
      url = response.data?.nextRecordsUrl ? `${instanceUrl}${response.data.nextRecordsUrl}` : null;
      pages += 1;
    }
    return records;
  }

  /**
   * Tooling API query for metadata dependency
   */
  async queryMetadataComponentDependency(accessToken, instanceUrl, componentId, apiVersion = '61.0') {
    const query = `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = '${componentId}'`;
    const url = `${instanceUrl}/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(query)}`;
    
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data.records;
  }

  /**
   * Checks whether the OrgForge packaged ECA is installed in the target org.
   *
   * Single round-trip: InstalledSubscriberPackage is exposed by the Tooling
   * API, so one query by the known 033 SubscriberPackageId answers "is any
   * version of the OrgForge Connector package installed?". A secondary REST
   * query confirms the ECA itself is present (DeveloperName must match).
   *
   * Returns a tri-state so the caller can distinguish "genuinely missing"
   * from "cannot tell" (e.g. expired token):
   *   { status: 'installed' }
   *   { status: 'missing'  }
   *   { status: 'error', reason }
   */
  async checkPackageInstalled(accessToken, instanceUrl, { packageId, ecaName }, apiVersion = '61.0') {
    try {
      // Tooling API: does ANY version of our package show as installed?
      // (reuses the existing queryTooling helper). This is the AUTHORITATIVE
      // signal — only its failure yields 'error' (e.g. INVALID_SESSION_ID),
      // which the UI renders as "reconnect".
      const records = await this.queryTooling(
        accessToken,
        instanceUrl,
        `SELECT Id FROM InstalledSubscriberPackage WHERE SubscriberPackageId = '${packageId}' LIMIT 1`,
        apiVersion
      );
      const packageFound = Array.isArray(records) && records.length > 0;

      // ECA presence is a BEST-EFFORT signal, not part of the verdict:
      // ExternalClientApplication is a setup/metadata entity that is not
      // guaranteed to be queryable through every API surface, so a failure
      // here must never flip an otherwise-verified result into 'error'.
      // IMPORTANT: it must be queried via the STANDARD REST query endpoint —
      // ExternalClientApplication is NOT a Tooling object, so a Tooling query
      // returns 400 INVALID_TYPE "sObject type not supported" in every real
      // org and the fallback could never match. Swallow per-org
      // incompatibilities with a warning.
      // undefined = "unchecked", not "absent": a successful query sets a
      // boolean, so callers can tell "ECA genuinely missing" from "couldn't
      // verify" instead of a misleading false.
      let ecaPresent;
      try {
        const url = `${instanceUrl}/services/data/v${apiVersion}/query?q=${encodeURIComponent(
          `SELECT Id, DeveloperName FROM ExternalClientApplication WHERE DeveloperName = '${ecaName}' LIMIT 1`
        )}`;
        const ecaResponse = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const ecaRecords = ecaResponse.data?.records || [];
        ecaPresent = Array.isArray(ecaRecords) && ecaRecords.length > 0;
      } catch (ecaErr) {
        console.warn('[salesforceClient] ECA presence check unavailable (non-fatal):', ecaErr.message);
      }

      // Installed = managed package row present OR the External Client App
      // exists. The ECA is the signal that actually matters — it is the OAuth
      // client Forge authenticates through, and it exists in exactly the orgs
      // where the connector was set up. This closes the false "missing"
      // verdicts that happen when (a) the connector is installed as an
      // UNMANAGED package (never listed in InstalledSubscriberPackage) or
      // (b) the pinned SubscriberPackageId/version ids don't match the version
      // the admin actually installed. A successful query that finds neither is
      // a genuine 'missing'.
      const installed = packageFound || ecaPresent === true;

      return installed
        ? { status: 'installed', ecaPresent }
        : { status: 'missing', ecaPresent };
    } catch (err) {
      console.error('[salesforceClient] checkPackageInstalled failed:', err.message);
      return { status: 'error', reason: err.message };
    }
  }

  async getRecordCount(accessToken, instanceUrl, soqlQuery, apiVersion = '61.0') {
    const url = `${instanceUrl}/services/data/v${apiVersion}/query?q=${encodeURIComponent(soqlQuery)}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const firstRec = response.data.records && response.data.records[0];
    let count = response.data.totalSize;

    if (firstRec && typeof firstRec.expr0 === 'number') {
      count = firstRec.expr0;
    } else if (firstRec && typeof firstRec.expr0 !== 'undefined' && !isNaN(Number(firstRec.expr0))) {
      count = Number(firstRec.expr0);
    }

    return {
      count,
      records: response.data.records.slice(0, 5)
    };
  }

  /**
   * Deploy metadata via SOAP API
   */
  async deployMetadata(accessToken, instanceUrl, zipBuffer, deployOptions = {}) {
    const url = `${instanceUrl}/services/Soap/m/61.0`;
    const soapBody = buildDeploySoapEnvelope(accessToken, zipBuffer.toString('base64'), deployOptions);

    const response = await axios.post(url, soapBody, {
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'deploy'
      }
    });

    console.log(`[deployMetadata] raw response (first 1200 chars): ${String(response.data).slice(0, 1200)}`);

    // Parse the SOAP response for asyncProcessId (namespace-tolerant)
    const idMatch = response.data.match(/<[A-Za-z0-9_]*:?id>([^<]+)<\/[A-Za-z0-9_]*:?id>/);
    if (!idMatch) {
      // Surface the SOAP fault (e.g. INVALID_SESSION_ID, INVALID_XML) so the
      // operator can act on the actual rejection instead of a generic error.
      const fault =
        response.data.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1] ||
        response.data.match(/<Problem>([\s\S]*?)<\/Problem>/i)?.[1] ||
        '';
      const err = new Error(
        `Failed to get deployment ID from SOAP response${fault.trim() ? `: ${fault.trim()}` : ''}`
      );
      // Salesforce rejected the submitted package — a client-side validation
      // failure, not a server fault. Keeping status < 500 lets the route
      // surface this message to the operator.
      err.status = 400;
      throw err;
    }
    return idMatch[1];
  }

  /**
   * Check deploy status via SOAP API
   */
  async checkDeployStatus(accessToken, instanceUrl, deploymentId) {
    const url = `${instanceUrl}/services/Soap/m/61.0`;
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${accessToken}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:checkDeployStatus>
      <met:asyncProcessId>${deploymentId}</met:asyncProcessId>
      <met:includeDetails>true</met:includeDetails>
    </met:checkDeployStatus>
  </soapenv:Body>
</soapenv:Envelope>`;

    const response = await axios.post(url, soapBody, {
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'checkDeployStatus'
      }
    });

    console.log(`[checkDeployStatus ${deploymentId}] raw response (first 4000 chars): ${String(response.data).slice(0, 4000)}`);

    // Namespace/attribute-tolerant extraction: elements may carry a prefix
    // (e.g. <met:status>) or attributes (<status xsi:nil="true"/>).
    const getTag = (xml, tag) => {
      const match = xml.match(new RegExp(`<[A-Za-z0-9_]*:?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\/[A-Za-z0-9_]*:?${tag}>`));
      return match ? match[1].trim() || null : null;
    };

    const status = getTag(response.data, 'status');
    const stateDetail = getTag(response.data, 'stateDetail');
    const done = getTag(response.data, 'done') === 'true';
    const numberComponentsDeployed = parseInt(getTag(response.data, 'numberComponentsDeployed') || '0', 10);
    const numberComponentErrors = parseInt(getTag(response.data, 'numberComponentErrors') || '0', 10);

    // Extract componentFailures
    const failures = [];
    const failureRegex = /<[A-Za-z0-9_]*:?componentFailures>([\s\S]*?)<\/[A-Za-z0-9_]*:?componentFailures>/g;
    let match;
    while ((match = failureRegex.exec(response.data)) !== null) {
      const failBlock = match[1];
      failures.push({
        fileName: getTag(failBlock, 'fileName'),
        problem: getTag(failBlock, 'problem'),
        problemType: getTag(failBlock, 'problemType'),
        componentType: getTag(failBlock, 'componentType'),
        fullName: getTag(failBlock, 'fullName'),
        lineNumber: getTag(failBlock, 'lineNumber'),
        columnNumber: getTag(failBlock, 'columnNumber')
      });
    }

    console.log(`[checkDeployStatus ${deploymentId}] parsed:`, JSON.stringify({
      done, status, stateDetail, numberComponentsDeployed, numberComponentErrors, failures
    }));

    return {
      done,
      status,
      stateDetail,
      numberComponentsDeployed,
      numberComponentErrors,
      componentFailures: failures
    };
  }

  /**
   * Retrieve metadata via SOAP API
   */
  async retrieveMetadata(accessToken, instanceUrl, unpackagedTypesXml) {
    const url = `${instanceUrl}/services/Soap/m/61.0`;
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${accessToken}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:retrieve>
      <met:retrieveRequest>
        <met:apiVersion>61.0</met:apiVersion>
        <met:unpackaged>
${unpackagedTypesXml}
        </met:unpackaged>
      </met:retrieveRequest>
    </met:retrieve>
  </soapenv:Body>
</soapenv:Envelope>`;

    const response = await axios.post(url, soapBody, {
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'retrieve'
      }
    });

    const match = response.data.match(/<id>([^<]+)<\/id>/);
    if (!match) {
      const fault = response.data.match(/<faultstring>([\s\S]*?)<\/faultstring>/i)?.[1] || '';
      const err = new Error(
        `Failed to get asyncProcessId from retrieve response${fault.trim() ? `: ${fault.trim()}` : ''}`
      );
      err.status = 400;
      throw err;
    }
    return match[1];
  }

  /**
   * Check retrieve status via SOAP API
   */
  async checkRetrieveStatus(accessToken, instanceUrl, asyncProcessId) {
    const url = `${instanceUrl}/services/Soap/m/61.0`;
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>${accessToken}</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:checkRetrieveStatus>
      <met:asyncProcessId>${asyncProcessId}</met:asyncProcessId>
      <met:includeZip>true</met:includeZip>
    </met:checkRetrieveStatus>
  </soapenv:Body>
</soapenv:Envelope>`;

    const response = await axios.post(url, soapBody, {
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'checkRetrieveStatus'
      }
    });

    const getTag = (xml, tag) => {
      const match = xml.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`));
      return match ? match[1] : null;
    };

    return {
      status: getTag(response.data, 'status'),
      zipFile: getTag(response.data, 'zipFile'),
      errorMessage: getTag(response.data, 'errorMessage')
    };
  }
}

export const salesforceClient = new SalesforceClient();
