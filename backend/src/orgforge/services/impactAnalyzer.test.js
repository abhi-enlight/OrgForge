/**
 * Unit tests for impactAnalyzer.js (real dependency/integration analysis)
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ImpactAnalyzer } from './impactAnalyzer.js';

/** In-memory fake of the Salesforce client surface the analyzer touches. */
function fakeClient(overrides = {}) {
  return {
    queryToolingAll: overrides.queryToolingAll || (async () => []),
    getRecordCount: overrides.getRecordCount || (async () => ({ count: 0, records: [] }))
  };
}

/** Fake orchestrator that returns a fixed, safe aggregate query. */
function fakeOrchestrator(soql = "SELECT COUNT(Id) FROM Account WHERE Id = '000000000000000AAA'") {
  return { generateImpactSOQL: async () => soql };
}

const INTENT = {
  structured_intent: {
    operation: 'CREATE_CUSTOM_FIELD',
    targetComponent: 'Support_Ticket__c',
    targetField: 'Status__c'
  }
};

describe('ImpactAnalyzer._getDependencyImpact', () => {
  it('queries by component name and counts referencing components', async () => {
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async () => [
          { MetadataComponentType: 'Flow', MetadataComponentName: 'Auto_Close_Flow' },
          { MetadataComponentType: 'ApexClass', MetadataComponentName: 'TicketService' }
        ]
      }),
      fakeOrchestrator()
    );
    const result = await analyzer._getDependencyImpact('tok', 'https://x.salesforce.com', INTENT.structured_intent);
    assert.equal(result.referencingComponentsCount, 2);
    assert.equal(result.components[0].name, 'Auto_Close_Flow');
    assert.equal(result.analysisComplete, true);
  });

  it('falls back to an ID-based lookup when the name filter returns nothing', async () => {
    let calls = 0;
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async (token, url, query) => {
          calls += 1;
          if (query.includes('WHERE RefMetadataComponentName')) return []; // name query → empty
          if (query.includes('FROM MetadataComponent WHERE')) return [{ Id: 'a0X000000000001' }]; // id lookup
          return [{ MetadataComponentType: 'ApexTrigger', MetadataComponentName: 'AccountTrigger' }]; // id-based deps
        }
      }),
      fakeOrchestrator()
    );
    const result = await analyzer._getDependencyImpact('tok', 'https://x.salesforce.com', INTENT.structured_intent);
    assert.equal(calls, 3);
    assert.equal(result.referencingComponentsCount, 1);
    assert.equal(result.analysisComplete, true);
  });

  it('marks the analysis incomplete when every query path fails', async () => {
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async () => {
          throw new Error('INVALID_SESSION_ID');
        }
      }),
      fakeOrchestrator()
    );
    const result = await analyzer._getDependencyImpact('tok', 'https://x.salesforce.com', INTENT.structured_intent);
    assert.equal(result.referencingComponentsCount, 0);
    assert.equal(result.analysisComplete, false);
  });

  it('falls back to the ID lookup even when the name query throws (not just empty)', async () => {
    let nameQueryAttempts = 0;
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async (token, url, query) => {
          if (query.includes('WHERE RefMetadataComponentName')) {
            nameQueryAttempts += 1;
            throw new Error('MALFORMED_QUERY'); // unsupported name filter
          }
          if (query.includes('FROM MetadataComponent WHERE')) {
            return [{ Id: 'a0X000000000002' }];
          }
          return [{ MetadataComponentType: 'Flow', MetadataComponentName: 'Auto_Close_Flow' }];
        }
      }),
      fakeOrchestrator()
    );
    const result = await analyzer._getDependencyImpact('tok', 'https://x.salesforce.com', INTENT.structured_intent);
    assert.equal(nameQueryAttempts, 1);
    assert.equal(result.referencingComponentsCount, 1);
    assert.equal(result.analysisComplete, true, 'ID fallback success is a complete answer');
  });

  it('marks the analysis incomplete for an invalid target component', async () => {
    const analyzer = new ImpactAnalyzer(fakeClient(), fakeOrchestrator());
    const result = await analyzer._getDependencyImpact('tok', 'https://x.salesforce.com', { targetComponent: 'Bad name; DROP' });
    assert.equal(result.referencingComponentsCount, 0);
    assert.equal(result.analysisComplete, false);
  });
});

describe('ImpactAnalyzer._getIntegrationImpact', () => {
  it('reports connected apps and named credentials from the Tooling API', async () => {
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async (token, url, query) => {
          if (query.includes('ConnectedApp')) return [{ DeveloperName: 'MuleSoft_Revenue_Sync' }];
          return [{ DeveloperName: 'External_API_Cred' }];
        }
      }),
      fakeOrchestrator()
    );
    const result = await analyzer._getIntegrationImpact('tok', 'https://x.salesforce.com');
    assert.deepEqual(result.connectedApps, ['MuleSoft_Revenue_Sync']);
    assert.deepEqual(result.namedCredentials, ['External_API_Cred']);
    assert.equal(result.analysisComplete, true);
  });

  it('marks the analysis incomplete when the integration query fails', async () => {
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async () => {
          throw new Error('API_DISABLED_FOR_ORG');
        }
      }),
      fakeOrchestrator()
    );
    const result = await analyzer._getIntegrationImpact('tok', 'https://x.salesforce.com');
    assert.deepEqual(result.connectedApps, []);
    assert.equal(result.analysisComplete, false);
  });
});

describe('ImpactAnalyzer.computeImpact', () => {
  it('aggregates analysisComplete from every dimension', async () => {
    const analyzer = new ImpactAnalyzer(fakeClient(), fakeOrchestrator());
    const brief = await analyzer.computeImpact(INTENT, 'tok', 'https://x.salesforce.com');
    assert.equal(brief.analysisComplete, true);
    assert.equal(brief.blastRadiusClassification, 'Low');
  });

  it('is incomplete when any dimension failed (REF-01 refuses on this)', async () => {
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        queryToolingAll: async () => {
          throw new Error('unavailable');
        }
      }),
      fakeOrchestrator()
    );
    const brief = await analyzer.computeImpact(INTENT, 'tok', 'https://x.salesforce.com');
    assert.equal(brief.analysisComplete, false);
  });

  it('treats INVALID_TYPE data-impact failures as a complete zero-record answer', async () => {
    const analyzer = new ImpactAnalyzer(
      fakeClient({
        getRecordCount: async () => {
          const err = new Error("sObject type 'Support_Ticket__c' is not supported");
          err.response = { data: [{ errorCode: 'INVALID_TYPE', message: 'sObject type not supported' }] };
          throw err;
        }
      }),
      fakeOrchestrator()
    );
    const brief = await analyzer.computeImpact(INTENT, 'tok', 'https://x.salesforce.com');
    assert.equal(brief.dataImpact.violatingRecordsCount, 0);
    assert.equal(brief.analysisComplete, true);
  });

  it('classifies High blast radius when >10 referencing components', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      MetadataComponentType: 'Flow',
      MetadataComponentName: `Flow_${i}`
    }));
    const analyzer = new ImpactAnalyzer(
      fakeClient({ queryToolingAll: async () => many }),
      fakeOrchestrator()
    );
    const brief = await analyzer.computeImpact(INTENT, 'tok', 'https://x.salesforce.com');
    assert.equal(brief.blastRadiusClassification, 'High');
    assert.equal(brief.dependencyImpact.referencingComponentsCount, 12);
  });
});
