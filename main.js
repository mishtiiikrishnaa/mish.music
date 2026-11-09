'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   mish.music
   a powerline prompt + a now-playing card, as a sidebar view.
   it shows (and controls) whatever is playing in music.app, or in a safari tab
   on youtube / soundcloud / jiosaavn (the list is in settings).
   dressed like mish.eza and mish.fastfetch: same prompt, same rainbow ring,
   same palette variables, same bundled font.

   two looks, one player: "player" (cover art, icons, sliders) and "terminal" (the old
   mpv-style screen: a flags line, block progress bar, commands as words, and a command
   line you can type into). switch from the card itself, from settings, or from the
   command palette. both are always painted, so switching is instant.

   how it talks to the mac: osascript (JavaScript for Automation), spawned from
   obsidian's node side. nothing is installed, nothing runs in the background
   when the panel is hidden.

   nearly everything about how it looks is a setting, the same way as in mish.eza: the
   six rainbow colours (with presets), pill text colour, pill shape, border, corner
   radius, margin, position, text size, cover art, bars, play button, motion and font.

   the volume bar is the mac's own output volume (the one the menu bar and the keyboard
   change), not the volume inside the player. a setting can switch it back.

   the card has a FIXED size. shuffle, repeat, a long title, a missing cover or
   an error message never move or resize anything: only colours and text change.
   ═══════════════════════════════════════════════════════════════════════ */

const { Plugin, ItemView, PluginSettingTab, Setting, Notice, Platform, setIcon } = require('obsidian');

let cp = null;
let fs = null;
let nodeOs = null;
let nodePath = null;
try {
  cp = require('child_process');
  fs = require('fs');
  nodeOs = require('os');
  nodePath = require('path');
} catch (e) { /* not desktop: the manifest says isDesktopOnly, so this is just a safety net */ }

const VIEW_TYPE = 'mm-music-view';
const RAINBOW_ID = 'mish-music-rainbow-defs';
const PREFER = ['auto', 'music', 'safari'];
const SHAPES = ['arrow', 'round', 'flat'];
const LOOKS = ['card', 'terminal'];
const LOOK_NAME = 'player';        /* what the card look is called everywhere you can see it */
const POLLS = [1, 2, 3, 5];
const RINGS = ['rainbow', 'accent', 'subtle', 'none'];
const ALIGN_H = ['centre', 'left'];
const ALIGN_V = ['centre', 'top'];
const BAR_STYLES = ['rainbow', 'accent', 'solid'];
const PLAYS = ['gradient', 'solid', 'ghost'];
const VOLS = ['system', 'player'];
const WIDTHS = ['fastfetch', 'fixed'];
const HEX = /^#[0-9a-f]{6}$/i;

/* ── the rainbow ─────────────────────────────────────────────────────────
   six colours, in this order everywhere: the prompt pills, the song lines, the
   progress bar, the card border, the scrollbar and the sidebar tab icon read from them.
   a slot is a few css variables: the theme's own (vf), the fill this plugin ships
   (f: pills, border, bars) and the text version (t: text, icons; darker in light
   mode, `dark` = how much, copied from styles.css). */
const SLOTS = [
  { name: 'pink',   vf: '--vf-pink-hi', f: '--mz-f-pink-hi', t: '--mz-pink-hi', dark: 40, used: 'user pill, song title, where the border starts' },
  { name: 'peach',  vf: '--vf-peach',   f: '--mz-f-peach',   t: '--mz-peach',   dark: 42, used: 'path pill, artist name' },
  { name: 'yellow', vf: '--vf-yellow',  f: '--mz-f-yellow',  t: '--mz-yellow',  dark: 50, used: 'first chevron, the progress bar' },
  { name: 'green',  vf: '--vf-green',   f: '--mz-f-green',   t: '--mz-green',   dark: 48, used: 'second chevron, the playing light, shuffle when on' },
  { name: 'blue',   vf: '--vf-blue',    f: '--mz-f-blue',    t: '--mz-blue',    dark: 40, used: 'third chevron, elapsed time, repeat when on' },
  { name: 'lilac',  vf: '--vf-lilac',   f: '--mz-f-lilac', t: '--mz-lilac', dark: 38, used: 'source pill, where the border ends' },
];

/* what the plugin draws with when "mish" (follows your theme) is picked */
const DARK_FILLS  = ['#ffa6c9', '#ffd6a6', '#fff1a8', '#c9ffa6', '#a6c9ff', '#c9b0ff'];
const LIGHT_FILLS = ['#ff8fb8', '#ffb27a', '#ffd54f', '#8ee07f', '#82b4ff', '#b79bff'];

const PALETTES = {
  catppuccin: ['#f5c2e7', '#fab387', '#f9e2af', '#a6e3a1', '#89b4fa', '#cba6f7'],
  dracula:    ['#ff79c6', '#ffb86c', '#f1fa8c', '#50fa7b', '#8be9fd', '#bd93f9'],
  nord:       ['#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#81a1c1', '#b48ead'],
  gruvbox:    ['#fb4934', '#fe8019', '#fabd2f', '#b8bb26', '#83a598', '#d3869b'],
  ocean:      ['#c4f1f9', '#7fe0e8', '#6fd3c2', '#7bc6f0', '#82a8ff', '#a98bff'],
  sunset:     ['#ff8fa3', '#ff9e6b', '#ffc15e', '#ff7eb6', '#e08bff', '#b794ff'],
  forest:     ['#e6c9a8', '#d9b26f', '#e3e08a', '#9fd58a', '#6fc2a0', '#7fa8c9'],
  greyscale:  ['#f5f5f5', '#dcdcdc', '#c4c4c4', '#a8a8a8', '#8c8c8c', '#707070'],
};

/* ── lowercase ui ────────────────────────────────────────────────────────
   the text in the settings tab is written in lowercase, to match the terminal look.
   with the "lowercase ui" setting off, ui() shows it in sentence case instead (a capital
   at the start of each sentence, plus the few names that need one). only text that
   obsidian itself shows goes through ui(): the settings tab, its tooltips and its
   messages. the card and the terminal are always lowercase. */
const uiCase = { lower: true };

const PROPER = [
  [/\bcmu typewriter\b/g, 'CMU Typewriter'],
  [/\bobsidian\b/g, 'Obsidian'],
  [/\bcss\b/g, 'CSS'],
  [/\bui\b/g, 'UI'],
  [/\bmacos\b/g, 'macOS'],
  [/\bapple\b/g, 'Apple'],
  [/\bjavascript\b/g, 'JavaScript'],
  [/\bmusic\.app\b/g, 'Music.app'],
  [/\bsafari\b/g, 'Safari'],
  [/\bmish\b(?!\.[a-z])/g, 'Mish'],      /* the palette, not mish.music / mish.eza */
  [/\bmish\.(music|eza|fastfetch)\b/g, 'mish.$1'],
];

/* commands stay lowercase even at the start of a sentence */
const KEEP_LOWER = new Set(['help', 'vol', 'louder', 'quieter', 'prefer', 'macOS']);

const sentence = (text) => {
  let out = String(text);
  for (const [re, name] of PROPER) out = out.replace(re, name);
  return out.replace(/(^|[.!?]\s+)([a-z][\w-]*)/g, (m, lead, word) => (
    KEEP_LOWER.has(word) ? m : lead + word.charAt(0).toUpperCase() + word.slice(1)
  ));
};

const ui = (text) => (uiCase.lower ? text : sentence(text));

const uiOptions = (options) => Object.fromEntries(
  Object.entries(options).map(([key, label]) => [key, ui(label)])
);

/* a Setting whose name and description go through ui() */
class UiSetting extends Setting {
  setName(name) { return super.setName(typeof name === 'string' ? ui(name) : name); }
  setDesc(desc) { return super.setDesc(typeof desc === 'string' ? ui(desc) : desc); }
}

const DEFAULT_SETTINGS = {
  sources: { music: true, safari: true },
  look: 'card',                   /* card | terminal. two ways of drawing the same player */
  prefer: 'auto',                 /* auto | music | safari. click the source pill to cycle */
  sites: 'youtube.com, youtu.be, soundcloud.com, jiosaavn.com',
  poll: 2,                        /* seconds between looks at the player (the bar moves smoothly in between) */
  pillShape: 'arrow',
  pathLabel: '~/music',
  username: '',                   /* empty = auto-detect */
  cardWidth: 300,                 /* px. fixed on purpose, resizing the sidebar just moves the card */
  cardWidthFrom: 'fastfetch',     /* fastfetch | fixed. fastfetch = copy mish.fastfetch's width (when it is open), else cardWidth */
  showArt: true,
  showVolume: true,
  volumeFrom: 'system',           /* system | player. the bar is the mac's output volume, or the player's own */

  /* ── looks (all of these are in settings > mish.music) ── */
  lowercaseUi: true,              /* settings text in lowercase (true) or sentence case (false) */
  font: 'bundled',                /* bundled | obsidian | system | family:<name> | custom */
  customFont: '',

  /* the rainbow: preset = theme | custom | one of PALETTES. colours are the six fills.
     `theme` is the default and is shown in the settings as "mish". */
  palette: { preset: 'theme', colours: DARK_FILLS.slice() },
  inkColour: '',                  /* text on the pills. empty = automatic (dark ink) */

  pills: { user: true, path: true, source: true },

  card: {
    hAlign: 'centre',             /* centre | left */
    vAlign: 'centre',             /* centre | top */
    ring: 'rainbow',              /* rainbow | accent | subtle | none */
    ringWidth: 1,
    angle: 135,                   /* degrees, for the rainbow border */
    radius: 10,
    pad: 10,                      /* space between the card and the edge of the sidebar */
    textSize: 100,                /* percent */
  },

  art: { size: 72, radius: 10, ring: true },

  bars: {
    style: 'rainbow',             /* rainbow | accent | solid: the progress and volume fill */
    height: 5,
    play: 'gradient',             /* gradient | solid | ghost: the play button (card look) */
  },

  motion: { marquee: true, animate: true },
};

/* ── small helpers ───────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const clone = (o) => JSON.parse(JSON.stringify(o));
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

const deepMerge = (base, over) => {
  const out = Object.assign({}, base);
  if (!isPlain(over)) return out;
  for (const k of Object.keys(over)) {
    out[k] = isPlain(base[k]) && isPlain(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
};

/* a data.json from an older version, or one edited by hand, must never break the panel */
const sanitise = (cfg) => {
  if (!PREFER.includes(cfg.prefer)) cfg.prefer = 'auto';
  if (!SHAPES.includes(cfg.pillShape)) cfg.pillShape = 'arrow';
  if (!LOOKS.includes(cfg.look)) cfg.look = 'card';
  if (!VOLS.includes(cfg.volumeFrom)) cfg.volumeFrom = 'system';
  if (!WIDTHS.includes(cfg.cardWidthFrom)) cfg.cardWidthFrom = 'fastfetch';
  if (!POLLS.includes(Number(cfg.poll))) cfg.poll = 2;
  cfg.poll = Number(cfg.poll);
  cfg.cardWidth = num(cfg.cardWidth, 240, 380, 300);
  cfg.sites = String(cfg.sites || '');
  cfg.pathLabel = String(cfg.pathLabel || '~/music');
  cfg.username = String(cfg.username || '');

  /* groups: anything that is not a plain object goes back to the default */
  for (const g of ['sources', 'palette', 'pills', 'card', 'art', 'bars', 'motion']) {
    if (!isPlain(cfg[g])) cfg[g] = clone(DEFAULT_SETTINGS[g]);
  }

  const p = cfg.palette;
  if (p.preset !== 'theme' && p.preset !== 'custom' && !PALETTES[p.preset]) p.preset = 'theme';
  if (!Array.isArray(p.colours) || p.colours.length !== 6 || !p.colours.every((c) => HEX.test(c))) {
    p.colours = DARK_FILLS.slice();
  }
  if (!HEX.test(cfg.inkColour)) cfg.inkColour = '';
  cfg.lowercaseUi = cfg.lowercaseUi !== false;
  cfg.font = String(cfg.font || 'bundled');
  cfg.customFont = String(cfg.customFont || '');

  for (const k of ['user', 'path', 'source']) cfg.pills[k] = cfg.pills[k] !== false;

  const c = cfg.card;
  if (!ALIGN_H.includes(c.hAlign)) c.hAlign = 'centre';
  if (!ALIGN_V.includes(c.vAlign)) c.vAlign = 'centre';
  if (!RINGS.includes(c.ring)) c.ring = 'rainbow';
  c.ringWidth = num(c.ringWidth, 1, 4, 1);
  c.angle = num(c.angle, 0, 360, 135);
  c.radius = num(c.radius, 0, 28, 10);
  c.pad = num(c.pad, 0, 32, 10);
  c.textSize = num(c.textSize, 80, 120, 100);

  cfg.art.size = num(cfg.art.size, 48, 96, 72);
  cfg.art.radius = num(cfg.art.radius, 0, 48, 10);
  cfg.art.ring = cfg.art.ring !== false;

  if (!BAR_STYLES.includes(cfg.bars.style)) cfg.bars.style = 'rainbow';
  if (!PLAYS.includes(cfg.bars.play)) cfg.bars.play = 'gradient';
  cfg.bars.height = num(cfg.bars.height, 3, 10, 5);

  cfg.motion.marquee = cfg.motion.marquee !== false;
  cfg.motion.animate = cfg.motion.animate !== false;
  return cfg;
};

