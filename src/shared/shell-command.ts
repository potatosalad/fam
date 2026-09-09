/** Reconstruct argv for bash/zsh without interpreting expansions or emitting terminal controls. */
export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
    return "$'" + value.replace(/[\\'\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, character => {
      if (character === '\\' || character === "'") return '\\' + character;
      return [...Buffer.from(character)].map(byte => '\\' + byte.toString(8).padStart(3, '0')).join('');
    }) + "'";
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export const shellCommand = (args: string[]): string => ['fam', ...args].map(shellQuote).join(' ');
