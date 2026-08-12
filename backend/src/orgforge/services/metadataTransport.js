import AdmZip from 'adm-zip';
import { salesforceClient } from './salesforceClient.js';
import { validateCustomFieldXml } from '../utils/aiSafety.js';

const KNOWN_METADATA_TYPES = new Set([
  'ValidationRule',
  'CustomField',
  'CustomObject',
  'ApexClass',
  'ApexTrigger',
  'PermissionSet',
  'Flow',
  'CustomTab',
  'SharingRules',
  'RecordType',
  'ListView',
]);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Derives a metadata API member name from a source-format file path, e.g.
 *   force-app/main/default/objects/Opportunity/validationRules/Rule.validationRule-meta.xml
 *     -> Opportunity.Rule
 *   force-app/main/default/classes/MyService.cls -> MyService
 */
export function deriveFullName(filePath) {
  if (!filePath) return null;
  const clean = String(filePath).replace(/\\/g, '/');
  const segments = clean.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1];
  if (!fileName) return null;

  const objIdx = segments.indexOf('objects');
  const objectName = objIdx !== -1 ? segments[objIdx + 1] : null;

  if (/\.object-meta\.xml$/i.test(fileName) && objectName) {
    return objectName;
  }

  const base = fileName
    .replace(/\.(?:validationRule|field|permissionSet|listView|recordType|flow|customTab|sharingRules)-meta\.xml$/i, '')
    .replace(/\.(?:cls|trigger)$/i, '')
    .replace(/\.xml$/i, '');

  return objectName ? `${objectName}.${base}` : base;
}

