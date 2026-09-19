/** Sandboxed arithmetic AST. References are supplied explicitly; no JavaScript, network or properties. */
export type FormulaValue = number | readonly number[];
export interface FormulaContext {
  ResolveReference?: (name: string, end?: string) => FormulaValue;
}
type Ast =
  | { kind: "number"; value: number }
  | { kind: "ref"; name: string; end?: string }
  | { kind: "unary"; op: string; value: Ast }
  | { kind: "binary"; op: string; left: Ast; right: Ast }
  | { kind: "call"; name: string; args: Ast[] };
interface Token {
  text: string;
  number?: number;
}
function parse(source: string): Ast {
  if (typeof source !== "string" || source.length > 8192)
    throw new RangeError("Formulas are limited to 8,192 characters.");
  const input = source.trim().replace(/^=/, "");
  const tokens: Token[] = [];
  const pattern =
    /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[\p{L}_][\p{L}\p{M}\p{N}_]*|<=|>=|<>|!=|[+\-*/^%=<>(),:]/uy;
  let at = 0;
  while (at < input.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(input);
    if (!match)
      throw new SyntaxError(`Unsupported formula character at ${at + 1}.`);
    at = pattern.lastIndex;
    if (/^\s/.test(match[0])) continue;
    const text = match[0];
    tokens.push(
      /^\d|^\./.test(text) ? { text, number: Number(text) } : { text },
    );
    if (tokens.length > 2048)
      throw new RangeError("Formula token limit exceeded.");
  }
  let cursor = 0,
    depth = 0;
  const peek = () => tokens[cursor]?.text;
  const take = (expected?: string) => {
    const token = tokens[cursor++];
    if (!token || (expected && token.text !== expected))
      throw new SyntaxError(`Expected ${expected ?? "a formula operand"}.`);
    return token;
  };
  const precedence: Record<string, number> = {
    "=": 1,
    "<>": 1,
    "!=": 1,
    "<": 1,
    ">": 1,
    "<=": 1,
    ">=": 1,
    "+": 2,
    "-": 2,
    "*": 3,
    "/": 3,
    "^": 4,
  };
  const expression = (minimum = 1): Ast => {
    if (++depth > 64) throw new RangeError("Formula nesting limit exceeded.");
    const token = take();
    let left: Ast;
    if (token.text === "+" || token.text === "-")
      left = { kind: "unary", op: token.text, value: expression(4) };
    else if (token.text === "(") {
      left = expression();
      take(")");
    } else if (token.number !== undefined)
      left = { kind: "number", value: token.number };
    else if (/^[\p{L}_]/u.test(token.text)) {
      if (peek() === "(") {
        take("(");
        const args: Ast[] = [];
        if (peek() !== ")")
          do {
            args.push(expression());
            if (peek() !== ",") break;
            take(",");
          } while (true);
        take(")");
        const name = token.text.toUpperCase();
        const arities: Record<string, [number, number]> = {
          ABS: [1, 1],
          AND: [1, 1024],
          AVERAGE: [1, 1024],
          COUNT: [1, 1024],
          DEFINED: [1, 1],
          FALSE: [0, 0],
          IF: [3, 3],
          INT: [1, 1],
          MAX: [1, 1024],
          MIN: [1, 1024],
          MOD: [2, 2],
          NOT: [1, 1],
          OR: [1, 1024],
          PRODUCT: [1, 1024],
          ROUND: [2, 2],
          SIGN: [1, 1],
          SUM: [1, 1024],
          TRUE: [0, 0],
        };
        const arity = arities[name];
        if (!arity)
          throw new SyntaxError(`Unsupported formula function: ${name}`);
        if (args.length < arity[0] || args.length > arity[1])
          throw new SyntaxError(`Invalid argument count for ${name}.`);
        left = { kind: "call", name, args };
      } else {
        let end: string | undefined;
        if (peek() === ":") {
          take(":");
          end = take().text;
          if (!/^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(end))
            throw new SyntaxError("Invalid range endpoint.");
        }
        left = { kind: "ref", name: token.text, ...(end ? { end } : {}) };
      }
    } else throw new SyntaxError("Expected a number, reference or function.");
    while (peek() === "%") {
      take("%");
      left = { kind: "unary", op: "%", value: left };
    }
    while ((precedence[peek() ?? ""] ?? 0) >= minimum) {
      const op = take().text,
        rank = precedence[op]!;
      left = {
        kind: "binary",
        op,
        left,
        right: expression(rank + (op === "^" ? 0 : 1)),
      };
    }
    depth--;
    return left;
  };
  const result = expression();
  if (cursor !== tokens.length)
    throw new SyntaxError(`Unexpected formula token: ${peek()}`);
  return result;
}

