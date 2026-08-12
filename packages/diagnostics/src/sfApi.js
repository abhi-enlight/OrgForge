/**
 * Minimal Salesforce REST/Tooling API client used by the diagnostics checks.
 *
 * Direct port of the axios calls in Agentforge's orgConfigService.js, rewritten
 * on global fetch (Node 20+). Injectable so tests can stub every call without
 * network access — pass `{ sfApi }` to runPreFlightCheck.
 */
export const SF_API_VERSION = 'v65.0';

export class SfApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SfApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseJsonOrThrow(res, label) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new SfApiError(`${label} failed (${res.status})`, { status: res.status, body });
    throw err;
  }
  return body;
}

function buildUrl(instanceUrl, path) {
  // path is either a full suffix ("/services/data/...") or an absolute API path
  return `${instanceUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export const sfApi = {
  /** REST SOQL query (non-tooling) — returns records[] */
  async query(token, instanceUrl, soql) {
    const url = buildUrl(
      instanceUrl,
      `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`
    );
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await parseJsonOrThrow(res, 'SOQL query');
    return body?.records || [];
  },

  /** Tooling API SOQL query — returns records[] */
  async toolingQuery(token, instanceUrl, soql) {
    const url = buildUrl(
      instanceUrl,
      `/services/data/${SF_API_VERSION}/tooling/query?q=${encodeURIComponent(soql)}`
    );
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await parseJsonOrThrow(res, 'Tooling query');
    return body?.records || [];
  },

  /** PATCH an sObject (e.g. reactivate a user) */
  async patch(token, instanceUrl, sobjectPath, body) {
    const url = buildUrl(instanceUrl, `/services/data/${SF_API_VERSION}/sobjects/${sobjectPath}`);
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 204) {
      await parseJsonOrThrow(res, 'PATCH');
    }
    return { ok: true };
  },

  /** POST to create an sObject (returns { id }) */
  async post(token, instanceUrl, sobjectName, body) {
    const url = buildUrl(instanceUrl, `/services/data/${SF_API_VERSION}/sobjects/${sobjectName}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = await parseJsonOrThrow(res, 'POST');
    return parsed || { id: null };
  },

  /** OAuth userinfo — returns { user_id, ... } */
  async userinfo(token, instanceUrl) {
    const url = buildUrl(instanceUrl, '/services/oauth2/userinfo');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    return parseJsonOrThrow(res, 'userinfo');
  },
};

/** Builds a stub sfApi for tests: overrides any subset of methods. */
export function createStubSfApi(overrides = {}) {
  return { ...sfApi, ...overrides };
}
