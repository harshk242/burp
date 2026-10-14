export type TokenKind = "string" | "ident" | "number" | "punct";

export interface Token {
  kind: TokenKind;
  /** Source text (strings keep their quotes; quoted identifiers are unquoted). */
  text: string;
  /** True for `"x"`, `` `x` `` and `[x]` identifiers (never keywords). */
  quoted?: boolean;
}

const MULTI_CHAR_OPS = ["||", "<=", ">=", "<>", "!=", "==", "<<", ">>", "->>", "->"];
const OPERATOR_ALIASES: Record<string, string> = { "==": "=", "<>": "!=" };

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (ch === "'") {
      const end = closingQuote(sql, i, "'");
      tokens.push({ kind: "string", text: sql.slice(i, end + 1) });
      i = end + 1;
    } else if (ch === '"' || ch === "`") {
      const end = closingQuote(sql, i, ch);
      tokens.push({ kind: "ident", text: sql.slice(i + 1, end).replaceAll(ch + ch, ch), quoted: true });
      i = end + 1;
    } else if (ch === "[") {
      const end = sql.indexOf("]", i);
      const stop = end === -1 ? sql.length : end;
      tokens.push({ kind: "ident", text: sql.slice(i + 1, stop), quoted: true });
      i = stop + 1;
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(sql[i + 1] ?? ""))) {
      const m = /^(0x[0-9a-f]+|[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?)/i.exec(sql.slice(i))!;
      tokens.push({ kind: "number", text: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_\u0080-￿]/.test(ch)) {
      const m = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/.exec(sql.slice(i))!;
      tokens.push({ kind: "ident", text: m[0] });
      i += m[0].length;
    } else {
      const op = MULTI_CHAR_OPS.find((o) => sql.startsWith(o, i)) ?? ch;
      tokens.push({ kind: "punct", text: op });
      i += op.length;
    }
  }
  return tokens;
}

function closingQuote(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) i += 2;
      else return i;
    } else {
      i++;
    }
  }
  return sql.length;
}

/** Unquoted identifier/keyword match (case-insensitive). */
export function isKeyword(token: Token | undefined, word: string): boolean {
  return token?.kind === "ident" && !token.quoted && token.text.toUpperCase() === word;
}

/** Tokens between the parenthesis at `open` and its match; returns [inner, indexAfterClose]. */
export function balancedParens(tokens: Token[], open: number): [Token[], number] {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== "punct") continue;
    if (t.text === "(") depth++;
    else if (t.text === ")" && --depth === 0) return [tokens.slice(open + 1, i), i + 1];
  }
  return [tokens.slice(open + 1), tokens.length];
}

/**
 * Canonical text for an SQL expression: identifiers unquoted, case-folded and
 * stripped of table qualifiers; keywords case-folded; string literals verbatim;
 * operator aliases unified; redundant outer parens dropped; single spaces.
 */
export function normalizeExpression(input: Token[] | string): string {
  let tokens = typeof input === "string" ? tokenize(input) : input;
  tokens = tokens.filter((t, i) => {
    const next = tokens[i + 1];
    const after = tokens[i + 2];
    return !(t.kind === "ident" && next?.kind === "punct" && next.text === "." && after?.kind === "ident") &&
      !(t.kind === "punct" && t.text === "." && tokens[i - 1]?.kind === "ident" && next?.kind === "ident");
  });
  tokens = stripOuterParens(tokens);
  return tokens
    .map((t) => {
      if (t.kind === "string" || t.kind === "number") return t.text;
      if (t.kind === "ident") return t.text.toLowerCase();
      return OPERATOR_ALIASES[t.text] ?? t.text;
    })
    .join(" ");
}

function stripOuterParens(tokens: Token[]): Token[] {
  while (tokens.length >= 2 && tokens[0]!.kind === "punct" && tokens[0]!.text === "(") {
    const [inner, after] = balancedParens(tokens, 0);
    if (after !== tokens.length) break;
    tokens = inner;
  }
  return tokens;
}