/* titles from web pages sometimes start with invisible characters (zero-width marks, blank
   fillers, no-break spaces). they take up a character's width and look like an indent. */
const tidy = (text) => String(text == null ? '' : text)
  .replace(/[\u00A0\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFEFF\uFFA0]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const lightTheme = () => document.body.classList.contains('theme-light');
const themeFills = () => (lightTheme() ? LIGHT_FILLS : DARK_FILLS).slice();

/* the six colours to draw with, or null when the theme decides */
const customColours = (cfg) => {
  const p = cfg && cfg.palette;
  return p && p.preset !== 'theme' && Array.isArray(p.colours) && p.colours.length === 6 && p.colours.every((c) => HEX.test(c))
    ? p.colours : null;
};

/* css variables for the colours. a custom palette sets the plugin's own fills and text
   colours, and tells the theme's --vf-* to step aside (`initial` = "not set", so the
   fallbacks win). in light mode the text colour is the fill darkened, the same way
   styles.css does it for the default palette. */
const paletteVars = (cfg) => {
  const v = {};
  const colours = customColours(cfg);
  if (colours) {
    const light = lightTheme();
    SLOTS.forEach((s, i) => {
      v[s.vf] = 'initial';
      v[s.f] = colours[i];
      v[s.t] = light ? 'color-mix(in oklab, ' + colours[i] + ', black ' + s.dark + '%)' : colours[i];
    });
  }
  if (HEX.test(cfg.inkColour)) {
    v['--vf-black'] = 'initial';
    v['--mz-ink'] = cfg.inkColour;
  }
  return v;
};

/* css variables for sizes, the border and the bars. every one has the old fixed value as
   its fallback in styles.css, so the defaults look exactly as before. */
const layoutVars = (cfg) => {
  const c = cfg.card;
  const a = cfg.art;
  const b = cfg.bars;
  const v = {
    '--mm-w': num(cfg.cardWidth, 240, 380, 300) + 'px',
    '--mm-radius': num(c.radius, 0, 28, 10) + 'px',
    '--mm-pad': num(c.pad, 0, 32, 10) + 'px',
    '--mm-angle': num(c.angle, 0, 360, 135) + 'deg',
    '--mm-scale': String(num(c.textSize, 80, 120, 100) / 100),
    '--mm-mt': c.vAlign === 'top' ? '0' : 'auto',
    '--mm-ml': c.hAlign === 'left' ? '0' : 'auto',
    '--mm-art': num(a.size, 48, 96, 72) + 'px',
    '--mm-art-r': num(a.radius, 0, 48, 10) + 'px',
    '--mm-art-ring': a.ring === false ? '0px' : '1px',
    '--mm-seek-h': num(b.height, 3, 10, 5) + 'px',
  };
  const w = num(c.ringWidth, 1, 4, 1) + 'px';
  if (c.ring === 'none') {
    v['--mm-ring-w'] = '0px';
  } else if (c.ring === 'accent') {
    v['--mm-ring-w'] = w;
    v['--mm-ring-bg'] = 'var(--interactive-accent)';
  } else if (c.ring === 'subtle') {
    v['--mm-ring-w'] = w;
    v['--mm-ring-bg'] = 'var(--background-modifier-border)';
  } else {
    v['--mm-ring-w'] = w;                 /* rainbow: the gradient in styles.css */
  }
  if (b.style === 'accent') v['--mm-fill'] = 'var(--interactive-accent)';
  else if (b.style === 'solid') v['--mm-fill'] = 'var(--vf-pink-hi, var(--mz-f-pink-hi))';
  return v;
};

/* sets the variables, and clears ones set last time that are no longer wanted */
const applyVars = (node, vars) => {
  for (const name of node.__mmVars || []) {
    if (!(name in vars)) node.style.removeProperty(name);
  }
  for (const name of Object.keys(vars)) node.style.setProperty(name, vars[name]);
  node.__mmVars = Object.keys(vars);
};

/* ── fonts ───────────────────────────────────────────────────────────────
   the card ships its own typewriter face (embedded in styles.css), so the
   default needs nothing installed. the settings can swap it for a font from
   the user's own machine. */

/* well-known monospace fonts, checked quietly with no permission needed */
const CANDIDATE_FONTS = [
  'SF Mono', 'Menlo', 'Monaco', 'Andale Mono', 'Consolas', 'Lucida Console', 'Cascadia Code',
  'Cascadia Mono', 'Courier New', 'JetBrains Mono', 'Fira Code', 'Fira Mono', 'Source Code Pro',
  'IBM Plex Mono', 'Roboto Mono', 'Hack', 'Inconsolata', 'Ubuntu Mono', 'DejaVu Sans Mono',
  'Liberation Mono', 'Noto Sans Mono', 'Iosevka', 'Victor Mono', 'Space Mono', 'CMU Typewriter Text',
  'MesloLGS NF',
];

const quoteFont = (name) => '"' + String(name).replace(/["\\]/g, '') + '"';

let measureCtx = null;
const textWidth = (family, text) => {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = '64px ' + family;
  return measureCtx.measureText(text).width;
};

/* installed = drawing with it differs from every plain fallback */
const isInstalled = (name) => ['monospace', 'serif', 'sans-serif'].some(
  (base) => textWidth(quoteFont(name) + ', ' + base, 'mmmmmmmmmmlli') !== textWidth(base, 'mmmmmmmmmmlli')
);

/* monospace = narrow and wide letters take the same room */
const isMono = (name) => {
  const f = quoteFont(name) + ', monospace';
  return Math.abs(textWidth(f, 'iiiiiiiiii') - textWidth(f, 'mmmmmmmmmm')) < 0.5 &&
    Math.abs(textWidth(f, 'llllllllll') - textWidth(f, 'WWWWWWWWWW')) < 0.5;
};

/* asks chromium for every installed family (it may ask permission first) and
   keeps the monospace ones. returns null when this version can't do it. */
const scanSystemFonts = async () => {
  if (typeof window.queryLocalFonts !== 'function') return null;
  const fonts = await window.queryLocalFonts();
  const families = Array.from(new Set(fonts.map((f) => f.family)));
  return families
    .filter((name) => !/symbols|emoji|icons|dingbats|wingdings|webdings/i.test(name))
    .filter((name) => isInstalled(name) && isMono(name))
    .sort((a, b) => a.localeCompare(b));
};

/* the font-family to put in --vf-mono, or null to leave the css default
   (the bundled face, or whatever a theme sets) alone */
const fontStack = (cfg) => {
  switch (cfg.font) {
    case 'obsidian': return 'var(--font-monospace), ui-monospace, monospace';
    case 'system': return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    case 'custom': return cfg.customFont.trim() || null;
    default:
      return cfg.font.indexOf('family:') === 0
        ? quoteFont(cfg.font.slice(7)) + ', ui-monospace, monospace'
        : null;
  }
};


const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/* only touches the dom when the text really changed. returns true if it did */
const setText = (node, text) => {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
};

/* m:ss. the minutes just keep counting (62:03), so the label never gets a new width */
const fmtTime = (secs) => {
  let s = Number(secs);
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  return Math.floor(s / 60) + ':' + pad(s % 60);
};

const detectUser = () => {
  try { return (nodeOs.userInfo().username || 'user').toLowerCase(); } catch (e) { return 'user'; }
};

const hostOf = (url) => {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase().replace(/:\d+$/, '') : '';
};

const hostList = (text) => String(text || '')
  .split(/[,\s]+/)
  .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .filter(Boolean);

/* what the source pill says for a tab: youtube, yt music, soundcloud... */
const siteLabel = (url) => {
  const host = hostOf(url).replace(/^www\./, '');
  if (host === 'music.youtube.com') return 'yt music';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  const parts = host.split('.');
  return (parts.length > 1 ? parts[parts.length - 2] : parts[0]) || 'safari';
};

/* a youtube thumbnail, for when the page doesn't hand us cover art */
const ytThumb = (url) => {
  const m = /[?&]v=([\w-]{11})/.exec(url) || /youtu\.be\/([\w-]{11})/.exec(url);
  return m ? 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' : '';
};

/* ── rainbow gradient for our own icons ──────────────────────────────────
   a hidden svg holds the gradient; styles.css points `stroke` at it. the stops are
   real colours (not var() text), repainted on every theme change, because a gradient
   stop that only holds `var(...)` never notices the theme flipping. */
const STOPS = SLOTS.map((s, i) => [s.vf, s.t, DARK_FILLS[i]]);

const resolveColour = (css) => {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;color:' + css;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
};

/* `cfg` = the settings: a custom palette paints the gradient with its own colours */
const paintRainbow = (cfg) => {
  const svg = document.getElementById(RAINBOW_ID);
  if (!svg) return;
  const colours = customColours(cfg);
  const light = lightTheme();
  svg.querySelectorAll('stop').forEach((stop, i) => {
    const [vf, mz, fallback] = STOPS[i];
    const css = colours
      ? (light ? 'color-mix(in oklab, ' + colours[i] + ', black ' + SLOTS[i].dark + '%)' : colours[i])
      : 'var(' + vf + ', var(' + mz + ', ' + fallback + '))';
    stop.style.stopColor = resolveColour(css) || css;
  });
};

const mountRainbow = (cfg) => {
  let svg = document.getElementById(RAINBOW_ID);
  if (!svg) {
    const NS = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(NS, 'svg');
    svg.id = RAINBOW_ID;
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const defs = document.createElementNS(NS, 'defs');
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.id = 'mish-music-rainbow';
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');   /* lucide icons live in a 24x24 box */
    grad.setAttribute('x1', '2');
    grad.setAttribute('y1', '2');
    grad.setAttribute('x2', '22');
    grad.setAttribute('y2', '22');
    STOPS.forEach((s, i) => {
      const stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('offset', String(i / (STOPS.length - 1)));
      grad.appendChild(stop);
    });
    defs.appendChild(grad);
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }
  svg.dataset.users = String(Number(svg.dataset.users || 0) + 1);
  paintRainbow(cfg);
};

const unmountRainbow = () => {
  const svg = document.getElementById(RAINBOW_ID);
  if (!svg) return;
  const left = Number(svg.dataset.users || 1) - 1;
  if (left <= 0) svg.remove();
  else svg.dataset.users = String(left);
};

/* ── keep the whole prompt visible (same idea as mish.fastfetch) ────────── */
const fitBar = (bar, watch) => {
  const FLOOR = 0.5;
  let queued = false;
  const fit = () => {
    bar.style.zoom = '';
    const have = bar.clientWidth;
    const need = bar.scrollWidth;
    if (!have || need <= have + 1) return;
    bar.style.zoom = String(Math.max(FLOOR, have / need));
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fit(); });
  };
  const ro = new ResizeObserver(schedule);
  watch.forEach((node) => ro.observe(node));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  schedule();
  schedule.dispose = () => ro.disconnect();
  return schedule;
};

/* ── rainbow scrollbar (same as the other two) ───────────────────────── */
const rainbowBar = (scroller) => {
  const parent = scroller.parentElement;
  const sb = el('div', 'mm-sb');
  const thumb = el('div', 'mm-sb-thumb');
  sb.appendChild(thumb);
  parent.appendChild(sb);

  const update = () => {
    const { scrollHeight, clientHeight, scrollTop, offsetTop, offsetHeight } = scroller;
    if (!offsetHeight || scrollHeight <= clientHeight + 1) { sb.style.display = 'none'; return; }
    sb.style.display = 'block';
    sb.style.top = offsetTop + 'px';
    sb.style.height = clientHeight + 'px';
    const h = Math.max(24, (clientHeight * clientHeight) / scrollHeight);
    const y = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - h);
    thumb.style.height = h + 'px';
    thumb.style.transform = 'translateY(' + y + 'px)';
  };
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  };
  scroller.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(schedule);
  ro.observe(scroller);
  const mo = new MutationObserver(schedule);
  mo.observe(scroller, { childList: true, subtree: true, characterData: true });

  sb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startTop = scroller.scrollTop;
    const ratio = (scroller.scrollHeight - scroller.clientHeight) /
      Math.max(1, scroller.clientHeight - thumb.offsetHeight);
    sb.setPointerCapture(e.pointerId);
    const move = (ev) => { scroller.scrollTop = startTop + (ev.clientY - startY) * ratio; };
    const up = () => {
      sb.removeEventListener('pointermove', move);
      sb.removeEventListener('pointerup', up);
      sb.removeEventListener('pointercancel', up);
    };
    sb.addEventListener('pointermove', move);
    sb.addEventListener('pointerup', up);
    sb.addEventListener('pointercancel', up);
  });
  schedule();
  return () => { ro.disconnect(); mo.disconnect(); };
};

/* ═══════════════════════════════════════════════════════════════════════
   talking to macos
   ═══════════════════════════════════════════════════════════════════════ */

const OSA = '/usr/bin/osascript';

