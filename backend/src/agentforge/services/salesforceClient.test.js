/**
 * Unit tests for the agentforge salesforceClient Apex string-literal hardening:
 *   - normalizeStringLiteralNewlines (deploy-time safety net)
 *   - findStringLiteralViolations (pre-flight linting)
 *   - validateApexCode / createAction (early rejection)
 *
 * Run: npm test (backend workspace) or `node --test src/agentforge/services/salesforceClient.test.js`
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import salesforceClient, {
  normalizeStringLiteralNewlines,
  findStringLiteralViolations
} from './salesforceClient.js';

describe('normalizeStringLiteralNewlines', () => {
  it('converts a real newline inside a string literal into the \\n escape', () => {
    const input = "String msg = 'line one\nline two';"; // real line break
    const expected = "String msg = 'line one\\nline two';"; // backslash + n
    assert.equal(normalizeStringLiteralNewlines(input), expected);
  });

  it('converts CRLF inside a string literal into the \\n escape', () => {
    const input = "String msg = 'line one\r\nline two';";
    assert.equal(normalizeStringLiteralNewlines(input), "String msg = 'line one\\nline two';");
  });

  it('preserves an already-legal \\n escape untouched', () => {
    const input = "String msg = 'line one\\nline two';";
    assert.equal(normalizeStringLiteralNewlines(input), input);
  });

  it('un-double-escapes a JSON-serialization artifact (\\\\n -> \\n)', () => {
    const input = "String msg = 'line one\\\\nline two';"; // chars: \ \ n
    assert.equal(normalizeStringLiteralNewlines(input), "String msg = 'line one\\nline two';");
  });

  it('leaves real newlines outside string literals (code structure) untouched', () => {
    const input = "global with sharing class Foo {\n    public String bar = 'ok';\n}\n";
    assert.equal(normalizeStringLiteralNewlines(input), input);
  });

  it('ignores apostrophes inside line comments', () => {
    const input = "// don't worry about 'quotes'\nString s = 'fine';";
    assert.equal(normalizeStringLiteralNewlines(input), input);
  });

  it('ignores quotes and newlines inside block comments', () => {
    const input = "/* comment 'a\nb' */\nString s = 'ok';";
    assert.equal(normalizeStringLiteralNewlines(input), input);
  });

  it('handles an escaped quote without terminating the literal early', () => {
    const input = "String s = 'it\\'s\nfine';"; // \' then real newline
    assert.equal(normalizeStringLiteralNewlines(input), "String s = 'it\\'s\\nfine';");
  });

  it('converts a real tab inside a string literal into the \\t escape', () => {
    const input = "String s = 'a\tb';"; // real tab
    assert.equal(normalizeStringLiteralNewlines(input), "String s = 'a\\tb';");
  });

  it('preserves an already-legal \\t escape and un-double-escapes \\\\t', () => {
    const legal = "String s = 'a\\tb';";
    assert.equal(normalizeStringLiteralNewlines(legal), legal);
    const doubled = "String s = 'a\\\\tb';";
    assert.equal(normalizeStringLiteralNewlines(doubled), "String s = 'a\\tb';");
  });

  it('fixes SOQL string values', () => {
    const input = "List<SObject> r = [SELECT Id FROM Account WHERE Name = 'foo\nbar' WITH USER_MODE];";
    assert.equal(
      normalizeStringLiteralNewlines(input),
      "List<SObject> r = [SELECT Id FROM Account WHERE Name = 'foo\\nbar' WITH USER_MODE];"
    );
  });

  it('fixes @InvocableVariable annotations', () => {
    const input = "@InvocableVariable(label='Warning\nmessage')\npublic String warning;";
    assert.equal(
      normalizeStringLiteralNewlines(input),
      "@InvocableVariable(label='Warning\\nmessage')\npublic String warning;"
    );
  });

  it('leaves empty string literals untouched', () => {
    assert.equal(normalizeStringLiteralNewlines("String s = '';"), "String s = '';");
  });

  it('passes non-string inputs through unchanged', () => {
    assert.equal(normalizeStringLiteralNewlines(null), null);
    assert.equal(normalizeStringLiteralNewlines(undefined), undefined);
    assert.equal(normalizeStringLiteralNewlines(42), 42);
  });
});

