import assert from "node:assert/strict";
import test from "node:test";
import { EquationEditor } from "../src/equation-control.js";

function editor(source: string, format: "latex" | "mathml") {
  const value = new EquationEditor();
  // No DOM is required for the value, validation, conversion, or history APIs.
  value.dispatchEvent = () => true;
  value.Value = { Source: source, Format: format };
  return value;
}

test("equation control converts valid source in both directions with undo", () => {
  const e = editor(String.raw`\frac{a}{b}`, "latex");
  assert.equal(e.ConvertFormat("mathml"), true);
  assert.match(e.Source, /<mfrac>/);
  assert.equal(e.ConvertFormat("latex"), true);
  assert.match(e.Source, /\\frac/);
  assert.equal(e.IsValid, true);
  assert.equal(e.Undo(), true);
  assert.equal(e.Format, "mathml");
  e.Dispose();
});

test("equation control accepts a replacement draft in its newly selected format", () => {
  const e = editor("x^3", "mathml");
  assert.equal(e.ConvertFormat("latex"), true);
  assert.equal(e.Source, "x^3");
  assert.equal(e.Format, "latex");
  assert.equal(e.IsValid, true);
  assert.equal(e.Undo(), true);
  assert.equal(e.Source, "x^3");
  assert.equal(e.Format, "mathml");
  e.Dispose();
});

test("failed equation format conversion preserves draft and history", () => {
  const e = editor(String.raw`\unknownunsafecommand`, "mathml");
  const original = e.Value;
  assert.throws(() => e.ConvertFormat("latex"));
  assert.deepEqual(e.Value, original);
  assert.equal(e.CanUndo, false);
  e.Value = {
    Source: '<math><mpadded width="2em"><mi>x</mi></mpadded></math>',
    Format: "mathml",
  };
  assert.equal(e.Validate(), true);
  assert.throws(() => e.ConvertFormat("latex"));
  assert.equal(e.Format, "mathml");
  assert.equal(e.CanUndo, false);
  e.Dispose();
});

test("equation format conversion honors read-only and rejects unknown formats", () => {
  const e = editor("x^3", "latex");
  e.IsReadOnly = true;
  assert.equal(e.ConvertFormat("mathml"), false);
  assert.equal(e.Format, "latex");
  assert.throws(() => e.ConvertFormat("invalid" as "latex"), /format/);
  e.Dispose();
});
