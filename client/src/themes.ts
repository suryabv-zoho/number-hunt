/**
 * Theme selection.
 *
 * The colours themselves live in `index.css` — this only decides which set is active,
 * remembers it, and describes them for the picker. Every theme is dark on purpose: see
 * the note at the top of that file.
 */
export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Three colours for the picker's preview chip: page, card, accent. */
  swatch: [string, string, string];
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Deep violet. The original look, with the text contrast fixed.',
    swatch: ['#15122a', '#322c58', '#b3a1ff'],
  },
  {
    id: 'slate',
    name: 'Slate',
    blurb: 'Neutral blue-grey. The quietest of the four over a long match.',
    swatch: ['#12161c', '#2d3643', '#84c7ff'],
  },
  {
    id: 'forest',
    name: 'Forest',
    blurb: 'Deep green with a teal accent.',
    swatch: ['#0f1a17', '#273b33', '#66dcd2'],
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm browns and amber, for low light.',
    swatch: ['#1a1412', '#3b2d28', '#ffb684'],
  },
];

export const DEFAULT_THEME = THEMES[0].id;
const KEY = 'nh.theme';

export function storedTheme(): string {
  try {
    const id = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === id) ? id! : DEFAULT_THEME;
  } catch {
    // Private browsing, blocked storage — the default is still a perfectly good theme.
    return DEFAULT_THEME;
  }
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not worth failing a theme change over.
  }
}
