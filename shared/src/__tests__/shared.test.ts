import { describe, it, expect } from 'vitest';
import { generateBoard, hitTest, tokenBounds, BOARD_W, BOARD_H } from '../board.js';
import { generatePuzzle } from '../puzzle.js';
import { scorePuzzle, applyDelta, PUZZLE_BASE_POINTS, PUZZLE_MAX_BONUS } from '../scoring.js';

describe('generateBoard', () => {
  it('produces the requested count with unique values', () => {
    for (const count of [30, 60, 150]) {
      const tokens = generateBoard(count, 1234);
      expect(tokens).toHaveLength(count);
      expect(new Set(tokens.map((t) => t.value)).size).toBe(count);
    }
  });

  it('keeps every token inside the board', () => {
    const tokens = generateBoard(150, 99);
    for (const t of tokens) {
      const b = tokenBounds(t);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(BOARD_W);
      expect(b.bottom).toBeLessThanOrEqual(BOARD_H);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(generateBoard(40, 7)).toEqual(generateBoard(40, 7));
    expect(generateBoard(40, 7)).not.toEqual(generateBoard(40, 8));
  });

  it('leaves most tokens non-overlapping at a typical count', () => {
    const tokens = generateBoard(60, 42);
    let overlapping = 0;
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const a = tokenBounds(tokens[i]);
        const b = tokenBounds(tokens[j]);
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          overlapping++;
        }
      }
    }
    expect(overlapping).toBe(0);
  });
});

describe('hitTest', () => {
  it('finds the token under its own centre', () => {
    const tokens = generateBoard(60, 5);
    for (const t of tokens) {
      expect(hitTest(tokens, t.x, t.y)?.id).toBe(t.id);
    }
  });

  it('returns null for empty space', () => {
    const tokens = generateBoard(10, 5);
    // Far outside the board.
    expect(hitTest(tokens, -500, -500)).toBeNull();
  });
});

describe('generatePuzzle', () => {
  it('returns tiles that are a permutation of the target', () => {
    for (const len of [4, 6, 8]) {
      const p = generatePuzzle(len, 'alnum', len * 13);
      expect(p.target).toHaveLength(len);
      expect(p.tiles).toHaveLength(len);
      expect(p.tiles.map((t) => t.ch).sort()).toEqual(p.target.split('').sort());
    }
  });

  it('uses distinct characters so exactly one arrangement is correct', () => {
    const p = generatePuzzle(8, 'alnum', 3);
    expect(new Set(p.target.split('')).size).toBe(8);
  });

  it('starts scrambled', () => {
    let scrambledCount = 0;
    for (let seed = 0; seed < 50; seed++) {
      const p = generatePuzzle(6, 'letters', seed);
      if (p.tiles.map((t) => t.ch).join('') !== p.target) scrambledCount++;
    }
    expect(scrambledCount).toBe(50);
  });

  it('letters-only puzzles contain no digits', () => {
    const p = generatePuzzle(6, 'letters', 11);
    expect(/[0-9]/.test(p.target)).toBe(false);
  });
});

describe('scoring', () => {
  it('gives base + full bonus for an instant solve', () => {
    expect(scorePuzzle(0)).toBe(PUZZLE_BASE_POINTS + PUZZLE_MAX_BONUS);
  });

  it('decays the bonus every 5s and never goes below base', () => {
    expect(scorePuzzle(5_000)).toBe(15);
    expect(scorePuzzle(29_999)).toBe(11);
    expect(scorePuzzle(30_000)).toBe(PUZZLE_BASE_POINTS);
    expect(scorePuzzle(600_000)).toBe(PUZZLE_BASE_POINTS);
  });

  it('lets a total go negative so penalties always bite', () => {
    expect(applyDelta(10, -2)).toBe(8);
    expect(applyDelta(1, -2)).toBe(-1);
    expect(applyDelta(0, -5)).toBe(-5);
    expect(applyDelta(-5, -2)).toBe(-7);
    expect(applyDelta(-7, 16)).toBe(9);
  });
});
