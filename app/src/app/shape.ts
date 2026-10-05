/**
 * Descreve só a FORMA de um JSON (nomes de campos e tipos, nunca valores) para o Diagnóstico:
 * serve para descobrir o formato real das respostas da Crunchyroll sem expor dados pessoais.
 */
export function shapeOf(v: unknown, depth = 3): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[0]';
    return `[${v.length}]` + (depth > 0 ? ' de ' + shapeOf(v[0], depth - 1) : '');
  }
  switch (typeof v) {
    case 'object': {
      if (depth <= 0) return '{…}';
      const entries = Object.entries(v as Record<string, unknown>);
      const inner = entries
        .slice(0, 30)
        .map(([k, x]) => `${k}:${shapeOf(x, depth - 1)}`)
        .join(',');
      return `{${inner}${entries.length > 30 ? ',…' : ''}}`;
    }
    case 'string':
      return 'txt';
    case 'number':
      return 'num';
    case 'boolean':
      return 'bool';
    default:
      return typeof v;
  }
}
