// Project-local MyST compatibility transform. MyST currently drops LaTeX
// `cases` environments during Typst export, so convert just the subset of
// LaTeX used by this paper's case expressions into native Typst math.
// This file intentionally has no npm dependencies so uvx builds remain
// reproducible from a clean checkout.
const CASES_BEGIN = String.raw`\begin{cases}`;
const CASES_END = String.raw`\end{cases}`;

const COMMANDS = {
  alpha: 'alpha',
  beta: 'beta',
  delta: 'delta',
  gamma: 'gamma',
  kappa: 'kappa',
  pi: 'pi',
  Sigma: 'Sigma',
  Gamma: 'Gamma',
  infty: 'infinity',
  neq: '!=',
  ne: '!=',
  geq: '>=',
  leq: '<=',
  exp: 'exp',
  cos: 'cos',
  tan: 'tan',
  log: 'log',
  ln: 'ln',
  ii: 'ii',
  Pr: 'Pr',
};

class LatexSubsetConverter {
  constructor(value) {
    this.value = value;
    this.index = 0;
  }

  convert(stop = undefined) {
    let output = '';

    const append = (token) => {
      if (!token) return;
      // TeX treats adjacent letters as separate math atoms, whereas Typst
      // parses them as one identifier (for example, iuX or ii beta).
      if (/[A-Za-z0-9)\]"]$/.test(output) && /^[A-Za-z]/.test(token))
        output += ' ';
      output += token;
    };

    while (this.index < this.value.length) {
      const char = this.value[this.index];
      if (char === stop) {
        this.index += 1;
        break;
      }
      if (/\s/.test(char)) {
        this.index += 1;
        if (output && !output.endsWith(' ')) output += ' ';
        continue;
      }
      if (char === '\\') {
        append(this.convertCommand());
        continue;
      }
      if (char === '{') {
        this.index += 1;
        append(`(${this.convert('}').trim()})`);
        continue;
      }
      if (char === '^' || char === '_') {
        this.index += 1;
        append(`${char}(${this.convertArgument()})`);
        continue;
      }
      if (char === ',') {
        append('comma');
        this.index += 1;
        continue;
      }
      append(char);
      this.index += 1;
    }

    return output.replace(/\s+/g, ' ').trim();
  }

  commandName() {
    this.index += 1;
    const match = this.value.slice(this.index).match(/^[A-Za-z]+/);
    if (match) {
      this.index += match[0].length;
      return match[0];
    }
    const name = this.value[this.index] ?? '';
    this.index += 1;
    return name;
  }

  skipWhitespace() {
    while (/\s/.test(this.value[this.index] ?? '')) this.index += 1;
  }

  rawArgument() {
    this.skipWhitespace();
    if (this.value[this.index] !== '{') {
      const value = this.value[this.index] ?? '';
      this.index += 1;
      return value;
    }

    this.index += 1;
    const start = this.index;
    let depth = 1;
    while (this.index < this.value.length && depth > 0) {
      if (this.value[this.index] === '{' && this.value[this.index - 1] !== '\\')
        depth += 1;
      if (this.value[this.index] === '}' && this.value[this.index - 1] !== '\\')
        depth -= 1;
      this.index += 1;
    }
    return this.value.slice(start, this.index - 1);
  }

  convertArgument() {
    this.skipWhitespace();
    if (this.value[this.index] === '{') {
      return new LatexSubsetConverter(this.rawArgument()).convert();
    }
    if (this.value[this.index] === '\\') return this.convertCommand();

    const value = this.value[this.index] ?? '';
    this.index += 1;
    return value;
  }

  convertDelimiter() {
    this.skipWhitespace();
    if (this.value[this.index] === '\\') {
      const name = this.commandName();
      return { lbrace: '{', rbrace: '}', vert: '|', Vert: '||' }[name] ?? name;
    }
    const delimiter = this.value[this.index] ?? '';
    this.index += 1;
    return delimiter === '.' ? '' : delimiter;
  }

  convertCommand() {
    const name = this.commandName();
    if (COMMANDS[name]) return COMMANDS[name];
    if (['displaystyle', 'textstyle'].includes(name)) return '';
    if ([',', ';', ':', '!', 'quad', 'qquad'].includes(name)) return ' ';
    if (
      ['left', 'right', 'big', 'bigl', 'bigr', 'Big', 'Bigl', 'Bigr'].includes(
        name,
      )
    ) {
      return this.convertDelimiter();
    }
    if (['frac', 'dfrac', 'tfrac'].includes(name)) {
      return `frac(${this.convertArgument()}, ${this.convertArgument()})`;
    }
    if (name === 'sqrt') return `sqrt(${this.convertArgument()})`;
    if (name === 'overset') {
      const above = this.convertArgument();
      const base = this.convertArgument();
      return `overset(${base}, ${above})`;
    }
    if (name === 'operatorname')
      return `op(${JSON.stringify(this.rawArgument().trim())})`;
    if (name === 'text') return JSON.stringify(this.rawArgument().trim());
    if (name === 'mathrm') return `upright(${this.convertArgument()})`;
    if (name === 'mathbb') {
      const value = this.rawArgument().trim();
      return /^[A-Z]$/.test(value) ? value.repeat(2) : value;
    }
    if (name === '&') return 'amp';
    if (['{', '}', '|'].includes(name)) return name;
    return name;
  }
}

function splitTopLevel(value, separator) {
  const parts = [];
  let start = 0;
  let braceDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '{' && value[index - 1] !== '\\') braceDepth += 1;
    if (char === '}' && value[index - 1] !== '\\') braceDepth -= 1;

    if (braceDepth === 0 && value.startsWith(separator, index)) {
      parts.push(value.slice(start, index));
      index += separator.length - 1;
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function convertLatex(value) {
  return new LatexSubsetConverter(value).convert();
}

function convertCasesBody(body) {
  const rows = splitTopLevel(body, String.raw`\\`)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const cells = splitTopLevel(row, '&').map((cell) => convertLatex(cell));
      return cells.length > 1
        ? `${cells[0]} & ${cells.slice(1).join(' ')}`
        : cells[0];
    });

  return `cases(${rows.map((row) => `${row},`).join(' ')})`;
}

function convertMathWithCases(value) {
  let remaining = value;
  let typst = '';

  while (remaining.includes(CASES_BEGIN)) {
    const begin = remaining.indexOf(CASES_BEGIN);
    const end = remaining.indexOf(CASES_END, begin + CASES_BEGIN.length);
    if (end < 0) return undefined;

    typst += `${convertLatex(remaining.slice(0, begin))} `;
    typst += convertCasesBody(remaining.slice(begin + CASES_BEGIN.length, end));
    remaining = remaining.slice(end + CASES_END.length);
  }

  typst += ` ${convertLatex(remaining)}`;
  return typst.trim();
}

const plugin = {
  name: 'Typst cases compatibility',
  transforms: [
    {
      name: 'typst-cases-compatibility',
      stage: 'document',
      plugin: (_, utils) => (tree) => {
        for (const type of ['math', 'inlineMath']) {
          utils.selectAll(type, tree).forEach((node) => {
            if (
              typeof node.value !== 'string' ||
              !node.value.includes(CASES_BEGIN)
            )
              return;
            const typst = convertMathWithCases(node.value);
            if (typst) node.typst = typst;
          });
        }
      },
    },
  ],
};

export default plugin;
