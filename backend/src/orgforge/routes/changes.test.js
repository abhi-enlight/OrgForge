/**
 * Unit tests for the operation→artifact mapping in changes.js.
 * Run: npm test
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mapOperationToArtifact, deriveFieldName, deriveObjectName } from './changes.js';
import { redisConnection } from '../jobs/queue.js';

// Importing changes.js transitively imports queue.js, which opens a lazy
// ioredis client at module scope. Disconnect it so the test process exits.
after(() => {
  redisConnection.disconnect();
});

const FIELD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Status__c</fullName>
    <label>Status</label>
    <type>Text</type>
    <length>80</length>
</CustomField>`;

describe('mapOperationToArtifact — Custom Fields', () => {
  it('derives the field name from the generated XML <fullName>', () => {
    const artifact = mapOperationToArtifact('CREATE_CUSTOM_FIELD', 'Support_Ticket__c', FIELD_XML);
    assert.equal(
      artifact.filePath,
      'force-app/main/default/objects/Support_Ticket__c/fields/Status__c.field-meta.xml'
    );
    assert.equal(artifact.artifactName, 'Support_Ticket__c.Status__c');
  });

  it('derives the field name from a dot-qualified targetComponent when XML has no <fullName>', () => {
    const artifact = mapOperationToArtifact('UPDATE_CUSTOM_FIELD', 'Support_Ticket__c.Status__c', '<CustomField/>');
    assert.equal(
      artifact.filePath,
      'force-app/main/default/objects/Support_Ticket__c/fields/Status__c.field-meta.xml'
    );
    assert.equal(artifact.artifactName, 'Support_Ticket__c.Status__c');
  });

  it('falls back to NewField__c only when nothing can be derived', () => {
    const artifact = mapOperationToArtifact('CREATE_CUSTOM_FIELD', 'Account', '<CustomField/>');
    assert.equal(
      artifact.filePath,
      'force-app/main/default/objects/Account/fields/NewField__c.field-meta.xml'
    );
    assert.equal(artifact.artifactName, 'Account.NewField__c');
  });

  it('uses targetField from the intent when the XML has no <fullName>', () => {
    const artifact = mapOperationToArtifact('UPDATE_CUSTOM_FIELD', 'Support_Ticket__c', '<CustomField/>', 'Status__c');
    assert.equal(
      artifact.filePath,
      'force-app/main/default/objects/Support_Ticket__c/fields/Status__c.field-meta.xml'
    );
    assert.equal(artifact.artifactName, 'Support_Ticket__c.Status__c');
  });

  it('lets the XML <fullName> win over a conflicting targetField', () => {
    const artifact = mapOperationToArtifact(
      'UPDATE_CUSTOM_FIELD',
      'Support_Ticket__c',
      '<CustomField><fullName>Other__c</fullName></CustomField>',
      'Status__c'
    );
    assert.equal(
      artifact.filePath,
      'force-app/main/default/objects/Support_Ticket__c/fields/Other__c.field-meta.xml'
    );
    assert.equal(artifact.artifactName, 'Support_Ticket__c.Other__c');
  });

  it('uses the derived name for the DELETE_CUSTOM_FIELD artifactName', () => {
    const artifact = mapOperationToArtifact('DELETE_CUSTOM_FIELD', 'Support_Ticket__c.Status__c', '<root/>');
    assert.equal(artifact.artifactName, 'Support_Ticket__c.Status__c');
    assert.equal(artifact.filePath, 'force-app/main/default/destructiveChanges.xml');
  });

  it('ignores nested picklist value <fullName> elements', () => {
    const picklistXml = `<CustomField><fullName>Status__c</fullName><valueSet><valueSetDefinition><value><fullName>Open</fullName></value></valueSetDefinition></valueSet></CustomField>`;
    assert.equal(deriveFieldName(picklistXml, 'Support_Ticket__c'), 'Status__c');
  });

  it('handles an object-qualified <fullName> in the XML', () => {
    const qualified = '<CustomField><fullName>Support_Ticket__c.Status__c</fullName></CustomField>';
    assert.equal(deriveFieldName(qualified, 'Support_Ticket__c'), 'Status__c');
    assert.equal(deriveObjectName(qualified, 'Support_Ticket__c'), 'Support_Ticket__c');
  });

  it('prefers the XML <fullName> over targetField', () => {
    assert.equal(deriveFieldName('<CustomField><fullName>XmlName__c</fullName></CustomField>', 'Support_Ticket__c', 'Status__c'), 'XmlName__c');
  });

  it('uses targetField before the targetComponent dot-suffix', () => {
    assert.equal(deriveFieldName('<CustomField/>', 'Support_Ticket__c.Status__c', 'Priority__c'), 'Priority__c');
  });

  it('prefers the object from an object-qualified XML <fullName> over targetComponent', () => {
    const artifact = mapOperationToArtifact(
      'UPDATE_CUSTOM_FIELD',
      'Support_Ticket__c',
      '<CustomField><fullName>OtherObj__c.Other__c</fullName></CustomField>'
    );
    assert.equal(
      artifact.filePath,
      'force-app/main/default/objects/OtherObj__c/fields/Other__c.field-meta.xml'
    );
    assert.equal(artifact.artifactName, 'OtherObj__c.Other__c');
  });

  it('ignores <fullName> inside XML comments', () => {
    const commented = '<!-- <fullName>Old__c</fullName> --><CustomField><fullName>Status__c</fullName></CustomField>';
    assert.equal(deriveFieldName(commented, 'Support_Ticket__c'), 'Status__c');
  });

  it('rejects unsafe fullName values', () => {
    assert.equal(deriveFieldName('<CustomField><fullName>DROP TABLE</fullName></CustomField>', 'Account'), null);
    assert.equal(deriveObjectName('', 'Invalid Name'), null);
    assert.equal(deriveObjectName('', ''), null);
    assert.equal(deriveFieldName('<CustomField/>', 'Support_Ticket__c', 'Invalid Name'), null);
  });

  it('fails loudly when no valid object name can be derived', () => {
    assert.throws(
      () => mapOperationToArtifact('CREATE_CUSTOM_FIELD', 'Invalid Name', '<CustomField/>'),
      /not a valid Salesforce API name/
    );
  });
});
