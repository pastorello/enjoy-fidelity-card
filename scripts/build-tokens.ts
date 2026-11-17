// Usage: npm run tokens
import { readFileSync, writeFileSync } from 'node:fs';
import { buildTokensCss, parseDesignTokens } from './tokens.ts';

const tokens = parseDesignTokens(readFileSync('design/tokens.json', 'utf8'));
writeFileSync('src/styles/tokens.css', buildTokensCss(tokens));
console.log('Wrote src/styles/tokens.css');