class MetadataTransport {
  /**
   * Packages artifacts into a Metadata API deployment ZIP with a valid
   * package.xml that declares every artifact's type and members. Throws on
   * any artifact it cannot map, so an invalid package can never be deployed.
   */
  assembleDeploymentZip(artifacts) {
    const typesMap = new Map(); // metadataType -> Set<member>
    const fileEntries = []; // { targetPath, buffer } in input order
    const objectContainers = new Map(); // objName -> { fields, validationRules, recordTypes, listViews }
    const objectArtifacts = new Map(); // objName -> { targetPath, buffer } (explicit CustomObject files)

    // Decomposed source-format child files (fields, validation rules, record
    // types, list views) fold back into a metadata-format <CustomObject>
    // container. The SOAP deploy() call expects child types inline inside
    // objects/<Object>.object — shipping the decomposed path makes Salesforce
    // report "was named in package.xml, but was not found in zipped directory".
    const CHILD_SECTION_RE =
      /^objects\/([^/]+)\/(fields|validationRules|recordTypes|listViews)\/([^/]+)\.(?:field|validationRule|recordType|listView)-meta\.xml$/i;

    for (const artifact of artifacts || []) {
      if (!artifact || !artifact.filePath || typeof artifact.content !== 'string') {
        throw new Error('Deployment artifacts must include filePath and content.');
      }

      const metadataType = artifact.metadataType;
      if (!metadataType || !KNOWN_METADATA_TYPES.has(metadataType)) {
        const err = new Error(
          `Unknown metadata type "${metadataType}" for ${artifact.filePath}; cannot build a valid package.xml.`
        );
        err.status = 400;
        throw err;
      }

      const member = artifact.fullName || deriveFullName(artifact.filePath);
      if (!member) {
        const err = new Error(`Could not derive a metadata member name for ${artifact.filePath}.`);
        err.status = 400;
        throw err;
      }

      if (!typesMap.has(metadataType)) typesMap.set(metadataType, new Set());
      typesMap.get(metadataType).add(member);

      // Fail fast on invalid generated CustomField XML (e.g. a <type> outside
      // the FieldType enum) so the operator sees an actionable message instead
      // of the MDAPI dry-run's cryptic "Unsupported custom field type
      // conversion attempted". Catches stale artifacts too, not just newly
      // generated ones. Only real .field-meta.xml documents are checked — a
      // DELETE_CUSTOM_FIELD maps to a destructiveChanges.xml manifest that
      // intentionally has no <type> element.
      if (metadataType === 'CustomField' && /\.field-meta\.xml$/i.test(artifact.filePath)) {
        const typeError = validateCustomFieldXml(artifact.content);
        if (typeError) {
          const err = new Error(`Invalid CustomField artifact ${artifact.filePath}: ${typeError}`);
          err.status = 400;
          throw err;
        }
      }

      // Normalize to a zip-relative path (strip force-app/main/default or a
      // stray unpackaged/ prefix).
      const normalizedPath = String(artifact.filePath)
        .replace(/\\/g, '/')
        .replace(/^force-app\/main\/default\//i, '')
        .replace(/^unpackaged\//i, '')
        .replace(/^\/+/, '');

      if (!normalizedPath) {
        const err = new Error(`Could not map artifact ${artifact.filePath} to a package path.`);
        err.status = 400;
        throw err;
      }

      const childMatch = normalizedPath.match(CHILD_SECTION_RE);
      if (childMatch) {
        const [, objName, section] = childMatch;
        // Trim FIRST so the anchored wrapper-strip regexes below work even when
        // the artifact lacks an XML declaration or starts with whitespace.
        const innerXml = artifact.content
          .trim()
          .replace(/^<\?xml[^>]*\?>\s*/i, '')
          .replace(/^<(?:CustomField|ValidationRule|RecordType|ListView)[^>]*>/i, '')
          .replace(/<\/(?:CustomField|ValidationRule|RecordType|ListView)>\s*$/i, '')
          .trim();
        if (!objectContainers.has(objName)) {
          objectContainers.set(objName, { fields: [], validationRules: [], recordTypes: [], listViews: [] });
        }
        objectContainers.get(objName)[section].push(innerXml);
        continue;
      }

      // CustomObject source files flatten to objects/<Name>.object.
      if (/\.object-meta\.xml$/i.test(normalizedPath)) {
        const objectName = normalizedPath.split('/').pop().replace(/\.object-meta\.xml$/i, '');
        objectArtifacts.set(objectName, {
          targetPath: `objects/${objectName}.object`,
          buffer: Buffer.from(artifact.content, 'utf8')
        });
        continue;
      }

      // Generic metadata-format path: strip the -meta suffix (e.g.
      // MyFlow.flow-meta.xml -> MyFlow.flow). ApexClass/ApexTrigger and
      // destructiveChanges.xml pass through unchanged.
      const targetPath = normalizedPath.replace(/(\.[A-Za-z0-9]+)-meta\.xml$/i, '$1');
      fileEntries.push({ targetPath, buffer: Buffer.from(artifact.content, 'utf8') });
    }

    // Synthesize (or enrich) metadata-format CustomObject containers for the
    // folded child types.
    for (const [objName, sections] of objectContainers) {
      let body = '';
      if (sections.fields.length) {
        body += sections.fields.map(f => `    <fields>\n${f}\n    </fields>`).join('\n');
      }
      if (sections.validationRules.length) {
        body += sections.validationRules.map(r => `    <validationRules>\n${r}\n    </validationRules>`).join('\n');
      }
      if (sections.recordTypes.length) {
        body += sections.recordTypes.map(r => `    <recordTypes>\n${r}\n    </recordTypes>`).join('\n');
      }
      if (sections.listViews.length) {
        body += sections.listViews.map(l => `    <listViews>\n${l}\n    </listViews>`).join('\n');
      }

      const existing = objectArtifacts.get(objName);
      if (existing) {
        // Merge child sections into an explicit CustomObject artifact. Fail
        // loudly if the object XML is malformed rather than silently dropping
        // the folded children.
        const content = existing.buffer.toString('utf8');
        if (!/<\/CustomObject>\s*$/i.test(content)) {
          const err = new Error(
            `CustomObject artifact for ${objName} is missing a closing </CustomObject>; cannot merge folded child components.`
          );
          err.status = 400;
          throw err;
        }
        existing.buffer = Buffer.from(content.replace(/<\/CustomObject>\s*$/i, `${body}\n</CustomObject>`), 'utf8');
      } else {
        const objXml = `<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}\n</CustomObject>`;
        objectArtifacts.set(objName, { targetPath: `objects/${objName}.object`, buffer: Buffer.from(objXml, 'utf8') });
      }
    }

    for (const entry of objectArtifacts.values()) {
      fileEntries.push(entry);
    }

    let typesXml = '';
    for (const [type, members] of typesMap) {
      const memberXml = [...members].map(m => `      <members>${escapeXml(m)}</members>`).join('\n');
      typesXml += `  <types>\n${memberXml}\n    <name>${escapeXml(type)}</name>\n  </types>\n`;
    }

    const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
${typesXml}  <version>61.0</version>
</Package>`;

    // noSort is REQUIRED: adm-zip 0.6.0 alphabetically sorts entries on every
    // addFile by default, which would push package.xml after objects/… and
    // reintroduce the very bug this ordering prevents.
    if (fileEntries.length === 0) {
      const err = new Error('Cannot assemble a deployment package with no artifacts.');
      err.status = 400;
      throw err;
    }

    const zip = new AdmZip(undefined, { noSort: true });

    // CRITICAL: package.xml MUST be the first entry in the zip. Empirically
    // (observed across live MDAPI dry-runs), Salesforce's deploy engine treats
    // the directory of the first top-level entry as the package root: with
    // objects/ first it looks for objects/package.xml and reports
    // "No package.xml found" with 0 components total, even though a valid
    // manifest sits at the zip root. Adding the manifest first makes the zip
    // root the package root.
    zip.addFile('package.xml', Buffer.from(packageXml, 'utf8'));
    for (const entry of fileEntries) {
      zip.addFile(entry.targetPath, entry.buffer);
    }

    // Post-build integrity check: the MDAPI deploy manifest must exist at the
    // zip root AND be the first entry. Fail loudly with the actual entry list
    // instead of letting Salesforce reject the package with a cryptic
    // "No package.xml found".
    const entryNames = zip.getEntries().map(e => e.entryName);
    if (entryNames[0] !== 'package.xml' || !entryNames.includes('package.xml')) {
      const err = new Error(
        `Built package must have package.xml as its first zip entry. Zip entries: ${entryNames.join(', ') || '(empty)'}`
      );
      err.status = 400;
      throw err;
    }

    return zip.toBuffer();
  }

  async deployCheckOnly(accessToken, instanceUrl, zipBuffer) {
    const deploymentId = await salesforceClient.deployMetadata(accessToken, instanceUrl, zipBuffer, { checkOnly: true });
    return { deploymentId };
  }

  async deployFinal(accessToken, instanceUrl, zipBuffer, testLevel = 'NoTestRun') {
    const deploymentId = await salesforceClient.deployMetadata(accessToken, instanceUrl, zipBuffer, { checkOnly: false, testLevel });
    return { status: 'Queued', deploymentId };
  }

  async pollDeployStatus(accessToken, instanceUrl, deploymentId) {
    return await salesforceClient.checkDeployStatus(accessToken, instanceUrl, deploymentId);
  }

  async retrieveBackup(accessToken, instanceUrl, artifacts) {
    // Generate <types> block for retrieve package.xml based on artifacts
    const typeSet = new Set();
    artifacts.forEach(a => {
      if (a.metadataType) typeSet.add(a.metadataType);
    });

    let typesXml = '';
    typeSet.forEach(type => {
      typesXml += `
          <types>
            <members>*</members>
            <name>${type}</name>
          </types>`;
    });

    if (!typesXml) {
      // Fallback if no types found, retrieve all CustomObjects for example
      typesXml = `
          <types>
            <members>*</members>
            <name>CustomObject</name>
          </types>`;
    }

    const retrieveId = await salesforceClient.retrieveMetadata(accessToken, instanceUrl, typesXml);
    return { retrieveId };
  }

  async pollRetrieveStatus(accessToken, instanceUrl, retrieveId) {
    return await salesforceClient.checkRetrieveStatus(accessToken, instanceUrl, retrieveId);
  }
}

export const metadataTransport = new MetadataTransport();