describe('findStringLiteralViolations', () => {
  it('detects a multiline literal and reports the line where it starts', () => {
    const input = "String a = 'x';\nString b = 'y\nz';";
    const violations = findStringLiteralViolations(input);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.match(violations[0].snippet, /'y/);
  });

  it('finds no violations in clean code with escapes, comments, and escaped quotes', () => {
    const clean =
      "String a = 'esc\\naped';\n" +
      "String b = 'it\\'s fine';\n" +
      "// plain comment\n" +
      "String c = 'ok';";
    assert.equal(findStringLiteralViolations(clean).length, 0);
  });

  it('finds no violations when quotes/newlines are inside a block comment', () => {
    const clean = "/* block 'comment\nwith quote */\nString d = 'fine';";
    assert.equal(findStringLiteralViolations(clean).length, 0);
  });

  it('returns an empty array for non-string inputs', () => {
    assert.deepEqual(findStringLiteralViolations(null), []);
    assert.deepEqual(findStringLiteralViolations(undefined), []);
  });
});

describe('validateApexCode (multiline-literal lint)', () => {
  const validApex =
    "global with sharing class Foo {\n" +
    "    public class InputParameters {}\n" +
    "    public class OutputParameters {}\n" +
    "    @InvocableMethod(label='x' description='y')\n" +
    "    global static List<OutputParameters> execute(List<InputParameters> inputs) {\n" +
    "        return new List<OutputParameters>();\n" +
    "    }\n" +
    "}\n";

  it('rejects apexCode containing a line break inside a string literal', () => {
    const res = salesforceClient.validateApexCode("String s = 'a\nb';", null, 'Foo');
    assert.equal(res.valid, false);
    assert.match(res.reason, /line break inside a string literal/);
    // The fixup hint must render as a SINGLE backslash + n (\n), never a real
    // newline and never a double backslash (\\n) — the model reads this text.
    assert.ok(res.reason.includes('\\n'), 'hint must contain the \\n escape');
    assert.ok(!res.reason.includes('\\\\n'), 'hint must not contain a doubled backslash');
    assert.ok(!res.reason.includes('\n'), 'hint must not contain a raw line break');
  });

  it('rejects testClassCode containing a line break inside a string literal', () => {
    const badTest =
      "@isTest\n" +
      "private with sharing class FooTest {\n" +
      "    @isTest static void t() {\n" +
      "        String m = 'a\nb';\n" +
      "    }\n" +
      "}\n";
    const res = salesforceClient.validateApexCode(validApex, badTest, 'Foo');
    assert.equal(res.valid, false);
    assert.match(res.reason, /TEST LINTER ERROR: illegal line break/);
  });

  it('accepts clean code that uses escaped strings', () => {
    const apex =
      validApex.replace(
        "return new List<OutputParameters>();",
        "String msg = 'ok\\nstill ok';\n        return new List<OutputParameters>();"
      );
    assert.equal(salesforceClient.validateApexCode(apex, null, 'Foo').valid, true);
  });
});

describe('sanitizeApexCode / createAction integration', () => {
  it('sanitizeApexCode repairs a multiline literal without breaking the rest of the class', () => {
    const dirty =
      "global with sharing class Check_SLA_Breaches {\n" +
      "    public String warning = 'This case is within 25%\n" +
      "of its SLA deadline';\n" +
      "}\n";
    const out = salesforceClient.sanitizeApexCode(dirty, 'Check_SLA_Breaches');
    assert.ok(out.includes("'This case is within 25%\\nof its SLA deadline'"));
    assert.ok(!out.includes("25%\nof"), 'no real newline may remain inside the literal');
  });

  it('createAction rejects illegal code immediately and does not queue it', () => {
    const ctx = salesforceClient.createContext();
    const res = salesforceClient.createAction(ctx, {
      developerName: 'Bad_Action',
      masterLabel: 'Bad Action',
      apexCode: "String s = 'a\nb';",
      testClassCode: null
    });
    assert.equal(res.success, false);
    assert.match(res.error, /line break inside a string literal/);
    assert.equal(ctx.actions.length, 0);
  });

  it('createAction queues clean code as before', () => {
    const ctx = salesforceClient.createContext();
    const apex =
      "global with sharing class Good_Action {\n" +
      "    public class InputParameters {}\n" +
      "    public class OutputParameters {}\n" +
      "    @InvocableMethod(label='x')\n" +
      "    global static List<OutputParameters> execute(List<InputParameters> inputs) {\n" +
      "        return new List<OutputParameters>();\n" +
      "    }\n" +
      "}\n";
    const res = salesforceClient.createAction(ctx, {
      developerName: 'Good_Action',
      masterLabel: 'Good Action',
      instruction: 'Handle good cases',
      apexCode: apex,
      testClassCode: null
    });
    assert.equal(res.success, true);
    assert.equal(ctx.actions.length, 1);
    assert.equal(ctx.actions[0].developerName, 'Good_Action');
  });
});