const runOsa = (args, timeout) => new Promise((resolve) => {
  if (!cp) { resolve({ ok: false, err: 'child_process is not available' }); return; }
  try {
    cp.execFile(OSA, args, { timeout: timeout || 8000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, err: String(stderr || error.message || error) });
      else resolve({ ok: true, out: String(stdout || '').trim() });
    });
  } catch (e) {
    resolve({ ok: false, err: String(e) });
  }
});

/* runs a JXA script that defines run() and returns a string (usually json) */
const runJxa = async (script, timeout) => {
  const r = await runOsa(['-l', 'JavaScript', '-e', script], timeout);
  if (!r.ok) return r;
  let data = r.out;
  try {
    data = JSON.parse(data);
    if (typeof data === 'string') data = JSON.parse(data);
  } catch (e) { /* plain text such as: ok */ }
  return { ok: true, data };
};

const DENIED = /-1743|not authori[sz]ed/i;
const JS_OFF = /javascript from apple events/i;

/* ── music.app ─────────────────────────────────────────────────────────── */

const MUSIC_POLL = `
function run() {
  const M = Application('Music');
  if (!M.running()) return JSON.stringify({ running: false });
  const out = { running: true, state: 'stopped' };
  try { out.state = String(M.playerState()); } catch (e) { if (/-1743|not authori/i.test(String(e))) out.denied = true; }
  try { out.vol = M.soundVolume(); } catch (e) {}
  try { out.shuffle = M.shuffleEnabled(); } catch (e) {}
  try { out.repeat = String(M.songRepeat()); } catch (e) {}
  try { out.pos = M.playerPosition(); } catch (e) {}
  try {
    const t = M.currentTrack;
    out.track = { name: String(t.name()), artist: String(t.artist()), album: String(t.album()), dur: t.duration(), id: String(t.databaseID()) };
  } catch (e) {}
  return JSON.stringify(out);
}`;

const musicCmdScript = (cmd, arg) => `
function run() {
  const M = Application('Music');
  if (!M.running()) return 'off';
  const cmd = ${JSON.stringify(cmd)};
  const arg = ${JSON.stringify(arg == null ? null : arg)};
  if (cmd === 'toggle') M.playpause();
  else if (cmd === 'next') M.nextTrack();
  else if (cmd === 'prev') { if (M.playerPosition() > 3) M.backTrack(); else M.previousTrack(); }
  else if (cmd === 'stop') { M.pause(); try { M.playerPosition = 0; } catch (e) {} }
  else if (cmd === 'seek') M.playerPosition = arg;
  else if (cmd === 'vol') M.soundVolume = Math.round(arg * 100);
  else if (cmd === 'shuffle') M.shuffleEnabled = !M.shuffleEnabled();
  else if (cmd === 'repeat') M.songRepeat = arg;
  return 'ok';
}`;

/* writes the current track's cover to a file (applescript is the only thing that can read the bytes) */
const musicArtScript = (file) => `
set outFile to POSIX file ${JSON.stringify(file)}
set theData to missing value
tell application "Music"
  if player state is stopped then return "none"
  try
    set theData to raw data of artwork 1 of current track
  on error
    return "none"
  end try
end tell
if theData is missing value then return "none"
try
  set fileRef to open for access outFile with write permission
  set eof fileRef to 0
  write theData to fileRef starting at 0
  close access fileRef
  return "ok"
on error errMsg
  try
    close access outFile
  end try
  return "err " & errMsg
end try`;

