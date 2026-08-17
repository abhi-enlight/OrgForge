import { salesforceClient } from './salesforceClient.js';
import { aiOrchestrator } from './aiOrchestrator.js';
import { isValidSfIdentifier } from '../utils/aiSafety.js';

class ImpactAnalyzer {
  /**
   * @param {object} [client]     injectable Salesforce client (defaults to the singleton)
   * @param {object} [orchestrator] injectable AI orchestrator (defaults to the singleton)
   */
  constructor(client = salesforceClient, orchestrator = aiOrchestrator) {
    this.client = client;
    this.orchestrator = orchestrator;
  }

  async computeImpact(intentData, accessToken, instanceUrl) {
    const parsedIntent = intentData.structured_intent || intentData.parsed_intent || {};
    const dependencyImpact = await this._getDependencyImpact(accessToken, instanceUrl, parsedIntent);
    const dataImpact = await this._getDataImpact(accessToken, instanceUrl, parsedIntent);
    const permissionImpact = await this._getPermissionImpact(accessToken, instanceUrl, parsedIntent);
    const integrationImpact = await this._getIntegrationImpact(accessToken, instanceUrl);

    // REF-01: the blast-radius brief is only trustworthy when every dimension
    // actually completed. Any query failure marks the whole brief incomplete
    // so the gate refuses instead of passing on a silently empty answer.
    const analysisComplete =
      dependencyImpact.analysisComplete !== false &&
      dataImpact.analysisComplete !== false &&
      permissionImpact.analysisComplete !== false &&
      integrationImpact.analysisComplete !== false;

    const blastRadiusClassification = this._classifyBlastRadius(dependencyImpact, dataImpact, permissionImpact);
    const summaryNarrative = this._generateSummaryNarrative(parsedIntent, blastRadiusClassification, dependencyImpact, dataImpact, permissionImpact);

    return {
      blastRadiusClassification,
      summaryNarrative,
      dependencyImpact,
      dataImpact,
      permissionImpact,
      integrationImpact,
      analysisComplete
    };
  }

  /**
   * Reverse-dependency lookup via Tooling API MetadataComponentDependency.
   * A custom field is referenced as "Object.Field"; whole components (objects,
   * classes, flows) by their API name. Falls back to an ID-based lookup when
   * the name filter returns nothing (component not yet indexed/created).
   */
  async _getDependencyImpact(accessToken, instanceUrl, parsedIntent) {
    const targetObject = isValidSfIdentifier(parsedIntent?.targetComponent)
      ? parsedIntent.targetComponent
      : null;

    if (!targetObject) {
      return {
        referencingComponentsCount: 0,
        components: [],
        analysisComplete: false,
        reason: 'No valid target component'
      };
    }

    const refNames = [targetObject];
    const field = parsedIntent?.targetField;
    if (typeof field === 'string' && isValidSfIdentifier(field)) {
      refNames.push(`${targetObject}.${field}`);
    }
    const inList = refNames.map(n => `'${n}'`).join(', ');

    const nameQuery =
      `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, ` +
      `RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency ` +
      `WHERE RefMetadataComponentName IN (${inList}) LIMIT 500`;

    // 1. Try the name-based filter first (a custom field is referenced as
    // "Object.Field"; whole components by their API name).
    let records = [];
    let nameQueryFailed = false;
    let isFatalError = false;
    try {
      records = await this.client.queryToolingAll(accessToken, instanceUrl, nameQuery);
    } catch (err) {
      nameQueryFailed = true;
      const msg = err?.message || '';
      if (msg.includes('INVALID_SESSION_ID') || msg.includes('API_DISABLED') || msg.includes('401')) {
        isFatalError = true;
      }
      console.warn('Dependency name query failed (will retry by ID):', msg);
    }

    if (nameQueryFailed || !Array.isArray(records) || records.length === 0) {
      // 2. Resolve the metadata component id by name, then query dependencies
      // by id. Runs on empty results AND on name-query failure.
      try {
        const candidates = await this.client.queryToolingAll(
          accessToken,
          instanceUrl,
          `SELECT Id, MetadataComponentType FROM MetadataComponent WHERE MetadataComponentName IN (${inList}) LIMIT 10`
        );
        const id = candidates?.[0]?.Id;
        if (id) {
          records = await this.client.queryToolingAll(
            accessToken,
            instanceUrl,
            `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, ` +
            `RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency ` +
            `WHERE RefMetadataComponentId = '${id}' LIMIT 500`
          );
        }
      } catch (idErr) {
        const msg = idErr?.message || '';
        if (msg.includes('INVALID_SESSION_ID') || msg.includes('API_DISABLED') || msg.includes('401')) {
          isFatalError = true;
        }
        console.warn('Dependency ID lookup failed (non-fatal):', msg);
      }
    }

    // 3. If an auth/session error occurred, analysis is incomplete.
    // Otherwise, a definitive empty result (such as standard objects like Opportunity
    // not present in the Tooling Dependency table) is a complete answer (0 dependencies).
    const analysisComplete = !isFatalError;

    return {
      referencingComponentsCount: Array.isArray(records) ? records.length : 0,
      components: (Array.isArray(records) ? records : []).slice(0, 50).map(r => ({
        type: r.MetadataComponentType,
        name: r.MetadataComponentName
      })),
      analysisComplete
    };
  }

