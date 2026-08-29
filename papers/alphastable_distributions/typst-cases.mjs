// Project-local MyST compatibility transform. MyST currently drops LaTeX
// `cases` environments during Typst export, translates the TeX shorthand `\|`
// to a single Typst bar, and loses the header semantics of table sections after
// an empty full-width `\multicolumn` separator. Repair those constructs in the
// document tree before export.
// This file intentionally has no npm dependencies so uvx builds remain
// reproducible from a clean checkout.
const CASES_BEGIN = String.raw`\begin{cases}`;
const CASES_END = String.raw`\end{cases}`;
const DOUBLE_BAR = String.raw`\|`;
// Keep a terminating space because the shorthand may be immediately followed
// by a letter (for example `\left\|c`); TeX ignores it after the command name.
const DOUBLE_BAR_NAMED = String.raw`\Vert `;

const COMMANDS = {
  alpha: 'alpha',
  beta: 'beta',
  delta: 'delta',
  gamma: 'gamma',
  kappa: 'kappa',
  pi: 'pi',
  Sigma: 'Sigma',
  Gamma: 'Gamma',
  Vert: 'bar.v.double',
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

function hasVisibleContent(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'thematicBreak') return true;
  if (typeof node.value === 'string' && node.value.trim()) return true;
  return Array.isArray(node.children) && node.children.some(hasVisibleContent);
}

function restoreTableSectionHeaders(tree, utils) {
  utils.selectAll('table', tree).forEach((table) => {
    if (!Array.isArray(table.children)) return;

    for (let index = 1; index < table.children.length; index += 1) {
      const separator = table.children[index - 1];
      const header = table.children[index];
      if (
        separator?.type !== 'tableRow' ||
        header?.type !== 'tableRow' ||
        separator.children?.length !== 1 ||
        separator.children[0]?.type !== 'tableCell' ||
        !(separator.children[0].colspan > 1) ||
        hasVisibleContent(separator.children[0]) ||
        !Array.isArray(header.children)
      )
        continue;

      // LaTeX uses the empty spanning row as a visual section boundary. The
      // SciPy Typst template suppresses horizontal rules after the first row,
      // so make this particular rule cell content instead. A thematic break is
      // rendered as a full-width line by both HTML and Typst exporters.
      separator.children[0].children = [{ type: 'thematicBreak' }];

      // MyST otherwise treats the next section header as ordinary body data.
      header.children.forEach((cell) => {
        if (!Array.isArray(cell.children) || cell.children.length === 0) return;
        if (
          cell.children.length === 1 &&
          cell.children[0]?.type === 'strong'
        )
          return;
        cell.children = [{ type: 'strong', children: cell.children }];
      });

      const columnCount = header.children.reduce(
        (count, cell) => count + (cell.colspan ?? 1),
        0,
      );
      table.children.splice(index + 1, 0, {
        type: 'tableRow',
        children: [
          {
            type: 'tableCell',
            colspan: columnCount,
            align: 'center',
            children: [{ type: 'thematicBreak' }],
          },
        ],
      });
      index += 1;
    }
  });
}

const plugin = {
  name: 'MyST LaTeX compatibility',
  transforms: [
    {
      name: 'typst-cases-compatibility',
      stage: 'document',
      plugin: (_, utils) => (tree) => {
        restoreTableSectionHeaders(tree, utils);

        for (const type of ['math', 'inlineMath']) {
          utils.selectAll(type, tree).forEach((node) => {
            if (typeof node.value !== 'string') return;

            // MyST's Typst converter knows the named `\Vert` command, but its
            // equivalent TeX shorthand `\|` currently falls through as `|`.
            node.value = node.value.replaceAll(DOUBLE_BAR, DOUBLE_BAR_NAMED);

            if (!node.value.includes(CASES_BEGIN)) return;
            const typst = convertMathWithCases(node.value);
            if (typst) node.typst = typst;
          });
        }
      },
    },
  ],
};

export default plugin;
