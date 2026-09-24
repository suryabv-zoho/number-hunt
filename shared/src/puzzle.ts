import type { PuzzleCharset, Tile } from './types.js';
import { mulberry32, shuffle } from './rng.js';

const LETTERS = 'abcdefghijkmnopqrstuvwxyz'; // no 'l', reads too much like 1
const DIGITS = '23456789'; // no 0/1, reads too much like o/l

export interface GeneratedPuzzle {
  target: string;
  /** The same characters, in a scrambled order. */
  tiles: Tile[];
}

/**
 * Build a drag puzzle: a short target string like "a2b3", plus its characters
 * handed back shuffled. Characters are distinct so exactly one arrangement is correct.
 */
export function generatePuzzle(
  length: number,
  charset: PuzzleCharset,
  seed: number,
): GeneratedPuzzle {
  const rnd = mulberry32(seed);
  const letters = shuffle(rnd, LETTERS.split(''));
  const digits = shuffle(rnd, DIGITS.split(''));

  const chars: string[] = [];
  if (charset === 'letters') {
    chars.push(...letters.slice(0, length));
  } else {
    // Roughly alternate letters and digits, e.g. a2b3.
    const wantDigits = Math.min(Math.floor(length / 2), digits.length);
    for (let i = 0; i < length; i++) {
      chars.push(i % 2 === 1 && chars.filter((c) => DIGITS.includes(c)).length < wantDigits
        ? digits.pop()!
        : letters.pop()!);
    }
  }

  const target = shuffle(rnd, chars).join('');
  const tiles: Tile[] = target.split('').map((ch, i) => ({ id: `p${i}`, ch }));

  // Scramble until it's actually scrambled (a 1-tile puzzle can't be, but we never make one).
  let scrambled = shuffle(rnd, tiles);
  for (let i = 0; i < 12 && scrambled.map((t) => t.ch).join('') === target; i++) {
    scrambled = shuffle(rnd, tiles);
  }

  return { target, tiles: scrambled };
}