/* cover bytes -> a blob url, whatever the format. some versions put a short header in front, so look for the magic bytes */
const coverBlob = (buf) => {
  const sig = (sigBytes, from) => {
    for (let i = from; i < Math.min(buf.length - sigBytes.length, 700); i++) {
      let ok = true;
      for (let j = 0; j < sigBytes.length; j++) if (buf[i + j] !== sigBytes[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  };
  let type = '';
  let at = -1;
  if ((at = sig([0xff, 0xd8, 0xff], 0)) >= 0) type = 'image/jpeg';
  else if ((at = sig([0x89, 0x50, 0x4e, 0x47], 0)) >= 0) type = 'image/png';
  if (!type) return '';
  return URL.createObjectURL(new Blob([buf.subarray(at)], { type }));
};

/* ── safari ────────────────────────────────────────────────────────────── */

/* these two run INSIDE the safari tab (they are turned into text with toString).
   written as plain functions so they can be syntax-checked like normal code. */
function probeMedia() {
  try {
    var m = document.querySelector('video.html5-main-video') || document.querySelector('video') || document.querySelector('audio');
    if (!m) return JSON.stringify({ none: 1 });
    var md = (navigator.mediaSession && navigator.mediaSession.metadata) || null;
    var art = '';
    if (md && md.artwork && md.artwork.length) art = md.artwork[md.artwork.length - 1].src || '';
    var title = (md && md.title) || '';
    var artist = (md && md.artist) || '';
    var album = (md && md.album) || '';
    if (!title) title = document.title.replace(/\s*[-|\u2013]\s*YouTube( Music)?$/i, '');
    if (!artist) {
      var c = document.querySelector('ytd-video-owner-renderer ytd-channel-name a, #owner #channel-name a, ytmusic-player-bar .byline');
      if (c) artist = (c.textContent || '').trim();
    }
    var d = m.duration;
    return JSON.stringify({
      p: !m.paused && !m.ended, t: m.currentTime || 0, d: isFinite(d) ? d : 0,
      v: m.muted ? 0 : m.volume, l: !!m.loop, title: title, artist: artist, album: album, art: art,
    });
  } catch (e) {
    return JSON.stringify({ err: String(e) });
  }
}

function controlMedia(cmd, arg) {
  var m = document.querySelector('video.html5-main-video') || document.querySelector('video') || document.querySelector('audio');
  if (!m) return 'none';
  var btn = function (sel) {
    var b = document.querySelector(sel);
    return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && b.offsetParent !== null ? b : null;
  };
  if (cmd === 'toggle') { if (m.paused) m.play(); else m.pause(); }
  else if (cmd === 'stop') { m.pause(); m.currentTime = 0; }
  else if (cmd === 'seek') m.currentTime = arg;
  else if (cmd === 'vol') { m.muted = false; m.volume = Math.max(0, Math.min(1, arg)); }
  else if (cmd === 'repeat') m.loop = !m.loop;
  else if (cmd === 'next') {
    var n = btn('.ytp-next-button') || btn('ytmusic-player-bar .next-button');
    if (n) n.click(); else if (isFinite(m.duration)) m.currentTime = m.duration;
  } else if (cmd === 'prev') {
    var p = btn('.ytp-prev-button') || btn('ytmusic-player-bar .previous-button');
    if (m.currentTime > 3 || !p) m.currentTime = 0; else p.click();
  }
  return 'ok';
}

const PROBE_JS = '(' + probeMedia.toString() + ')()';
const controlJs = (cmd, arg) => '(' + controlMedia.toString() + ')(' + JSON.stringify(cmd) + ',' + JSON.stringify(arg == null ? null : arg) + ')';

const safariPollScript = (hosts) => `
function run() {
  const S = Application('Safari');
  if (!S.running()) return JSON.stringify({ running: false });
  const hosts = ${JSON.stringify(hosts)};
  const PROBE = ${JSON.stringify(PROBE_JS)};
  const out = { running: true, tabs: [] };
  let wins = [];
  try { wins = S.windows(); } catch (e) {
    if (/-1743|not authori/i.test(String(e))) out.denied = true;
    return JSON.stringify(out);
  }
  for (let wi = 0; wi < wins.length; wi++) {
    let urls = [];
    try { urls = wins[wi].tabs.url(); } catch (e) { continue; }
    for (let ti = 0; ti < urls.length; ti++) {
      const u = String(urls[ti] || '');
      const m = /^[a-z][a-z0-9+.-]*:\\/\\/([^\\/?#]+)/i.exec(u);
      const host = m ? m[1].toLowerCase() : '';
      if (!hosts.some(function (h) { return host === h || host.endsWith('.' + h); })) continue;
      try {
        const d = JSON.parse(S.doJavaScript(PROBE, { in: wins[wi].tabs[ti] }));
        if (d && !d.none && !d.err) { d.url = u; d.wi = wi; d.ti = ti; out.tabs.push(d); }
      } catch (e) {
        const msg = String(e);
        if (/javascript from apple events/i.test(msg)) out.jsOff = true;
        else if (/-1743|not authori/i.test(msg)) out.denied = true;
      }
    }
  }
  return JSON.stringify(out);
}`;

const safariCmdScript = (tab, js) => `
function run() {
  const S = Application('Safari');
  if (!S.running()) return 'off';
  const want = ${JSON.stringify(String(tab.url))};
  const wi = ${tab.wi | 0};
  const ti = ${tab.ti | 0};
  const JS = ${JSON.stringify(js)};
  let target = null;
  try {
    const t = S.windows[wi].tabs[ti];
    if (String(t.url()) === want) target = t;
  } catch (e) {}
  if (!target) {
    const wins = S.windows();
    for (let i = 0; i < wins.length && !target; i++) {
      let urls = [];
      try { urls = wins[i].tabs.url(); } catch (e) { continue; }
      for (let j = 0; j < urls.length; j++) {
        if (String(urls[j]) === want) { target = wins[i].tabs[j]; break; }
      }
    }
  }
  if (!target) return 'gone';
  return String(S.doJavaScript(JS, { in: target }));
}`;

/* ═══════════════════════════════════════════════════════════════════════
   the player: one per plugin, shared by every open view.
   it looks at music.app and safari, decides which one the card should show,
   and turns button presses into commands.
   ═══════════════════════════════════════════════════════════════════════ */

const idleSnap = (hint) => ({
  src: 'none', label: 'idle', playing: false, title: '', artist: '', album: '', art: '',
  dur: 0, pos: 0, at: Date.now(), vol: null, shuffle: false, repeat: 'off',
  canShuffle: false, canRepeat: false, key: '', tab: null, hint: hint || '',
});

class Player {
  constructor(plugin) {
    this.plugin = plugin;
    this.snap = idleSnap();
    this.views = new Set();
    this.cur = 'none';
    this.busy = false;
    this.lastPoll = 0;
    this.wasPlaying = { music: false, safari: false };
    this.hold = {};                  /* fields we just changed ourselves: ignore the player's old answer for a moment */
    this.safariUrl = '';
    this.artKey = '';
    this.artBlob = '';
    this.sys = { vol: null, muted: false, checked: false };   /* the mac's own output volume */
    this.sysHold = 0;                /* we just set it ourselves: ignore the old answer for a moment */
    this.sysBusy = false;
    this.sysPolling = false;
    this.sysWant = null;
  }

  addView(view) { this.views.add(view); }
  removeView(view) { this.views.delete(view); }

  visible() {
    for (const v of this.views) if (v.isVisible()) return true;
    return false;
  }

  /* called once a second; looks at the player every `poll` seconds, and only while a card is on screen */
  maybePoll() {
    if (!this.visible()) return;
    this.views.forEach((v) => v.syncWidth());   /* follow mish.fastfetch if its prompt changes */
    this.pollSystem();               /* every second: cheap, and the bar should follow the volume keys */
    if (Date.now() - this.lastPoll < this.plugin.settings.poll * 1000 - 100) return;
    this.poll();
  }

  /* where the song is right now: the last known spot plus the time since, while it plays */
  position(s) {
    const snap = s || this.snap;
    let p = snap.pos;
    if (snap.playing) p += (Date.now() - snap.at) / 1000;
    if (snap.dur > 0) p = Math.min(p, snap.dur);
    return Math.max(0, p);
  }

  emit(next) {
    this.snap = next;
    this.views.forEach((v) => v.onSnap(next));
  }

  setBlob(url) {
    if (this.artBlob) URL.revokeObjectURL(this.artBlob);
    this.artBlob = url || '';
  }

  fromMusic(d) {
    const t = d.track;
    return {
      src: 'music', label: 'music.app', playing: d.state === 'playing',
      title: t.name || '', artist: t.artist || '', album: t.album || '', art: '',
      dur: Number(t.dur) || 0, pos: Number(d.pos) || 0, at: Date.now(),
      vol: d.vol != null ? Number(d.vol) / 100 : null,
      shuffle: Boolean(d.shuffle), repeat: ['off', 'one', 'all'].includes(d.repeat) ? d.repeat : 'off',
      canShuffle: true, canRepeat: true,
      key: 'music|' + t.id + '|' + t.name + '|' + t.artist, tab: null, hint: '',
    };
  }

  fromSafari(d) {
    return {
      src: 'safari', label: siteLabel(d.url), playing: Boolean(d.p),
      title: d.title || '', artist: d.artist || '', album: d.album || '',
      art: d.art || ytThumb(d.url),
      dur: Number(d.d) || 0, pos: Number(d.t) || 0, at: Date.now(),
      vol: d.v != null ? Number(d.v) : null,
      shuffle: false, repeat: d.l ? 'one' : 'off',
      canShuffle: false, canRepeat: true,
      key: 'safari|' + d.url + '|' + d.title, tab: { url: d.url, wi: d.wi, ti: d.ti }, hint: '',
    };
  }

  pickTab(tabs) {
    if (!tabs.length) return null;
    return tabs.find((t) => t.p) || tabs.find((t) => t.url === this.safariUrl) || tabs[0];
  }

  /* which source the card shows. the one that is playing wins; if both are, the one that
     started most recently; if neither, the last one that had something. */
  choose(cand, prefer) {
    const order = prefer === 'music' ? ['music'] : prefer === 'safari' ? ['safari'] : ['music', 'safari'];
    const playing = order.filter((k) => cand[k] && cand[k].playing);
    let pick = 'none';
    if (playing.length) {
      pick = playing.includes(this.cur) ? this.cur : (playing.find((k) => !this.wasPlaying[k]) || playing[0]);
    } else if (order.includes(this.cur) && cand[this.cur]) {
      pick = this.cur;
    } else {
      pick = order.find((k) => cand[k]) || 'none';
    }
    this.wasPlaying = { music: Boolean(cand.music && cand.music.playing), safari: Boolean(cand.safari && cand.safari.playing) };
    return pick;
  }

  async poll(force) {
    if (this.busy) return;
    if (!force && !this.visible()) return;
    this.busy = true;
    this.lastPoll = Date.now();
    try {
      if (!cp || !Platform.isMacOS) {
        this.emit(idleSnap('this plugin needs macos'));
        return;
      }
      const s = this.plugin.settings;
      const [mr, sr] = await Promise.all([
        s.sources.music ? runJxa(MUSIC_POLL) : null,
        s.sources.safari ? runJxa(safariPollScript(hostList(s.sites))) : null,
      ]);

      const cand = { music: null, safari: null };
      const hints = [];

      if (mr) {
        if (!mr.ok) {
          hints.push(DENIED.test(mr.err) ? 'allow obsidian to control music' : 'music.app: no answer');
        } else if (mr.data && mr.data.denied) {
          hints.push('allow obsidian to control music');
        } else if (mr.data && mr.data.running && mr.data.track && mr.data.state !== 'stopped') {
          cand.music = this.fromMusic(mr.data);
        }
      }

      if (sr) {
        if (!sr.ok) {
          hints.push(DENIED.test(sr.err) ? 'allow obsidian to control safari' : 'safari: no answer');
        } else if (sr.data && sr.data.denied) {
          hints.push('allow obsidian to control safari');
        } else if (sr.data && sr.data.jsOff) {
          hints.push('safari: allow javascript from apple events');
        } else if (sr.data && sr.data.running && Array.isArray(sr.data.tabs)) {
          const tab = this.pickTab(sr.data.tabs);
          if (tab) { cand.safari = this.fromSafari(tab); this.safariUrl = tab.url; }
        }
      }

      const pick = this.choose(cand, s.prefer);
      this.cur = pick;
      let next = pick === 'none' ? idleSnap(hints[0] || '') : cand[pick];

      /* things we just changed ourselves keep their new value for a moment */
      const now = Date.now();
      Object.keys(this.hold).forEach((f) => { if (now > this.hold[f]) delete this.hold[f]; });
      if (next.src !== 'none' && next.src === this.snap.src && next.key === this.snap.key) {
        ['playing', 'vol', 'shuffle', 'repeat'].forEach((f) => { if (this.hold[f]) next[f] = this.snap[f]; });
        if (this.hold.pos) { next.pos = this.snap.pos; next.at = this.snap.at; }
      }

      /* cover art: music.app's has to be fetched, safari's is a url */
      if (next.src === 'music') {
        if (this.artKey !== next.key) {
          this.artKey = next.key;
          this.setBlob('');
          this.fetchMusicArt(next.key);
        }
        next.art = this.artBlob;
      } else if (next.src === 'none' && this.artKey) {
        this.artKey = '';
        this.setBlob('');
      }

      this.emit(next);
    } finally {
      this.busy = false;
    }
  }

  async fetchMusicArt(key) {
    if (!fs || !nodeOs || !nodePath) return;
    const file = nodePath.join(nodeOs.tmpdir(), 'mish-music-cover.bin');
    const r = await runOsa(['-e', musicArtScript(file)], 10000);
    if (!r.ok || r.out !== 'ok' || this.artKey !== key) return;
    try {
      const url = coverBlob(fs.readFileSync(file));
      if (!url || this.artKey !== key) { if (url) URL.revokeObjectURL(url); return; }
      this.setBlob(url);
      this.emit(Object.assign({}, this.snap, { art: url }));
    } catch (e) { /* no cover: the card keeps its placeholder */ }
  }

  /* a button was pressed. the card changes at once, the player is told, and a moment later
     we look again to make sure we agree. */
  async cmd(name, arg) {
    if (this.snap.src === 'none') await this.poll(true);
    const s = this.snap;
    if (s.src === 'none') return;
    const now = Date.now();
    const guard = (field) => { this.hold[field] = now + 2000; };
    let sent = arg;

    if (name === 'toggle') {
      this.emit(Object.assign({}, s, { playing: !s.playing, pos: this.position(s), at: now }));
      guard('playing');
    } else if (name === 'seek') {
      this.emit(Object.assign({}, s, { pos: arg, at: now }));
      guard('pos');
    } else if (name === 'stop') {
      /* stop = pause + back to the start, so the card stays alive and play still works */
      this.emit(Object.assign({}, s, { playing: false, pos: 0, at: now }));
      guard('playing');
      guard('pos');
    } else if (name === 'vol') {
      this.emit(Object.assign({}, s, { vol: arg }));
      guard('vol');
    } else if (name === 'shuffle') {
      if (!s.canShuffle) return;
      this.emit(Object.assign({}, s, { shuffle: !s.shuffle }));
      guard('shuffle');
    } else if (name === 'repeat') {
      const nextRepeat = s.src === 'music' ? { off: 'all', all: 'one', one: 'off' }[s.repeat] : (s.repeat === 'off' ? 'one' : 'off');
      sent = nextRepeat;
      this.emit(Object.assign({}, s, { repeat: nextRepeat }));
      guard('repeat');
    }

    if (s.src === 'music') await runJxa(musicCmdScript(name, sent));
    else if (s.tab) await runJxa(safariCmdScript(s.tab, controlJs(name, name === 'repeat' ? null : sent)));

    window.setTimeout(() => this.poll(true), 350);
  }

  /* ── the mac's output volume ─────────────────────────────────────────────
     plain applescript, no automation permission needed. some outputs (hdmi, some display
     speakers) have no volume control: then `vol` stays null and the view falls back to the
     player's own volume. */
  async pollSystem(force) {
    if (!cp || !Platform.isMacOS) return;
    if (this.plugin.settings.volumeFrom !== 'system') return;
    if (this.sysPolling || this.sysBusy) return;
    if (!force && (Date.now() < this.sysHold || !this.visible())) return;
    this.sysPolling = true;
    try {
      const r = await runOsa(['-e', 'get volume settings'], 4000);
      if (this.sysBusy || Date.now() < this.sysHold) return;       /* we changed it while asking */
      if (!r.ok) {
        this.sys.checked = true;                                   /* keep the last known value */
      } else {
        const v = /output volume:\s*(\d+)/.exec(r.out);
        const m = /output muted:\s*(true|false)/.exec(r.out);
        this.sys = {
          vol: v ? Math.min(100, Number(v[1])) / 100 : null,
          muted: Boolean(m && m[1] === 'true'),
          checked: true,
        };
      }
      this.views.forEach((view) => view.tick());
    } finally {
      this.sysPolling = false;
    }
  }

  /* the bar moves at once; the mac is told in the background. while you drag, only the newest
     value is sent (one osascript at a time), so it never queues up. dragging unmutes. */
  setSystemVolume(ratio) {
    const pct = Math.round(Math.min(1, Math.max(0, Number(ratio) || 0)) * 100);
    this.sys = { vol: pct / 100, muted: pct > 0 ? false : this.sys.muted, checked: true };
    this.sysHold = Date.now() + 2000;
    this.sysWant = pct;
    this.views.forEach((view) => view.tick());
    this.flushSystem();
  }

  async flushSystem() {
    if (this.sysBusy) return;
    this.sysBusy = true;
    try {
      while (this.sysWant != null) {
        const pct = this.sysWant;
        this.sysWant = null;
        await runOsa(['-e', 'set volume output volume ' + pct + (pct > 0 ? '\nset volume output muted false' : '')], 4000);
      }
    } finally {
      this.sysBusy = false;
      this.sysHold = Date.now() + 1200;
    }
  }

  setSystemMuted(muted) {
    this.sys = Object.assign({}, this.sys, { muted: Boolean(muted), checked: true });
    this.sysHold = Date.now() + 2000;
    this.views.forEach((view) => view.tick());
    runOsa(['-e', 'set volume output muted ' + (muted ? 'true' : 'false')], 4000);
  }

  destroy() {
    this.setBlob('');
    this.views.clear();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   the view
   ═══════════════════════════════════════════════════════════════════════ */

const OS_GLYPH = '\uF179';

/* the terminal look's `help` card: [what you type, what it does] */
const HELP = [
  ['play pause stop', 'stop goes back to 0:00 and waits there'],
  ['next prev', 'prev restarts the song if it has been playing a while'],
  ['seek <time>', 'seek 1:30, seek 90, seek +10, seek -15'],
  ['louder quieter', "volume up or down by 10%. it is the mac's volume"],
  ['vol <0-100>', 'sets the volume. mute toggles it'],
  ['shuffle repeat', 'shuffle: music.app only. repeat: off, all, one'],
  ['source <name>', 'auto, music or safari. same as the lilac pill'],
  [LOOK_NAME, 'back to the ' + LOOK_NAME + ' look (exit works too)'],
  ['clear', 'wipes the message line and closes this'],
];

/* every word the terminal answers to. TERM_WORDS is what tab completes; ALIAS maps the rest onto them */
const TERM_WORDS = ['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'seek', 'louder', 'quieter', 'vol', 'mute',
  'shuffle', 'repeat', 'source', LOOK_NAME, 'help', 'clear'];
const ALIAS = {
  previous: 'prev', back: 'prev', skip: 'next', pp: 'toggle', resume: 'play', up: 'louder', down: 'quieter',
  volume: 'vol', src: 'source', exit: LOOK_NAME, quit: LOOK_NAME, card: LOOK_NAME, '?': 'help', cls: 'clear',
};

/* "1:30", "90", "1:02:03" -> seconds. NaN when it isn't a time */
const parseClock = (txt) => {
  const bits = String(txt).trim().split(':');
  if (bits.length > 3 || bits.some((b) => !/^\d+(\.\d+)?$/.test(b))) return NaN;
  return bits.reduce((acc, b) => acc * 60 + Number(b), 0);
};

class MusicView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.player = plugin.player;
    this.refs = {};
    this.snap = this.player.snap;
    this.dragPos = null;
    this.dragVol = null;
    this.lastVol = 0.6;
    this.shownArt = null;
    this.msg = null;            /* the terminal look's one-line answer to the last command */
    this.history = [];
    this.histAt = -1;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'music'; }
  getIcon() { return 'music'; }

  isVisible() {
    const node = this.contentEl;
    return typeof node.isShown === 'function' ? node.isShown() : node.offsetParent !== null;
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('mm-root');
    const scroll = el('div', 'mm-scroll');
    root.appendChild(scroll);
    const card = el('div', 'mm');
    scroll.appendChild(card);
    this.refs.card = card;
    this.refs.scroll = scroll;

    /* one prompt on top, then both looks stacked; applyLook() hides whichever one isn't wanted.
       both are painted on every snapshot, so switching is instant and never waits for a poll. */
    this.drawPrompt();
    this.refs.c = this.buildCardFace(card);
    this.refs.t = this.buildTermFace(card);
    this.disposeSb = rainbowBar(scroll);

    this.applyLook();
    this.player.addView(this);
    this.onSnap(this.player.snap);
    this.registerInterval(window.setInterval(() => this.tick(), 250));

    /* long titles scroll; work out how far whenever the card changes size or the font arrives */
    this.ro = new ResizeObserver(() => this.fitLines());
    this.ro.observe(card);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.fitLines());

    this.player.poll(true);
    this.player.pollSystem(true);
  }

  async onClose() {
    this.player.removeView(this);
    if (this.ro) this.ro.disconnect();
    if (this.disposeSb) this.disposeSb();
    if (this.refs.disposeFit) this.refs.disposeFit();
  }

  /* ── building the faces (once; after this only text and classes change) ── */

  /* the three text lines (title, artist, album) both looks share */
  lines(meta) {
    const make = (cls) => {
      const wrap = el('div', 'mm-line ' + cls);
      const txt = el('span', 'mm-txt');
      wrap.appendChild(txt);
      meta.appendChild(wrap);
      return txt;
    };
    return { title: make('t'), artist: make('a'), album: make('b') };
  }

  /* look one: cover, icons, sliders */
  buildCardFace(card) {
    const c = {};
    const face = el('div', 'mm-face mm-face-card');
    c.face = face;

    const cmd = el('div', 'mm-cmd');
    cmd.appendChild(el('span', 'mm-chev', '\u276F'));
    cmd.appendChild(document.createTextNode(' '));
    cmd.appendChild(el('span', 'mm-exe', 'nowplaying'));
    const eq = el('span', 'mm-eq');
    for (let i = 0; i < 4; i++) eq.appendChild(el('i'));
    cmd.appendChild(eq);
    face.appendChild(cmd);

    /* cover + three lines of text. a fixed height, whatever is (or isn't) playing */
    const deck = el('div', 'mm-deck');
    const art = el('div', 'mm-art');
    const ph = el('span', 'mm-art-ph');
    setIcon(ph, 'music');
    const img = el('img');
    img.alt = '';
    img.draggable = false;
    img.addEventListener('load', () => art.classList.add('has-img'));
    img.addEventListener('error', () => art.classList.remove('has-img'));
    art.appendChild(ph);
    art.appendChild(img);
    deck.appendChild(art);
    c.art = art;
    c.img = img;

    const meta = el('div', 'mm-meta');
    Object.assign(c, this.lines(meta));
    deck.appendChild(meta);
    face.appendChild(deck);

    /* progress */
    const prog = el('div', 'mm-prog');
    c.tLeft = el('span', 'mm-time', '0:00');
    c.tRight = el('span', 'mm-time r', '-:--');
    c.seek = this.slider((ratio, final) => this.seekRatio(ratio, final));
    prog.appendChild(c.tLeft);
    prog.appendChild(c.seek);
    prog.appendChild(c.tRight);
    face.appendChild(prog);

    /* controls: five equal cells. an "on" state is only a colour and a dot, never a size */
    const ctl = el('div', 'mm-ctl');
    c.shuffle = this.button('mm-shuffle', 'shuffle', 'shuffle', () => this.player.cmd('shuffle'));
    c.prev = this.button('mm-prev', 'skip-back', 'previous', () => this.player.cmd('prev'));
    c.play = this.button('mm-main', 'play', 'play / pause', () => this.player.cmd('toggle'));
    c.next = this.button('mm-next', 'skip-forward', 'next', () => this.player.cmd('next'));
    c.repeat = this.button('mm-repeat', 'repeat', 'repeat', () => this.player.cmd('repeat'));
    [c.shuffle, c.prev, c.play, c.next, c.repeat].forEach((b) => ctl.appendChild(b));
    face.appendChild(ctl);

    /* volume: the same three columns as the progress row (6ch | bar | 6ch), so the bars line up */
    const vol = el('div', 'mm-volrow');
    const head = el('span', 'mm-volhead');
    c.mute = this.button('mm-mute', 'volume-2', 'mute', () => this.toggleMute());
    head.appendChild(c.mute);
    c.vol = this.slider((ratio, final) => this.volRatio(ratio, final));
    c.vol.classList.add('thin');
    c.volNum = el('span', 'mm-volnum', '');
    vol.appendChild(head);
    vol.appendChild(c.vol);
    vol.appendChild(c.volNum);
    face.appendChild(vol);
    c.volRow = vol;

    /* the footer: a fresh prompt with a blinking cursor (like mish.fastfetch's), and the look switch
       pinned to the right edge, the same place it sits in the terminal. nothing to type here. */
    const last = el('div', 'mm-cmd mm-last');
    last.appendChild(el('span', 'mm-chev', '\u276F'));
    last.appendChild(el('span', 'mm-cursor'));
    const tools = this.lookTools(null);
    c.lookCard = tools.card;
    c.lookTerm = tools.term;
    last.appendChild(tools.wrap);
    face.appendChild(last);

    card.appendChild(face);
    return c;
  }

  /* the look switch (and `help`, in the terminal only): built once per face, the switch always on
     the right edge. pass null for no help link. */
  lookTools(onHelp) {
    const wrap = el('span', 'mm-tools');
    let help = null;
    if (onHelp) {
      help = el('span', 'mm-link', 'help');
      help.title = 'what do these do?';
      help.addEventListener('click', onHelp);
    }
    const looks = el('span', 'mm-looks');
    const card = el('span', 'mm-link mm-look', LOOK_NAME);
    card.title = 'cover art, icons and sliders';
    card.addEventListener('click', () => this.plugin.setLook('card'));
    const term = el('span', 'mm-link mm-look', 'terminal');
    term.title = 'a command line you can type into';
    term.addEventListener('click', () => {
      this.plugin.setLook('terminal');
      this.focusInput();
    });
    looks.appendChild(card);
    looks.appendChild(term);
    if (help) wrap.appendChild(help);
    wrap.appendChild(looks);
    return { wrap, help, card, term };
  }

  /* look two: the terminal. the same rows, in the same order, as the card:
       prompt, now playing, progress, controls, volume, footer.
     a command line you can type into, words instead of icons, and every state is still a colour
     or an underline, never a size. seek and vol share one three-column grid (label | bar | value),
     so the two bars start and end in the same place. */
  buildTermFace(card) {
    const t = {};
    const face = el('div', 'mm-face mm-face-term');
    t.face = face;

    /* ❯ nowplaying --src=youtube --vol=60 _   (the flags follow the real player) */
    const cmd = el('div', 'mm-cmd');
    cmd.appendChild(el('span', 'mm-chev', '\u276F'));
    cmd.appendChild(document.createTextNode(' '));
    cmd.appendChild(el('span', 'mm-exe', 'nowplaying'));
    cmd.appendChild(document.createTextNode(' '));
    t.args = el('span', 'mm-arg', '');
    cmd.appendChild(t.args);
    cmd.appendChild(el('span', 'mm-us', '_'));
    face.appendChild(cmd);

    const meta = el('div', 'mm-tmeta');
    Object.assign(t, this.lines(meta));
    face.appendChild(meta);
    face.appendChild(el('div', 'mm-rule'));

    /* status on the left, the answer to your last command (or the shuffle / repeat state) on the right */
    const st = el('div', 'mm-stat-row');
    t.led = el('span', 'mm-led');
    t.stat = el('span', 'mm-stat', 'idle');
    t.note = el('span', 'mm-note', '');
    st.appendChild(t.led);
    st.appendChild(t.stat);
    st.appendChild(t.note);
    face.appendChild(st);

    /* seek   ▮▮▮▮▮▮▮▮▮▮▮▮▮▮   1:23 / 3:45 */
    const seekRow = el('div', 'mm-trow mm-tseek');
    seekRow.appendChild(el('span', 'mm-tlab', 'seek'));
    t.seek = this.slider((ratio, final) => this.seekRatio(ratio, final));
    t.seek.classList.add('blocks');
    seekRow.appendChild(t.seek);
    const clock = el('span', 'mm-clock');
    t.tLeft = el('span', 'l', '--:--');
    t.tRight = el('span', 'd', '--:--');
    clock.appendChild(t.tLeft);
    clock.appendChild(el('span', 'd', ' / '));
    clock.appendChild(t.tRight);
    seekRow.appendChild(clock);
    face.appendChild(seekRow);

    /* the commands, as words, on one row. clicking one is the same as typing it. each word has a
       fixed width (css), so play <-> pause never nudges its neighbours. */
    const words = el('div', 'mm-words');
    const word = (cls, text, line) => {
      const b = el('button', 'mm-w ' + cls, text);
      b.type = 'button';
      b.title = line;
      b.addEventListener('click', () => this.execute(line));
      words.appendChild(b);
      return b;
    };
    t.prev = word('w-prev', 'prev', 'prev');
    t.play = word('w-play', 'play', 'toggle');
    t.next = word('w-next', 'next', 'next');
    t.stop = word('w-stop', 'stop', 'stop');
    t.shuffle = word('w-shuffle', 'shuffle', 'shuffle');
    t.repeat = word('w-repeat', 'repeat', 'repeat');
    face.appendChild(words);
    t.words = words;

    /* vol    ||||||||||||||||||||   100%    (clicking `vol` mutes) */
    const volRow = el('div', 'mm-trow mm-tvol');
    t.volLab = el('span', 'mm-tlab mm-tlab-btn', 'vol');
    t.volLab.title = 'mute / unmute';
    t.volLab.addEventListener('click', () => {
      const res = this.toggleMute();
      this.say(res || "this player won't say its volume", res ? 'ok' : 'err');
    });
    t.vol = this.slider((ratio, final) => this.volRatio(ratio, final));
    t.vol.classList.add('ticks');
    t.volNum = el('span', 'mm-tval', '');
    volRow.appendChild(t.volLab);
    volRow.appendChild(t.vol);
    volRow.appendChild(t.volNum);
    face.appendChild(volRow);
    t.volRow = volRow;

    /* help */
    const help = el('div', 'mm-info mm-help');
    help.hidden = true;
    const hcmd = el('div', 'mm-cmd');
    hcmd.appendChild(el('span', 'mm-chev', '\u276F'));
    hcmd.appendChild(document.createTextNode(' '));
    hcmd.appendChild(el('span', 'mm-exe', 'help'));
    help.appendChild(hcmd);
    const grid = el('div', 'mm-info-grid');
    HELP.forEach(([k, d]) => {
      grid.appendChild(el('div', 'mm-k', k));
      grid.appendChild(el('div', 'mm-info-d', d));
    });
    help.appendChild(grid);
    face.appendChild(help);
    t.help = help;

    /* the footer: the same prompt, `help` and look switch as the card, in the same places */
    const row = el('div', 'mm-cmd mm-last mm-inrow');
    row.appendChild(el('span', 'mm-chev', '\u276F'));
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mm-input';
    input.placeholder = 'type a command';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('aria-label', 'command');
    input.addEventListener('keydown', (e) => this.onKey(e, input));

    /* the caret is the same pink block as mish.eza and mish.fastfetch: drawn by hand, because the
       browser's own caret is a thin line. a hidden twin of the text measures where the block goes,
       and the letter under it is drawn inverted, like a terminal. the layer sits on top of the input
       (eza's sits behind transparent text) and ignores the mouse, so clicking still reaches the input. */
    const wrap = el('div', 'mm-inwrap');
    wrap.appendChild(input);
    const hl = el('div', 'mm-hl');
    const meas = el('span', 'mm-hl-meas');
    const caret = el('div', 'mm-caret');
    hl.appendChild(meas);
    hl.appendChild(caret);
    wrap.appendChild(hl);
    const paint = () => {
      const v = input.value;
      const pos = input.selectionStart == null ? v.length : input.selectionStart;
      meas.textContent = v.slice(0, pos);
      const x = meas.getBoundingClientRect().width - input.scrollLeft;   /* follow a long line as it scrolls */
      caret.style.transform = 'translate(' + x + 'px, -50%)';
      caret.textContent = v.charAt(pos);
      caret.style.animation = 'none';          /* solid while you type, blinking when idle */
      void caret.offsetWidth;
      caret.style.animation = '';
      wrap.classList.toggle('is-empty', !v);
      wrap.classList.toggle('has-sel', input.selectionStart !== input.selectionEnd);
      wrap.classList.toggle('is-focus', input.ownerDocument.activeElement === input);
    };
    /* catch programmatic changes too (tab completion, history, a command clearing the line) */
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); paint(); },
    });
    ['input', 'scroll', 'keyup', 'mouseup', 'focus', 'blur', 'select'].forEach((ev) => input.addEventListener(ev, paint));
    input.addEventListener('keydown', () => requestAnimationFrame(paint));
    paint();
    row.appendChild(wrap);
    t.input = input;
    t.paint = paint;

    const tools = this.lookTools(() => this.toggleHelp());
    t.helpBtn = tools.help;
    t.lookCard = tools.card;
    t.lookTerm = tools.term;
    row.appendChild(tools.wrap);
    face.appendChild(row);

    card.appendChild(face);
    return t;
  }

  /* a transparent button with an icon. `all: unset` in the css keeps obsidian's own button styling out of it */
  button(cls, icon, label, onClick) {
    const b = el('button', 'mm-btn ' + cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.dataset.icon = icon;
    setIcon(b, icon);
    b.addEventListener('click', onClick);
    return b;
  }

  setBtnIcon(b, icon) {
    if (b.dataset.icon === icon) return;
    b.dataset.icon = icon;
    b.empty();
    setIcon(b, icon);
  }

  /* a click-and-drag bar. `onRatio(ratio, final)` gets 0..1 while dragging and once more on release */
  slider(onRatio) {
    const root = el('div', 'mm-slider');
    const bar = el('div', 'mm-slider-bar');
    bar.appendChild(el('div', 'mm-slider-fill'));
    root.appendChild(bar);
    root.appendChild(el('div', 'mm-slider-knob'));

    const ratioAt = (e) => {
      const rect = root.getBoundingClientRect();
      return rect.width ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    };
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      root.classList.add('is-drag');
      root.setPointerCapture(e.pointerId);
      onRatio(ratioAt(e), false);
      const move = (ev) => onRatio(ratioAt(ev), false);
      const up = (ev) => {
        root.classList.remove('is-drag');
        root.removeEventListener('pointermove', move);
        root.removeEventListener('pointerup', up);
        root.removeEventListener('pointercancel', up);
        onRatio(ratioAt(ev), true);
      };
      root.addEventListener('pointermove', move);
      root.addEventListener('pointerup', up);
      root.addEventListener('pointercancel', up);
    });
    return root;
  }

  seekRatio(ratio, final) {
    const dur = this.snap.dur;
    if (!(dur > 0)) return;
    this.dragPos = ratio * dur;
    this.tick();
    if (final) {
      const to = this.dragPos;
      this.dragPos = null;
      this.player.cmd('seek', to);
    }
  }

  /* where the volume bar gets its number. `system` = the mac's output volume (the default).
     if the output has no volume control, or the setting says `player`, it is the player's own. */
  volState() {
    const sys = this.player.sys;
    if (this.plugin.settings.volumeFrom === 'system') {
      if (sys.vol != null) return { kind: 'system', v: sys.vol, muted: Boolean(sys.muted) };
      if (!sys.checked) return { kind: 'system', v: null, muted: false };      /* not asked yet */
    }
    return { kind: 'player', v: this.snap.vol, muted: false };
  }

  setVolume(ratio) {
    if (this.volState().kind === 'system') this.player.setSystemVolume(ratio);
    else this.player.cmd('vol', ratio);
  }

  volRatio(ratio, final) {
    this.dragVol = ratio;
    const system = this.volState().kind === 'system';
    if (system) this.player.setSystemVolume(ratio);       /* the real volume follows the drag */
    this.tick();
    if (final) {
      const to = this.dragVol;
      this.dragVol = null;
      if (!system) this.player.cmd('vol', to);
      this.tick();
    }
  }

  /* mute / unmute. returns 'muted', 'unmuted', or false when there is no volume to talk about */
  toggleMute() {
    const st = this.volState();
    if (st.v == null) return false;
    if (st.kind === 'system') {
      this.player.setSystemMuted(!st.muted);
      return st.muted ? 'unmuted' : 'muted';
    }
    if (st.v > 0) {
      this.lastVol = st.v;
      this.player.cmd('vol', 0);
      return 'muted';
    }
    this.player.cmd('vol', this.lastVol || 0.6);
    return 'unmuted';
  }

  /* the powerline prompt: user, ~/music, the >>> bridge and the source pill (fixed width, clickable) */
  drawPrompt() {
    const r = this.refs;
    const s = this.plugin.settings;
    if (r.disposeFit) r.disposeFit();

    const bar = el('div', 'mm-bar');
    const segs = [];
    if (s.pills.user) segs.push(['mm-user', OS_GLYPH + ' ' + (s.username || detectUser())]);
    if (s.pills.path) segs.push(['mm-path', s.pathLabel]);
    if (s.pills.source) segs.push(['mm-ch mm-ch1', ''], ['mm-ch mm-ch2', ''], ['mm-ch mm-ch3', ''], ['mm-src', '']);
    bar.hidden = !segs.length;
    const nodes = segs.map(([cls, text], i) => {
      const seg = el('span', 'mm-seg ' + cls, text);
      seg.style.zIndex = String(segs.length - i);   /* each arrow tip sits over the next segment */
      bar.appendChild(seg);
      return seg;
    });
    r.srcPill = s.pills.source ? nodes[nodes.length - 1] : null;
    if (r.srcPill) r.srcPill.addEventListener('click', () => this.plugin.cyclePrefer());

    if (r.bar) r.bar.replaceWith(bar);
    else r.card.prepend(bar);
    r.bar = bar;
    r.fit = fitBar(bar, [r.card, r.scroll]);
    r.disposeFit = r.fit.dispose;
    this.paintSource();
  }

  paintSource() {
    const r = this.refs;
    if (!r.srcPill) return;
    const pinned = this.plugin.settings.prefer !== 'auto';
    const label = this.snap.label + (pinned ? '*' : '');
    setText(r.srcPill, label);
    r.srcPill.title = 'click to switch source: auto, music.app, safari (now: ' + this.plugin.settings.prefer + ')';
  }

  /* "same width as mish.fastfetch". that card is as wide as its own prompt, so its width is not a number
     we can keep in a setting (it changes with the pills you turn on). the two live in the same sidebar,
     so read it off the page. if fastfetch is not open, use the card width setting; if its tab is only
     hidden (it measures 0), keep the last width we saw. the card still never resizes by itself. */
  syncWidth() {
    const s = this.plugin.settings;
    const root = this.contentEl;
    if (!root) return;
    let want = num(s.cardWidth, 240, 380, 300);
    if (s.cardWidthFrom === 'fastfetch') {
      const ff = document.querySelector('.workspace-leaf-content[data-type="tv-fetch-view"] .vf');
      if (!ff) this.ffWidth = 0;
      else {
        const w = ff.getBoundingClientRect().width;
        if (w > 0) this.ffWidth = w;
      }
      if (this.ffWidth) want = Math.min(800, Math.max(160, this.ffWidth));
    }
    const cur = parseFloat(root.style.getPropertyValue('--mm-w'));
    if (!(Math.abs(cur - want) < 0.5)) root.style.setProperty('--mm-w', want + 'px');
  }

  /* settings that change how the card looks, including which look */
  applyLook() {
    const r = this.refs;
    const s = this.plugin.settings;
    if (!r.card || !r.c || !r.t) return;
    const term = s.look === 'terminal';
    /* colours, sizes, border and font go on the view's root, so the scrollbar gets them too */
    const fs = fontStack(s);
    applyVars(this.contentEl, Object.assign(fs ? { '--vf-mono': fs } : {}, paletteVars(s), layoutVars(s)));
    this.syncWidth();
    SHAPES.forEach((n) => r.card.classList.toggle('mm-shape-' + n, s.pillShape === n));
    PLAYS.forEach((n) => r.card.classList.toggle('play-' + n, s.bars.play === n));
    r.card.classList.toggle('no-marquee', !s.motion.marquee);
    r.card.classList.toggle('no-anim', !s.motion.animate);
    r.card.classList.toggle('look-term', term);
    r.card.classList.toggle('look-card', !term);
    r.card.classList.toggle('no-art', !s.showArt);
    r.c.face.hidden = term;
    r.t.face.hidden = !term;
    r.c.volRow.hidden = !s.showVolume;
    r.t.volRow.hidden = !s.showVolume;
    [r.c, r.t].forEach((f) => {
      f.lookCard.classList.toggle('is-cur', !term);
      f.lookTerm.classList.toggle('is-cur', term);
    });
    if (r.fit) r.fit();
    this.fitLines();
    if (term && r.t.paint) r.t.paint();      /* the caret was measured while hidden */
  }

  applySettings() {
    this.drawPrompt();
    this.applyLook();
    this.onSnap(this.player.snap);
  }

  focusInput() {
    window.requestAnimationFrame(() => {
      const input = this.refs.t && this.refs.t.input;
      if (input && this.isVisible()) input.focus();
    });
  }

  /* ── the terminal: typing, history, tab, and what each word does ──────── */

  onKey(e, input) {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = input.value.trim();
      input.value = '';
      this.histAt = -1;
      if (!line) return;
      if (this.history[this.history.length - 1] !== line) this.history.push(line);
      if (this.history.length > 50) this.history.shift();
      this.execute(line);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.history.length) return;
      e.preventDefault();
      if (e.key === 'ArrowUp') this.histAt = this.histAt < 0 ? this.history.length - 1 : Math.max(0, this.histAt - 1);
      else if (this.histAt >= 0) this.histAt += 1;
      if (this.histAt >= this.history.length) this.histAt = -1;
      input.value = this.histAt < 0 ? '' : this.history[this.histAt];
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const word = input.value.trim().toLowerCase();
      if (!word || /\s/.test(word)) return;
      const hits = TERM_WORDS.filter((w) => w.startsWith(word));
      if (hits.length === 1) input.value = hits[0] + ' ';
    } else if (e.key === 'Escape') {
      input.blur();
    }
  }

  say(text, kind) {
    this.msg = { text, kind: kind === 'err' ? 'err' : 'ok', until: Date.now() + 4500 };
    this.tick();
  }

  toggleHelp(open) {
    const t = this.refs.t;
    if (!t) return;
    const show = open == null ? t.help.hidden : open;
    t.help.hidden = !show;
    t.helpBtn.textContent = show ? 'close' : 'help';
  }

  execute(line) {
    const parts = String(line).trim().split(/\s+/);
    const first = (parts[0] || '').toLowerCase();
    const name = ALIAS[first] || first;
    const res = this.runCommand(name, parts.slice(1).join(' '), first);
    if (res) this.say(res.text, res.kind);
  }

  /* returns { text, kind } for the message line, or null for no message */
  runCommand(name, arg, typed) {
    const s = this.snap;
    const p = this.player;
    const idle = s.src === 'none';
    const ok = (text) => ({ text, kind: 'ok' });
    const bad = (text) => ({ text, kind: 'err' });
    const nothing = () => { p.poll(true); return bad('nothing playing'); };

    switch (name) {
      case 'play':
        if (idle) return nothing();
        if (!s.playing) p.cmd('toggle');
        return ok('playing');
      case 'pause':
        if (idle) return nothing();
        if (s.playing) p.cmd('toggle');
        return ok('paused');
      case 'toggle':
        if (idle) return nothing();
        p.cmd('toggle');
        return ok(s.playing ? 'paused' : 'playing');
      case 'stop':
        if (idle) return nothing();
        p.cmd('stop');
        return ok('stopped');
      case 'next':
        if (idle) return nothing();
        p.cmd('next');
        return ok('next');
      case 'prev':
        if (idle) return nothing();
        p.cmd('prev');
        return ok('previous');

      case 'seek': {
        if (idle) return nothing();
        const raw = String(arg).trim();
        const usage = 'usage: seek 1:30, seek +10, seek -15';
        if (!raw) return bad(usage);
        const sign = raw[0] === '+' || raw[0] === '-' ? raw[0] : '';
        const secs = parseClock(sign ? raw.slice(1) : raw);
        if (!Number.isFinite(secs)) return bad(usage);
        const here = p.position(s);
        let to = sign === '+' ? here + secs : sign === '-' ? here - secs : secs;
        if (s.dur > 0) to = Math.min(to, s.dur);
        to = Math.max(0, to);
        p.cmd('seek', to);
        return ok('seek ' + fmtTime(to));
      }

      case 'louder':
      case 'quieter': {
        const vs = this.volState();
        if (idle && vs.kind === 'player') return nothing();
        if (vs.v == null) return bad("this player won't say its volume");
        const now = Math.round(vs.v * 100);
        const to = Math.min(100, Math.max(0, now + (name === 'louder' ? 10 : -10)));
        if (to > 0) this.lastVol = to / 100;
        this.setVolume(to / 100);
        return ok('volume ' + to + '%');
      }

      case 'vol': {
        if (idle && this.volState().kind === 'player') return nothing();
        const n = Number(String(arg).replace('%', '').trim());
        if (!String(arg).trim() || !Number.isFinite(n) || n < 0 || n > 100) return bad('usage: vol 0-100');
        if (n > 0) this.lastVol = n / 100;
        this.setVolume(n / 100);
        return ok('volume ' + Math.round(n) + '%');
      }

      case 'mute': {
        if (idle && this.volState().kind === 'player') return nothing();
        const res = this.toggleMute();
        return res ? ok(res) : bad("this player won't say its volume");
      }

      case 'shuffle':
        if (idle) return nothing();
        if (!s.canShuffle) return bad('shuffle works in music.app only');
        p.cmd('shuffle');
        return ok('shuffle ' + (s.shuffle ? 'off' : 'on'));

      case 'repeat': {
        if (idle) return nothing();
        const next = s.src === 'music' ? { off: 'all', all: 'one', one: 'off' }[s.repeat] : (s.repeat === 'off' ? 'one' : 'off');
        p.cmd('repeat');
        return ok('repeat ' + next);
      }

      case 'source': {
        const want = String(arg).trim().toLowerCase().replace(/\.app$/, '');
        if (!want) return ok('source: ' + this.plugin.settings.prefer);
        const map = { auto: 'auto', music: 'music', safari: 'safari', youtube: 'safari', web: 'safari' };
        if (!map[want]) return bad('source: auto, music or safari');
        this.plugin.setPrefer(map[want]);
        return ok('source: ' + map[want]);
      }

      case LOOK_NAME:
        this.plugin.setLook('card');
        return null;
      case 'terminal':
        return ok('already here');
      case 'help':
        this.toggleHelp();
        return null;
      case 'clear':
        this.msg = null;
        this.toggleHelp(false);
        this.tick();
        return null;
      case 'sudo':
        return bad('this incident will be reported');
      default:
        return bad('command not found: ' + String(typed || name).slice(0, 22));
    }
  }

  /* ── painting a snapshot ─────────────────────────────────────────── */

  onSnap(snap) {
    this.snap = snap;
    const r = this.refs;
    if (!r.card || !r.c || !r.t) return;
    const c = r.c;
    const t = r.t;
    const none = snap.src === 'none';

    r.card.classList.toggle('is-playing', snap.playing);
    r.card.classList.toggle('is-dead', none);

    const text = {
      title: none ? 'nothing playing' : (tidy(snap.title) || 'untitled'),
      artist: none ? 'play something in music.app' : (tidy(snap.artist) || (snap.src === 'safari' ? snap.label : '')),
      album: none ? (snap.hint || 'or on youtube, in safari') : tidy(snap.album),
    };
    let changed = false;
    [c, t].forEach((f) => {
      changed = setText(f.title, text.title) || changed;
      changed = setText(f.artist, text.artist) || changed;
      changed = setText(f.album, text.album) || changed;
      f.album.parentElement.classList.toggle('is-hint', none && Boolean(snap.hint));
      f.album.parentElement.title = none ? snap.hint : '';
    });
    if (changed) this.fitLines();

    this.paintSource();

    /* cover (card look only) */
    const art = this.plugin.settings.showArt ? snap.art : '';
    if (art !== this.shownArt) {
      this.shownArt = art;
      c.art.classList.remove('has-img');
      if (art) c.img.src = art;
      else c.img.removeAttribute('src');
    }

    /* card look: icons swap in place, "on" is a colour and a dot */
    this.setBtnIcon(c.play, snap.playing ? 'pause' : 'play');
    c.shuffle.classList.toggle('is-on', snap.shuffle);
    c.shuffle.classList.toggle('is-na', !snap.canShuffle && !none);
    c.repeat.classList.toggle('is-on', snap.repeat !== 'off');
    this.setBtnIcon(c.repeat, snap.repeat === 'one' ? 'repeat-1' : 'repeat');
    c.shuffle.title = snap.canShuffle || none ? 'shuffle' : 'shuffle (music.app only)';
    c.repeat.title = snap.src === 'music' ? 'repeat: ' + snap.repeat : 'repeat';

    /* terminal look: words swap in place, "on" is an underline */
    setText(t.play, snap.playing ? 'pause' : 'play');
    t.shuffle.classList.toggle('is-on', snap.shuffle);
    t.shuffle.classList.toggle('is-na', !snap.canShuffle && !none);
    t.repeat.classList.toggle('is-on', snap.repeat !== 'off');
    setText(t.stat, none ? 'idle' : (snap.playing ? 'playing' : 'paused'));

    this.tick();
  }

  /* ~4 times a second: moves the bars and the clocks between looks at the player */
  tick() {
    const r = this.refs;
    if (!r.c || !r.t) return;
    const s = this.snap;
    const none = s.src === 'none';
    const pos = this.dragPos != null ? this.dragPos : this.player.position(s);
    const ratio = s.dur > 0 ? Math.min(1, Math.max(0, pos / s.dur)) : 0;
    const p = (ratio * 100).toFixed(2) + '%';
    const left = fmtTime(pos);
    const right = s.dur > 0 ? fmtTime(s.dur) : (none ? '0:00' : '-:--');
    const vs = this.volState();
    const dragging = this.dragVol != null;
    const raw = dragging ? this.dragVol : vs.v;                 /* null = no volume to show */
    const muted = !dragging && vs.muted;
    const v = muted ? 0 : raw;
    const vp = Math.round((v == null ? 0 : v) * 100);
    const volText = raw == null ? '' : (muted ? 'mute' : vp + '%');
    r.card.classList.toggle('vol-live', vs.kind === 'system' && vs.v != null);   /* works with nothing playing */

    /* card */
    const c = r.c;
    c.seek.style.setProperty('--p', p);
    setText(c.tLeft, left);
    setText(c.tRight, right);
    c.vol.style.setProperty('--p', ((v == null ? 0 : v) * 100).toFixed(1) + '%');
    setText(c.volNum, volText);
    this.setBtnIcon(c.mute, v == null || v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2');

    /* terminal */
    const t = r.t;
    t.seek.style.setProperty('--p', p);
    t.vol.style.setProperty('--p', ((v == null ? 0 : v) * 100).toFixed(1) + '%');
    setText(t.volNum, volText);
    t.volLab.classList.toggle('is-muted', muted);
    setText(t.tLeft, none ? '--:--' : left);
    setText(t.tRight, none ? '--:--' : right);

    const flags = [];
    if (!none) flags.push('--src=' + String(s.label).replace(/\s+/g, '-'));
    if (raw != null) flags.push(muted ? '--muted' : '--vol=' + vp);
    setText(t.args, flags.length ? flags.join(' ') : '--idle');

    const m = this.msg && Date.now() < this.msg.until ? this.msg : null;
    const state = [];
    if (s.shuffle) state.push('shuffle');
    if (s.repeat !== 'off') state.push('repeat ' + s.repeat);
    setText(t.note, m ? m.text : state.join(', '));
    const kind = m ? m.kind : 'state';
    if (t.note.dataset.kind !== kind) t.note.dataset.kind = kind;
  }

  /* a line that doesn't fit scrolls back and forth; one that does stays put */
  fitLines() {
    const r = this.refs;
    [r.c, r.t].forEach((f) => {
      if (!f) return;
      [f.title, f.artist, f.album].forEach((txt) => {
        if (!txt) return;
        const line = txt.parentElement;
        txt.classList.remove('is-long');
        txt.style.removeProperty('--mm-shift');
        const over = txt.scrollWidth - line.clientWidth;
        if (over > 2) {
          txt.style.setProperty('--mm-shift', -(over + 4) + 'px');
          txt.style.setProperty('--mm-dur', Math.max(6, over / 18 + 4) + 's');
          txt.classList.add('is-long');
        }
      });
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   settings
   ═══════════════════════════════════════════════════════════════════════ */

class MusicSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.scanned = [];
  }

  display() {
    const { containerEl, plugin } = this;
    const s = plugin.settings;
    containerEl.empty();

    /* the builders below write into the settings, repaint, and save a moment later.
       kind: 'look' = styles only (fast), 'bar' = redraw the prompt too. */
    const apply = (kind) => {
      if (kind === 'bar') plugin.refreshViews();
      else plugin.restyle();
      plugin.persist();
    };
    const holder = (group) => (group ? s[group] : s);
    const dflt = (group, key) => (group ? DEFAULT_SETTINGS[group] : DEFAULT_SETTINGS)[key];

    /* a setting that also needs the player asked again (sources, sites...) */
    const saved = (name, desc) => new UiSetting(containerEl).setName(name).setDesc(desc || '');

    const drop = (group, key, name, desc, options, kind) => new UiSetting(containerEl)
      .setName(name)
      .setDesc(desc || '')
      .addDropdown((d) => d
        .addOptions(uiOptions(options))
        .setValue(String(holder(group)[key]))
        .onChange((value) => {
          holder(group)[key] = value;
          apply(kind);
        }));

    const tog = (group, key, name, desc, kind) => new UiSetting(containerEl)
      .setName(name)
      .setDesc(desc || '')
      .addToggle((t) => t
        .setValue(Boolean(holder(group)[key]))
        .onChange((value) => {
          holder(group)[key] = value;
          apply(kind);
        }));

    /* a slider with a little reset arrow that puts the default back */
    const slide = (group, key, name, desc, lo, hi, step, kind, unit) => {
      let comp = null;
      return new UiSetting(containerEl)
        .setName(name)
        .setDesc(desc || '')
        .addSlider((sl) => {
          comp = sl;
          sl.setLimits(lo, hi, step)
            .setValue(Number(holder(group)[key]))
            .setDynamicTooltip()
            .onChange((value) => {
              holder(group)[key] = value;
              apply(kind);
            });
        })
        .addExtraButton((b) => b
          .setIcon('rotate-ccw')
          .setTooltip(ui('back to the default (' + dflt(group, key) + (unit || '') + ')'))
          .onClick(() => {
            holder(group)[key] = dflt(group, key);
            comp.setValue(dflt(group, key));
            apply(kind);
          }));
    };

    /* ── the first setting: how the text in this tab is cased ── */
    new UiSetting(containerEl)
      .setName('lowercase ui')
      .setDesc('show the text in this tab, its tooltips and its messages in lowercase, to match the terminal look. turn it off for normal sentence case.')
      .addToggle((toggle) => toggle
        .setValue(s.lowercaseUi !== false)
        .onChange(async (value) => {
          s.lowercaseUi = value;
          uiCase.lower = value;
          await plugin.saveSettings();
          this.display();
        }));

    /* ── look ── */
    new UiSetting(containerEl).setName('look').setHeading();

    new UiSetting(containerEl)
      .setName('style')
      .setDesc(LOOK_NAME + ': cover art, icons and sliders. terminal: the old mpv-style screen with a command line you can type into (try help). you can also switch from the links at the bottom of the card, or from the command palette.')
      .addDropdown((d) => d
        .addOptions(uiOptions({ card: LOOK_NAME, terminal: 'terminal' }))
        .setValue(s.look)
        .onChange(async (v) => { s.look = v; await plugin.saveSettings(); }));

    /* ── sources ── */
    new UiSetting(containerEl).setName('sources').setHeading();

    saved('music.app', 'show what is playing in music.app. macos asks once if obsidian may control it.')
      .addToggle((t) => t.setValue(s.sources.music).onChange(async (v) => { s.sources.music = v; await plugin.saveSettings(); }));

    saved('safari', 'show video and audio playing in safari tabs. needs "allow javascript from apple events" (safari settings > developer).')
      .addToggle((t) => t.setValue(s.sources.safari).onChange(async (v) => { s.sources.safari = v; await plugin.saveSettings(); }));

    saved('safari sites', 'only tabs on these sites are looked at, separated by commas. any site that plays audio or video works.')
      .addText((t) => t
        .setPlaceholder('youtube.com, soundcloud.com')
        .setValue(s.sites)
        .onChange(async (v) => { s.sites = v; await plugin.saveSettings(); }));

    saved('prefer', 'auto shows whichever is playing. you can also click the right pill on the prompt.')
      .addDropdown((d) => d
        .addOptions(uiOptions({ auto: 'auto', music: 'music.app', safari: 'safari' }))
        .setValue(s.prefer)
        .onChange(async (v) => { s.prefer = v; await plugin.saveSettings(); }));

    saved('look again every', 'how often the player is asked what is playing. the bar and the clock move smoothly in between. it stops while the panel is hidden.')
      .addDropdown((d) => d
        .addOptions(uiOptions({ 1: '1 second', 2: '2 seconds', 3: '3 seconds', 5: '5 seconds' }))
        .setValue(String(s.poll))
        .onChange(async (v) => { s.poll = Number(v); await plugin.saveSettings(); }));

    /* ── prompt ── */
    new UiSetting(containerEl).setName('prompt').setHeading();

    tog('pills', 'user', 'user pill', 'your name, with a logo for your operating system.', 'bar');
    tog('pills', 'path', 'path pill', 'the second pill, ~/music by default.', 'bar');
    tog('pills', 'source', 'source pill', 'the arrows and the right pill that say where the sound comes from. click it to switch source. you can still switch with the prefer setting or the terminal.', 'bar');
    drop(null, 'pillShape', 'pill shape', 'arrow is the powerline look. round and flat drop the arrow tips (and the little >>> bridge) and use gaps instead.',
      { arrow: 'arrow (powerline)', round: 'round', flat: 'flat' }, 'look');

    saved('prompt path', 'what the second pill says. leave it empty for ~/music.')
      .addText((t) => t
        .setPlaceholder('~/music')
        .setValue(s.pathLabel === '~/music' ? '' : s.pathLabel)
        .onChange(async (v) => { s.pathLabel = v.trim() || '~/music'; await plugin.saveSettings(); }));

    saved('prompt name', 'shown in the first pill. leave empty to use the name your system reports.')
      .addText((t) => t
        .setPlaceholder(detectUser())
        .setValue(s.username)
        .onChange(async (v) => { s.username = v.trim(); await plugin.saveSettings(); }));

    /* ── colours ── */
    new UiSetting(containerEl).setName('colours').setHeading();

    const pickers = [];
    let presetDrop = null;
    let refreshing = false;       /* setValue on a picker must not count as the user picking */
    const shown = () => (s.palette.preset === 'theme' ? themeFills() : s.palette.colours);

    const presets = { theme: ui('mish') };
    Object.keys(PALETTES).forEach((k) => { presets[k] = ui(k); });
    presets.custom = ui('custom');

    new UiSetting(containerEl)
      .setName('palette')
      .setDesc('the six colours of the rainbow. they colour the prompt pills, the song lines, the progress bar, the card border, the scrollbar and the sidebar tab icon. mish is the default: the pastel rainbow this plugin ships, and it follows the colours of your obsidian theme if the theme sets them. pick a preset, then change any colour below. in light mode the text versions are darkened for you.')
      .addDropdown((d) => {
        presetDrop = d;
        d.addOptions(presets)
          .setValue(presets[s.palette.preset] ? s.palette.preset : 'theme')
          .onChange((value) => {
            const was = s.palette.preset;
            s.palette.preset = value;
            if (PALETTES[value]) s.palette.colours = PALETTES[value].slice();
            else if (value === 'custom' && was === 'theme') s.palette.colours = themeFills();
            refreshing = true;
            shown().forEach((c, i) => { if (pickers[i]) pickers[i].setValue(c); });
            refreshing = false;
            apply('look');
          });
      })
      .addExtraButton((b) => b
        .setIcon('rotate-ccw')
        .setTooltip(ui('back to mish'))
        .onClick(() => {
          s.palette.preset = 'theme';
          presetDrop.setValue('theme');
          refreshing = true;
          shown().forEach((c, i) => { if (pickers[i]) pickers[i].setValue(c); });
          refreshing = false;
          apply('look');
        }));

    SLOTS.forEach((slot, i) => {
      new UiSetting(containerEl)
        .setName('colour ' + (i + 1))
        .setDesc(slot.used)
        .addColorPicker((c) => {
          pickers[i] = c;
          c.setValue(shown()[i]).onChange((hex) => {
            if (refreshing) return;
            if (s.palette.preset === 'theme') s.palette.colours = themeFills();   /* start from what you were seeing */
            s.palette.colours[i] = String(hex).toLowerCase();
            s.palette.preset = 'custom';
            presetDrop.setValue('custom');
            apply('look');
          });
        });
    });

    let inkPicker = null;
    const autoInk = () => (lightTheme() ? '#2a2430' : '#0f0f12');
    new UiSetting(containerEl)
      .setName('pill text colour')
      .setDesc('the text on every pill, and on the play button. automatic = dark ink. try white with a dark palette.')
      .addColorPicker((c) => {
        inkPicker = c;
        c.setValue(HEX.test(s.inkColour) ? s.inkColour : autoInk()).onChange((hex) => {
          s.inkColour = String(hex).toLowerCase();
          apply('look');
        });
      })
      .addExtraButton((b) => b
        .setIcon('rotate-ccw')
        .setTooltip(ui('back to automatic'))
        .onClick(() => {
          s.inkColour = '';
          inkPicker.setValue(autoInk());
          apply('look');
        }));

    /* ── card and layout ── */
    new UiSetting(containerEl).setName('card and layout').setHeading();

    drop(null, 'cardWidthFrom', 'card width follows', "mish.fastfetch: the card is exactly as wide as that card, wherever it is open, so the two line up in the sidebar. the slider: a fixed width. if mish.fastfetch is not open, the slider is used.",
      { fastfetch: 'mish.fastfetch', fixed: 'the slider' }, 'look');
    slide(null, 'cardWidth', 'card width', 'in pixels, used when it does not follow mish.fastfetch. fixed on purpose: the card never resizes, it just moves when you resize the sidebar.', 240, 380, 4, 'look', 'px');
    drop('card', 'hAlign', 'horizontal position', 'centred in the sidebar, or pinned to the left.', { centre: 'centre', left: 'left' }, 'look');
    drop('card', 'vAlign', 'vertical position', 'centred when the card is shorter than the sidebar, or pinned to the top.', { centre: 'centre', top: 'top' }, 'look');
    drop('card', 'ring', 'border', "rainbow uses the palette. accent is obsidian's accent colour. subtle is your theme's border colour.",
      { rainbow: 'rainbow', accent: 'accent colour', subtle: 'subtle', none: 'none' }, 'look');
    slide('card', 'ringWidth', 'border thickness', '', 1, 4, 1, 'look', 'px');
    slide('card', 'angle', 'rainbow angle', 'direction of the border gradient. 135 runs top-left to bottom-right.', 0, 345, 15, 'look', '°');
    slide('card', 'radius', 'corner radius', '', 0, 28, 1, 'look', 'px');
    slide('card', 'pad', 'outer margin', 'space between the card and the edge of the sidebar.', 0, 32, 1, 'look', 'px');
    slide('card', 'textSize', 'text size', 'scales every line of text on the card, in percent. the prompt scales with it.', 80, 120, 5, 'look', '%');

    /* ── cover art ── */
    new UiSetting(containerEl).setName('cover art').setHeading();

    saved('cover art', 'card look only')
      .addToggle((t) => t.setValue(s.showArt).onChange(async (v) => { s.showArt = v; await plugin.saveSettings(); }));
    slide('art', 'size', 'cover size', 'card look only. the three text lines grow with it.', 48, 96, 4, 'look', 'px');
    slide('art', 'radius', 'cover corners', 'card look only. 48 makes it a circle at the default size.', 0, 48, 1, 'look', 'px');
    tog('art', 'ring', 'cover border', 'card look only. a thin border around the cover, drawn the same way as the card border.', 'look');

    /* ── controls and bars ── */
    new UiSetting(containerEl).setName('controls and bars').setHeading();

    saved('volume bar', 'show the volume bar, in both looks. the terminal also takes louder, quieter and vol 40.')
      .addToggle((t) => t.setValue(s.showVolume).onChange(async (v) => { s.showVolume = v; await plugin.saveSettings(); }));
    saved('volume follows', "system: the bar is your mac's output volume. it moves when you press the volume keys, and dragging it sets the real volume. player: only the volume inside music.app or the safari tab. if your output has no volume control (some hdmi and display speakers), the bar falls back to the player.")
      .addDropdown((d) => d
        .addOptions(uiOptions({ system: 'system volume', player: 'player volume' }))
        .setValue(s.volumeFrom)
        .onChange(async (v) => { s.volumeFrom = v; await plugin.saveSettings(); }));
    drop('bars', 'style', 'bar colour', 'the fill of the progress and volume bars. rainbow uses the palette, accent is obsidian\'s accent colour, solid is colour 1.',
      { rainbow: 'rainbow', accent: 'accent colour', solid: 'solid (colour 1)' }, 'look');
    slide('bars', 'height', 'bar thickness', 'card look only. the volume bar stays a little thinner.', 3, 10, 1, 'look', 'px');
    drop('bars', 'play', 'play button', 'card look only. gradient is the pink-to-lilac pill. solid is colour 1. ghost is just an outline.',
      { gradient: 'gradient pill', solid: 'solid pill', ghost: 'outline' }, 'look');

    /* ── motion ── */
    new UiSetting(containerEl).setName('motion').setHeading();

    tog('motion', 'marquee', 'scrolling titles', 'a title that is too long scrolls back and forth. off cuts it with an ellipsis instead.', 'look');
    tog('motion', 'animate', 'animations', 'the dancing bars, the blinking cursor and the pulsing light. your system\'s reduced motion setting turns these off anyway.', 'look');

    /* ── font ── */
    new UiSetting(containerEl).setName('appearance').setHeading();

    const choices = () => {
      const opts = {
        bundled: ui('cmu typewriter (bundled)'),
        obsidian: ui("obsidian's monospace font"),
        system: ui('system monospace'),
      };
      const names = new Set(CANDIDATE_FONTS.filter((n) => isInstalled(n)));
      this.scanned.forEach((n) => names.add(n));
      if (s.font.indexOf('family:') === 0) names.add(s.font.slice(7));
      Array.from(names)
        .sort((a, b) => a.localeCompare(b))
        .forEach((n) => { opts['family:' + n] = n; });
      opts.custom = ui('custom…');
      return opts;
    };

    let custom = null;

    new UiSetting(containerEl)
      .setName('font')
      .setDesc('the default font is bundled with the plugin, so nothing needs installing. or pick a monospace font from this computer.')
      .addDropdown((dropdown) => {
        this.fontDropdown = dropdown;
        dropdown
          .addOptions(choices())
          .setValue(s.font)
          .onChange((value) => {
            s.font = value;
            if (custom) custom.settingEl.hidden = value !== 'custom';
            apply('look');
          });
      });

    custom = new UiSetting(containerEl)
      .setName('custom font')
      .setDesc('any css font-family list, such as "JetBrains Mono", monospace')
      .addText((text) => text
        .setPlaceholder('"JetBrains Mono", monospace')
        .setValue(s.customFont)
        .onChange((value) => {
          s.customFont = value;
          apply('look');
        }));
    custom.settingEl.hidden = s.font !== 'custom';

    new UiSetting(containerEl)
      .setName('find monospace fonts')
      .setDesc("adds every monospace font installed on this computer to the menu above. obsidian may ask for permission first. if this version can't do it, the menu still lists the common fonts it finds.")
      .addButton((button) => button
        .setButtonText(ui('scan'))
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const list = await scanSystemFonts();
            if (!list) {
              new Notice(ui("this version of obsidian can't list system fonts. use a custom font instead."));
            } else {
              this.scanned = list;
              this.fontDropdown.selectEl.empty();
              this.fontDropdown.addOptions(choices());
              this.fontDropdown.setValue(s.font);
              new Notice(ui('found ' + list.length + ' monospace fonts.'));
            }
          } catch (e) {
            new Notice(ui('could not read the font list. use a custom font instead.'));
          }
          button.setDisabled(false);
        }));

    /* ── reset ── */
    new UiSetting(containerEl).setName('reset').setHeading();

    new UiSetting(containerEl)
      .setName('reset appearance')
      .setDesc('puts every colour, shape, card, cover, bar and motion option back to the default. your sources, prompt text, pills, font and look are not touched.')
      .addButton((b) => b.setButtonText(ui('reset')).setWarning().onClick(async () => {
        for (const k of ['palette', 'inkColour', 'pillShape', 'cardWidth', 'card', 'art', 'bars', 'motion']) {
          s[k] = clone(DEFAULT_SETTINGS[k]);
        }
        await plugin.saveSettings();
        this.display();
      }));

    new UiSetting(containerEl)
      .setName('reset everything')
      .setDesc('puts every option on this page back to the default.')
      .addButton((b) => b.setButtonText(ui('reset')).setWarning().onClick(async () => {
        plugin.settings = sanitise(clone(DEFAULT_SETTINGS));
        uiCase.lower = plugin.settings.lowercaseUi;
        await plugin.saveSettings();
        this.display();
      }));
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   the plugin
   ═══════════════════════════════════════════════════════════════════════ */

module.exports = class MishMusic extends Plugin {
  async onload() {
    await this.loadSettings();
    this.player = new Player(this);

    mountRainbow(this.settings);
    this.addSettingTab(new MusicSettingTab(this.app, this));

    /* theme changes: repaint the icon gradient (see mountRainbow for why it can't just use var()),
       and redo the colours that depend on light / dark (a custom palette darkens its text colours) */
    const repaint = () => this.restyle();
    this.registerEvent(this.app.workspace.on('css-change', () => {
      repaint();
      window.setTimeout(repaint, 250);
    }));
    let wasLight = lightTheme();
    const watcher = new MutationObserver(() => {
      if (lightTheme() === wasLight) return;
      wasLight = lightTheme();
      repaint();
    });
    watcher.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.register(() => watcher.disconnect());

    this.registerView(VIEW_TYPE, (leaf) => new MusicView(leaf, this));

    const ribbon = this.addRibbonIcon('music', 'Open music', () => this.activate());
    ribbon.addClass('mish-music-ribbon');
    this.addCommand({ id: 'open-music', name: 'Open music in sidebar', callback: () => this.activate() });
    this.addCommand({ id: 'play-pause', name: 'Play / pause', callback: () => this.player.cmd('toggle') });
    this.addCommand({ id: 'next-track', name: 'Next track', callback: () => this.player.cmd('next') });
    this.addCommand({ id: 'previous-track', name: 'Previous track', callback: () => this.player.cmd('prev') });
    this.addCommand({
      id: 'toggle-look',
      name: 'Switch between player and terminal look',
      callback: () => this.setLook(this.settings.look === 'card' ? 'terminal' : 'card'),
    });
    this.addCommand({
      id: 'type-command',
      name: 'Type a command (terminal look)',
      callback: async () => {
        await this.activate();
        this.setLook('terminal');
        this.eachView((v) => v.focusInput());
      },
    });

    /* one tick a second; the player decides if it is time to look (and never looks while hidden) */
    this.registerInterval(window.setInterval(() => this.player.maybePoll(), 1000));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.eachView((v) => v.syncWidth());
      this.player.poll();
    }));

    /* first run: put it in the left sidebar without stealing focus.
       after that, obsidian restores it from the saved layout. */
    this.app.workspace.onLayoutReady(async () => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length) return;
      const leaf = this.app.workspace.getLeftLeaf(false);
      if (leaf) await leaf.setViewState({ type: VIEW_TYPE, active: false });
    });
  }

  onunload() {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveData(this.settings);
    }
    if (this.player) this.player.destroy();
    unmountRainbow();
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = sanitise(deepMerge(clone(DEFAULT_SETTINGS), saved));
    uiCase.lower = this.settings.lowercaseUi;
  }

  async saveSettings() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    sanitise(this.settings);
    await this.saveData(this.settings);
    this.refreshViews();
    this.player.poll(true);
    this.player.pollSystem(true);
  }

  /* slider drags: save a moment after the last change */
  persist() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      this.saveData(this.settings);
    }, 500);
  }

  /* styles only (colours, sizes, border, font): cheaper than refreshViews, no prompt redraw */
  restyle() {
    paintRainbow(this.settings);
    this.eachView((v) => v.applyLook());
  }

  /* card <-> terminal. both looks are already painted, so this is just a class and a save */
  setLook(look) {
    if (!LOOKS.includes(look) || this.settings.look === look) return;
    this.settings.look = look;
    this.restyle();
    this.persist();
  }

  refreshViews() { this.eachView((v) => v.applySettings()); }

  eachView(fn) {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof MusicView) fn(leaf.view);
    });
  }

  /* the source pill: auto > music.app > safari > auto */
  async setPrefer(value) {
    if (!PREFER.includes(value)) return;
    this.settings.prefer = value;
    this.player.cur = 'none';
    await this.saveSettings();
  }

  async cyclePrefer() {
    const i = PREFER.indexOf(this.settings.prefer);
    await this.setPrefer(PREFER[(i + 1) % PREFER.length]);
    new Notice('music source: ' + (this.settings.prefer === 'music' ? 'music.app' : this.settings.prefer));
  }

  async activate() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }
};