export function evaluateFormula(
  source: string,
  context: FormulaContext = {},
): number {
  const ast = parse(source);
  let steps = 0,
    referencedValues = 0;
  const finite = (n: number) => {
    if (!Number.isFinite(n))
      throw new RangeError(
        "Formula result is not finite (division by zero or overflow).",
      );
    return n;
  };
  const scalar = (value: FormulaValue): number => {
    if (typeof value === "number") return finite(value);
    if (value.length !== 1)
      throw new TypeError(
        "A scalar formula operand cannot be a multi-cell range.",
      );
    return finite(value[0]!);
  };
  const visit = (node: Ast): FormulaValue => {
    if (++steps > 8192)
      throw new RangeError("Formula evaluation budget exceeded.");
    switch (node.kind) {
      case "number":
        return finite(node.value);
      case "ref": {
        if (!node.end && node.name.toUpperCase() === "TRUE") return 1;
        if (!node.end && node.name.toUpperCase() === "FALSE") return 0;
        if (!context.ResolveReference)
          throw new Error(`Unresolved formula reference: ${node.name}`);
        const result = context.ResolveReference(node.name, node.end);
        referencedValues += typeof result === "number" ? 1 : result.length;
        if (referencedValues > 10000)
          throw new RangeError("Formula references exceed 10,000 values.");
        return result;
      }
      case "unary": {
        const value = scalar(visit(node.value));
        return node.op === "-" ? -value : node.op === "%" ? value / 100 : value;
      }
      case "binary": {
        const a = scalar(visit(node.left)),
          b = scalar(visit(node.right));
        switch (node.op) {
          case "+":
            return finite(a + b);
          case "-":
            return finite(a - b);
          case "*":
            return finite(a * b);
          case "/":
            return finite(a / b);
          case "^":
            return finite(a ** b);
          case "=":
            return Number(a === b);
          case "<>":
          case "!=":
            return Number(a !== b);
          case "<":
            return Number(a < b);
          case ">":
            return Number(a > b);
          case "<=":
            return Number(a <= b);
          case ">=":
            return Number(a >= b);
          default:
            throw new SyntaxError("Unknown formula operator.");
        }
      }
      case "call": {
        const count = (min: number, max = min) => {
          if (node.args.length < min || node.args.length > max)
            throw new SyntaxError(
              `${node.name} expects ${min === max ? min : `${min}–${max}`} arguments.`,
            );
        };
        const arg = (i: number) => scalar(visit(node.args[i]!));
        if (node.name === "IF") {
          count(3);
          return visit(node.args[arg(0) !== 0 ? 1 : 2]!);
        }
        if (node.name === "DEFINED") {
          count(1);
          try {
            scalar(visit(node.args[0]!));
            return 1;
          } catch {
            return 0;
          }
        }
        if (node.name === "TRUE" || node.name === "FALSE") {
          count(0);
          return Number(node.name === "TRUE");
        }
        if (["ABS", "INT", "SIGN", "NOT"].includes(node.name)) {
          count(1);
          const n = arg(0);
          return node.name === "ABS"
            ? Math.abs(n)
            : node.name === "INT"
              ? Math.floor(n)
              : node.name === "SIGN"
                ? Math.sign(n)
                : Number(!n);
        }
        if (node.name === "ROUND") {
          count(2);
          const n = arg(0),
            digits = arg(1);
          if (!Number.isInteger(digits) || Math.abs(digits) > 15)
            throw new RangeError(
              "ROUND precision must be an integer from -15 to 15.",
            );
          const factor = 10 ** digits,
            scaled = Math.abs(n) * factor;
          return finite(
            (Math.sign(n) * Math.round(scaled + Number.EPSILON * scaled)) /
              factor,
          );
        }
        if (node.name === "MOD") {
          count(2);
          const a = arg(0),
            b = arg(1);
          return finite(a - b * Math.floor(a / b));
        }
        if (
          ![
            "SUM",
            "AVERAGE",
            "COUNT",
            "MIN",
            "MAX",
            "PRODUCT",
            "AND",
            "OR",
          ].includes(node.name)
        )
          throw new SyntaxError(`Unsupported formula function: ${node.name}`);
        count(1, 1024);
        const values: number[] = [];
        for (const a of node.args) {
          const v = visit(a),
            items = typeof v === "number" ? [v] : v;
          if (values.length + items.length > 10000)
            throw new RangeError("Formula aggregate exceeds 10,000 values.");
          for (const value of items) values.push(finite(value));
        }
        if (node.name === "COUNT") return values.length;
        if (node.name === "AND") return Number(values.every((v) => v !== 0));
        if (node.name === "OR") return Number(values.some((v) => v !== 0));
        if (!values.length && ["AVERAGE", "MIN", "MAX"].includes(node.name))
          throw new RangeError(`${node.name} has no numeric values.`);
        if (node.name === "MIN") return Math.min(...values);
        if (node.name === "MAX") return Math.max(...values);
        if (node.name === "PRODUCT")
          return finite(values.reduce((a, b) => a * b, 1));
        const sum = finite(values.reduce((a, b) => a + b, 0));
        return node.name === "AVERAGE" ? sum / values.length : sum;
      }
    }
  };
  return scalar(visit(ast));
}
/** Validate grammar without resolving references or evaluating expressions. */
export function validateFormula(source: string): void {
  parse(source);
}
