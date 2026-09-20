import test from "node:test";
import assert from "node:assert/strict";
import { createMailMergePlan } from "../src/mail-merge.js";

test("non-enumerable mail merge option accessors reject without evaluation", () => {
  let calls = 0;
  const options = Object.defineProperty({}, "Locale", {
    get() {
      calls++;
      return "en";
    },
  });
  assert.throws(() => createMailMergePlan([{ A: 1 }], options), /accessors/);
  assert.equal(calls, 0);
});

test("non-enumerable query key accessors reject without evaluation", () => {
  let calls = 0;
  const key = Object.defineProperty({}, "Field", {
    get() {
      calls++;
      return "A";
    },
  }) as { Field: string };
  assert.throws(
    () => createMailMergePlan([{ A: 1 }], { Sort: [key] }),
    /accessors/,
  );
  assert.equal(calls, 0);
});

test("include and exclude arrays reject getter entries without evaluating them", () => {
  let calls = 0;
  const numbers: number[] = [];
  Object.defineProperty(numbers, "0", {
    get() {
      calls++;
      return 1;
    },
  });
  for (const name of ["Include", "Exclude"])
    assert.throws(
      () => createMailMergePlan([{ A: 1 }], { [name]: numbers }),
      /own data/,
    );
  assert.equal(calls, 0);
});

test("query arrays do not execute custom iterators or overridden map methods", () => {
  const fail = () => {
    throw new Error("Input method must not execute");
  };
  const sorts = [{ Field: "A", Type: "Number" as const }];
  const filters = [{ Field: "A", Operator: "NotBlank" as const }];
  const include = [1, 2];
  for (const values of [sorts, filters, include]) {
    Object.defineProperty(values, "map", { value: fail });
    Object.defineProperty(values, Symbol.iterator, { value: fail });
  }
  const result = createMailMergePlan([{ A: 2 }, { A: 1 }], {
    Filters: filters,
    Sort: sorts,
    Include: include,
  });
  assert.deepEqual(
    result.Recipients.map((r) => r.SourceRecord),
    [2, 1],
  );
});

test("non-enumerable unknown query properties are not silently accepted", () => {
  assert.throws(
    () =>
      createMailMergePlan(
        [{ A: 1 }],
        Object.defineProperty({}, "Unknown", { value: true }),
      ),
    /Unknown/,
  );
  assert.throws(
    () =>
      createMailMergePlan([{ A: 1 }], {
        Sort: [
          Object.defineProperty({ Field: "A" }, "descending", { value: true }),
        ],
      }),
    /Unknown/,
  );
});
