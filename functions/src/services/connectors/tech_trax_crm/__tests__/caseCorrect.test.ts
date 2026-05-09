import { strict as assert } from "node:assert";
import {
  applyCaseCorrection,
  coachJoiError,
  parseEnumError,
  requestWithEnumRetry,
} from "../caseCorrect";

// 1. Parser pulls allowed values from the enriched 4xx message format we emit.
{
  const err = {
    code: "client_error",
    status: 400,
    message:
      'Custom field validation failed — Field "Customer Interest" must be one of: High, Medium, Low, Not Interested',
    details: { message: "Custom field validation failed" },
  };
  const hint = parseEnumError(err);
  assert.ok(hint, "parser should match enriched message");
  assert.equal(hint!.fieldLabel, "Customer Interest");
  assert.deepEqual(hint!.allowed, ["High", "Medium", "Low", "Not Interested"]);
}

// 2. Parser also matches when the allowed list is in details.errors[].message.
{
  const err = {
    code: "client_error",
    message: "Validation error",
    details: {
      errors: [
        { path: "customFields.0.value", message: 'must be one of: Hot, Warm, Cold' },
      ],
    },
  };
  const hint = parseEnumError(err);
  assert.ok(hint);
  assert.deepEqual(hint!.allowed, ["Hot", "Warm", "Cold"]);
}

// 3. applyCaseCorrection rewrites lowercase → canonical and reports the path.
{
  const body: any = {
    customFields: [
      { fieldId: "abc", value: "high" },
      { fieldId: "xyz", value: "already-fine" },
    ],
    crm: { priority: "MEDIUM" },
  };
  const fixes = applyCaseCorrection(body, ["High", "Medium", "Low"]);
  assert.equal(body.customFields[0].value, "High");
  assert.equal(body.crm.priority, "Medium");
  assert.equal(body.customFields[1].value, "already-fine");
  assert.equal(fixes.length, 2);
  const paths = fixes.map((f) => f.path).sort();
  assert.deepEqual(paths, ["crm.priority", "customFields[0].value"]);
}

// 4. No corrections when nothing matches → returns empty array, body untouched.
{
  const body: any = { name: "Ahmed", value: "something else" };
  const fixes = applyCaseCorrection(body, ["High", "Low"]);
  assert.equal(fixes.length, 0);
  assert.equal(body.value, "something else");
}

// 5. Already-canonical values produce no correction (avoid no-op churn).
{
  const body: any = { value: "High" };
  const fixes = applyCaseCorrection(body, ["High", "Low"]);
  assert.equal(fixes.length, 0);
}

async function asyncCases() {
// 6. requestWithEnumRetry succeeds after a single case-only correction.
{
  const calls: any[] = [];
  let attempt = 0;
  const fakeClient: any = {
    request: async (opts: any) => {
      calls.push(JSON.parse(JSON.stringify(opts.body)));
      attempt++;
      if (attempt === 1) {
        throw {
          code: "client_error",
          status: 400,
          message:
            'Validation error — Field "Customer Interest" must be one of: High, Medium, Low',
          details: {},
        };
      }
      return { data: { ok: true }, status: 200 };
    },
  };
  const body: any = { customFields: [{ fieldId: "x", value: "high" }] };
  const out: any = await requestWithEnumRetry(fakeClient, {
    method: "POST",
    path: "/test",
    body,
  });
  assert.equal(out.data.ok, true);
  assert.equal(attempt, 2);
  assert.equal(calls[0].customFields[0].value, "high");
  assert.equal(calls[1].customFields[0].value, "High");
}

// 7. requestWithEnumRetry coaches when the value isn't a casing variant.
{
  const fakeClient: any = {
    request: async () => {
      throw {
        code: "client_error",
        status: 400,
        message:
          'Validation error — crm.priority: "crm.priority" must be one of [low, high]',
        details: {},
      };
    },
  };
  const body: any = { crm: { priority: "normal" } };
  let thrown: any;
  try {
    await requestWithEnumRetry(fakeClient, { method: "PATCH", path: "/x", body });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "should throw when no casing match");
  assert.equal(thrown.code, "invalid_enum_value");
  assert.match(thrown.message, /only accepts "low" or "high"/);
  assert.match(thrown.message, /ask the user/i);
  assert.deepEqual(thrown.details.allowed, ["low", "high"]);
}

}

// 8. coachJoiError handles the common Joi shapes.
{
  const required = coachJoiError({
    code: "client_error",
    message: 'Validation error — "firstName" is required',
  });
  assert.ok(required);
  assert.equal(required.code, "missing_field");
  assert.match(required.message, /"firstName" field is required/);

  const email = coachJoiError({
    code: "client_error",
    message: '"email" must be a valid email',
  });
  assert.ok(email);
  assert.equal(email.code, "invalid_email");
  assert.match(email.message, /name@example.com/);

  const date = coachJoiError({
    code: "client_error",
    message: '"bookingDate" must be a valid date',
  });
  assert.ok(date);
  assert.equal(date.code, "invalid_date");

  const tooShort = coachJoiError({
    code: "client_error",
    message: '"phone" length must be at least 8 characters long',
  });
  assert.ok(tooShort);
  assert.equal(tooShort.code, "too_short");
  assert.match(tooShort.message, /at least 8 characters/);

  const type = coachJoiError({
    code: "client_error",
    message: '"limit" must be a number',
  });
  assert.ok(type);
  assert.equal(type.code, "invalid_type");

  // Network/auth/precondition errors are NOT coached — they're not Joi-shaped.
  assert.equal(coachJoiError({ code: "network_error", message: "x" }), null);
  assert.equal(coachJoiError({ code: "precondition_failed", message: "x" }), null);
  assert.equal(coachJoiError({ code: "auth_failed", message: "x" }), null);

  // Unrecognized message returns null so the raw error bubbles up.
  assert.equal(
    coachJoiError({ code: "client_error", message: "Internal weirdness" }),
    null
  );
}

asyncCases().then(() => {
  console.log("caseCorrect.test.ts: all assertions passed");
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
