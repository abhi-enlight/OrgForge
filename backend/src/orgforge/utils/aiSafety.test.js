/**
 * Unit tests for aiSafety.js
 * Run: npm test (uses Node built-in test runner)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOperation,
  normalizeTargetField,
  isSafeAggregateSoql,
  isWellFormedXml,
  extractCustomFieldType,
  validateCustomFieldXml,
  OPERATION_WHITELIST
} from './aiSafety.js';

describe('normalizeOperation', () => {
  it('upcases and trims valid operations', () => {
    assert.equal(normalizeOperation('create_validation_rule'), 'CREATE_VALIDATION_RULE');
    assert.equal(normalizeOperation('  update_apex_class  '), 'UPDATE_APEX_CLASS');
  });

  it('returns UNKNOWN for operations not in the whitelist', () => {
    assert.equal(normalizeOperation('DROP_TABLE'), 'UNKNOWN');
  });

  it('returns UNKNOWN for non-string input', () => {
    assert.equal(normalizeOperation(null), 'UNKNOWN');
    assert.equal(normalizeOperation(undefined), 'UNKNOWN');
    assert.equal(normalizeOperation(42), 'UNKNOWN');
  });

  it('covers all whitelisted operations', () => {
    for (const op of OPERATION_WHITELIST) {
      assert.equal(normalizeOperation(op), op);
    }
  });
});

describe('normalizeTargetField', () => {
  it('trims and validates a plain field API name', () => {
    assert.equal(normalizeTargetField('  Status__c '), 'Status__c');
    assert.equal(normalizeTargetField('Close_Reason_Required'), 'Close_Reason_Required');
  });

  it('rejects dot-qualified, empty, or unsafe values', () => {
    assert.equal(normalizeTargetField('Support_Ticket__c.Status__c'), null);
    assert.equal(normalizeTargetField(''), null);
    assert.equal(normalizeTargetField('DROP TABLE'), null);
    assert.equal(normalizeTargetField(null), null);
    assert.equal(normalizeTargetField(undefined), null);
  });
});

describe('extractCustomFieldType / validateCustomFieldXml', () => {
  it('extracts a plain <type> value', () => {
    assert.equal(extractCustomFieldType('<CustomField><fullName>S__c</fullName><type>Text</type></CustomField>'), 'Text');
    assert.equal(extractCustomFieldType('<?xml version="1.0"?><CustomField xmlns="x"><type>Picklist</type></CustomField>'), 'Picklist');
  });

  it('ignores commented-out and CDATA-embedded <type> text', () => {
    assert.equal(extractCustomFieldType('<CustomField><!-- <type>Text</type> --></CustomField>'), null);
    // A literal "<type>...</type>" inside a formula CDATA must not be read as the field type.
    assert.equal(
      extractCustomFieldType('<CustomField><type>Text</type><formula><![CDATA[TEXT(Name) & " <type>Picklist</type> "]]></formula></CustomField>'),
      'Text'
    );
  });

  it('does not match element names that merely start with <type', () => {
    assert.equal(extractCustomFieldType('<CustomField><typeName>Foo</typeName><type>Text</type></CustomField>'), 'Text');
  });

  it('accepts supported field types', () => {
    assert.equal(validateCustomFieldXml('<CustomField><fullName>F__c</fullName><type>Text</type></CustomField>'), null);
    assert.equal(validateCustomFieldXml('<CustomField><fullName>F__c</fullName><type>LongTextArea</type></CustomField>'), null);
    assert.equal(validateCustomFieldXml('<CustomField><fullName>F__c</fullName><type>MultiselectPicklist</type></CustomField>'), null);
  });

  it('rejects unsupported, human-label, or missing types', () => {
    assert.match(validateCustomFieldXml('<CustomField><fullName>F__c</fullName><type>Text Area</type></CustomField>'), /Unsupported custom field type "Text Area"/);
    assert.match(validateCustomFieldXml('<CustomField><fullName>F__c</fullName><type>String</type></CustomField>'), /Unsupported/);
    assert.match(validateCustomFieldXml('<CustomField><fullName>F__c</fullName><type>Formula</type></CustomField>'), /Unsupported/);
    assert.match(validateCustomFieldXml('<CustomField><fullName>S__c</fullName></CustomField>'), /missing a <type>/);
    assert.ok(validateCustomFieldXml(null));
  });

  it('rejects missing fullName', () => {
    assert.match(validateCustomFieldXml('<CustomField><type>Text</type></CustomField>'), /missing a <fullName>/);
  });
});

describe('isSafeAggregateSoql', () => {
  it('accepts safe COUNT/SUM queries without wildcards', () => {
    assert.equal(isSafeAggregateSoql('SELECT COUNT() FROM Account'), true);
    assert.equal(isSafeAggregateSoql('SELECT COUNT(Id) FROM Contact WHERE IsActive__c = true'), true);
  });

  it('rejects queries with DML keywords', () => {
    assert.equal(isSafeAggregateSoql('DELETE FROM Account'), false);
    assert.equal(isSafeAggregateSoql('UPDATE Contact SET Name = "test"'), false);
    assert.equal(isSafeAggregateSoql('INSERT INTO Account (Name) VALUES ("X")'), false);
    assert.equal(isSafeAggregateSoql('UPSERT Contact'), false);
  });

  it('rejects SELECT * (full extract)', () => {
    assert.equal(isSafeAggregateSoql('SELECT * FROM Opportunity'), false);
  });

  it('rejects non-aggregate SELECT without aggregates', () => {
    assert.equal(isSafeAggregateSoql('SELECT Id, Name FROM Account'), false);
  });

  it('returns false for empty or non-string input', () => {
    assert.equal(isSafeAggregateSoql(''), false);
    assert.equal(isSafeAggregateSoql(null), false);
    assert.equal(isSafeAggregateSoql(undefined), false);
  });
});

describe('isWellFormedXml', () => {
  it('accepts valid single-element XML', () => {
    assert.equal(isWellFormedXml('<ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Test</fullName></ValidationRule>'), true);
  });

  it('accepts valid self-closing tag XML', () => {
    assert.equal(isWellFormedXml('<CustomField><type>Text</type><length>255</length></CustomField>'), true);
  });

  it('rejects mismatched tags', () => {
    assert.equal(isWellFormedXml('<ValidationRule><fullName>Test</wrongTag>'), false);
  });

  it('rejects non-string / empty input', () => {
    assert.equal(isWellFormedXml(''), false);
    assert.equal(isWellFormedXml(null), false);
    assert.equal(isWellFormedXml(42), false);
  });

  it('rejects script injection', () => {
    assert.equal(isWellFormedXml('<foo><script>alert("xss")</script></foo>'), false);
  });
});