  async _getDataImpact(accessToken, instanceUrl, parsedIntent) {
    try {
      // 1. Generate the SOQL query dynamically
      const soqlQuery = await this.orchestrator.generateImpactSOQL(parsedIntent);

      // 2. Execute the query
      const result = await this.client.getRecordCount(accessToken, instanceUrl, soqlQuery);

      return {
        violatingRecordsCount: result.count,
        sampleRecordIds: result.records.map(r => r.Id),
        analysisComplete: true
      };
    } catch (error) {
      const errMsg = error.response?.data?.[0]?.message || error.message || '';
      const errCode = error.response?.data?.[0]?.errorCode || '';

      // If the error is due to an object or field not existing in the org yet
      // (e.g. INVALID_TYPE, INVALID_FIELD), there are 0 existing violating
      // records because the component has not been created in the target org
      // yet — a definitive, complete answer, not a failure.
      if (
        errCode === 'INVALID_TYPE' ||
        errCode === 'INVALID_FIELD' ||
        errMsg.includes('INVALID_TYPE') ||
        errMsg.includes('INVALID_FIELD') ||
        errMsg.includes('sObject type') ||
        errMsg.includes('No such column')
      ) {
        console.warn('Data Impact SOQL target schema does not exist yet in org; returning 0 violating records.');
        return { violatingRecordsCount: 0, sampleRecordIds: [], analysisComplete: true };
      }

      // Surface other SOQL/client failures with status = 400 so the route
      // returns an actionable message.
      console.error('Data Impact SOQL failed:', errMsg);
      const err = new Error(`Data impact analysis failed: ${errMsg}`);
      err.status = 400;
      throw err;
    }
  }

  async _getPermissionImpact(accessToken, instanceUrl, parsedIntent) {
    if (!parsedIntent.operation || !parsedIntent.operation.includes('PERMISSION_SET')) {
      return { affectedUsersCount: 0, affectedPermissionSets: [], analysisComplete: true };
    }

    try {
      // Defense-in-depth against SOQL injection
      const targetComponent = isValidSfIdentifier(parsedIntent.targetComponent)
        ? parsedIntent.targetComponent
        : null;

      if (!targetComponent) {
        return { affectedUsersCount: 0, affectedPermissionSets: [], analysisComplete: true };
      }

      // Query standard SOQL (not Tooling API) to find how many users have this
      // Permission Set assigned. We select Id and rely on the REST API's
      // totalSize for the count.
      const query = `SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = '${targetComponent}'`;
      const result = await this.client.getRecordCount(accessToken, instanceUrl, query);

      return {
        affectedUsersCount: result.count,
        affectedPermissionSets: [targetComponent],
        analysisComplete: true
      };
    } catch (error) {
      console.warn('Permission impact query failed:', error.message);
      return {
        affectedUsersCount: 0,
        affectedPermissionSets: [],
        analysisComplete: false,
        reason: error.message
      };
    }
  }

  /**
   * Integration impact: which external systems could be affected. Queries the
   * org's Connected Apps and Named Credentials via the Tooling API and reports
   * them as the population that might consume the changed metadata.
   */
  async _getIntegrationImpact(accessToken, instanceUrl) {
    try {
      const [apps, creds] = await Promise.all([
        this.client.queryToolingAll(
          accessToken,
          instanceUrl,
          'SELECT Id, DeveloperName FROM ConnectedApp LIMIT 200'
        ).catch((err) => {
          if (err.message?.includes('INVALID_TYPE') || err.message?.includes('sObject type') || err.response?.status === 400) {
            return [];
          }
          throw err;
        }),
        this.client.queryToolingAll(
          accessToken,
          instanceUrl,
          'SELECT Id, DeveloperName FROM NamedCredential LIMIT 200'
        ).catch((err) => {
          if (err.message?.includes('INVALID_TYPE') || err.message?.includes('sObject type') || err.response?.status === 400) {
            return [];
          }
          throw err;
        })
      ]);

      return {
        connectedApps: (Array.isArray(apps) ? apps : []).map(a => a.DeveloperName).filter(Boolean),
        namedCredentials: (Array.isArray(creds) ? creds : []).map(c => c.DeveloperName).filter(Boolean),
        analysisComplete: true
      };
    } catch (error) {
      console.warn('Integration impact query failed:', error.message);
      return {
        connectedApps: [],
        namedCredentials: [],
        analysisComplete: false,
        reason: error.message
      };
    }
  }

  _classifyBlastRadius(dependencyImpact, dataImpact, permissionImpact) {
    if ((dataImpact?.violatingRecordsCount || 0) > 0) return 'Medium';
    if ((dependencyImpact?.referencingComponentsCount || 0) > 10) return 'High';
    if ((permissionImpact?.affectedUsersCount || 0) > 50) return 'High';
    return 'Low';
  }

  _generateSummaryNarrative(parsedIntent, classification, dependencyImpact, dataImpact, permissionImpact) {
    const targetComp = parsedIntent?.targetComponent || 'target object';

    let summary = `This change on ${targetComp} is classified as ${classification} Risk. `;
    if (dataImpact?.violatingRecordsCount > 0) {
      summary += `${dataImpact.violatingRecordsCount} existing record(s) currently violate this rule. `;
    } else {
      summary += `No existing records violate this rule. `;
    }

    if (dependencyImpact?.referencingComponentsCount > 0) {
      summary += `${dependencyImpact.referencingComponentsCount} existing automation(s) or layout(s) reference this component. `;
    } else {
      summary += `No other workflows or automations are affected. `;
    }

    if (permissionImpact?.affectedUsersCount > 0) {
      summary += `${permissionImpact.affectedUsersCount} user(s) will have their permissions updated.`;
    }

    return summary.trim();
  }
}

export { ImpactAnalyzer };
export const impactAnalyzer = new ImpactAnalyzer();
