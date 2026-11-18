/** Characters Enjoy Display lacks (scripts/displayGlyphs.test.ts): a typed name with one uses the body font. */
export const NOT_IN_DISPLAY = /[…«»@#*×→]/;

/** "Maria" of "Maria Rossi": buttons name the customer as the operator calls them. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
