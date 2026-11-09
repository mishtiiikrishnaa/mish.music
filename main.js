'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   mish.music (windows edition)
   a powerline prompt + a now-playing card, as a sidebar view.
   it shows (and controls) whatever windows says is playing: spotify, apple music, media
   player, vlc, or a browser tab on youtube / soundcloud / jiosaavn. anything that has media
   controls in the windows volume flyout works.
   dressed like mish.eza and mish.fastfetch: same prompt, same rainbow ring,
   same palette variables, same bundled font.

   two looks, one player: "player" (cover art, icons, sliders) and "terminal" (the old
   mpv-style screen: a flags line, block progress bar, commands as words, and a command
   line you can type into). switch from the card itself, from settings, or from the
   command palette. both are always painted, so switching is instant.

   how it talks to windows: the powershell.exe that ships with windows, started from
   obsidian's node side the first time the card is on screen. it reads the system media
   controls (the same ones behind the volume flyout) and the default output device's volume.
   nothing is installed, and the helper stops by itself once the panel has been hidden for a
   while. needs windows 10 (1809) or newer.

   nearly everything about how it looks is a setting, the same way as in mish.eza: the
   six rainbow colours (with presets), pill text colour, pill shape, border, corner
   radius, margin, position, text size, cover art, bars, play button, motion and font.

   the volume bar is windows' own output volume (the one the taskbar and the keyboard
   change), not the volume inside the player.

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
const PREFER = ['auto', 'app', 'browser'];
const SHAPES = ['arrow', 'round', 'flat'];
const LOOKS = ['card', 'terminal'];
const LOOK_NAME = 'player';        /* what the card look is called everywhere you can see it */
const POLLS = [1, 2, 3, 5];
const RINGS = ['rainbow', 'accent', 'subtle', 'none'];
const ALIGN_H = ['centre', 'left'];
const ALIGN_V = ['centre', 'top'];
const BAR_STYLES = ['rainbow', 'accent', 'solid'];
const PLAYS = ['gradient', 'solid', 'ghost'];
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
  [/\bwindows\b/g, 'Windows'],
  [/\bpowershell\b/g, 'PowerShell'],
  [/\bspotify\b/g, 'Spotify'],
  [/\bchrome\b/g, 'Chrome'],
  [/\bfirefox\b/g, 'Firefox'],
  [/\bmish\b(?!\.[a-z])/g, 'Mish'],      /* the palette, not mish.music / mish.eza */
  [/\bmish\.(music|eza|fastfetch)\b/g, 'mish.$1'],
];

/* commands stay lowercase even at the start of a sentence */
const KEEP_LOWER = new Set(['help', 'vol', 'louder', 'quieter', 'prefer']);

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
  sources: { apps: true, browsers: true },
  look: 'card',                   /* card | terminal. two ways of drawing the same player */
  prefer: 'auto',                 /* auto | app | browser. click the source pill to cycle */
  ignore: '',                     /* apps to leave out, separated by commas. part of the name is enough */
  poll: 2,                        /* seconds between looks at the player (the bar moves smoothly in between) */
  pillShape: 'arrow',
  pathLabel: '~/music',
  username: '',                   /* empty = auto-detect */
  cardWidth: 300,                 /* px. fixed on purpose, resizing the sidebar just moves the card */
  cardWidthFrom: 'fastfetch',     /* fastfetch | fixed. fastfetch = copy mish.fastfetch's width (when it is open), else cardWidth */
  showArt: true,
  showVolume: true,

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
  if (!WIDTHS.includes(cfg.cardWidthFrom)) cfg.cardWidthFrom = 'fastfetch';
  if (!POLLS.includes(Number(cfg.poll))) cfg.poll = 2;
  cfg.poll = Number(cfg.poll);
  cfg.cardWidth = num(cfg.cardWidth, 240, 380, 300);
  cfg.ignore = String(cfg.ignore || '');
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
  for (const k of ['apps', 'browsers']) cfg.sources[k] = cfg.sources[k] !== false;

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
    case 'system': return 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';
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

/* ── which app is it ─────────────────────────────────────────────────────
   windows names a media session by its app id: "Spotify.exe", "Chrome", "MSEdge",
   "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"... browsers count as "browser", everything
   else as "app". the pill shows a short friendly name. */
const BROWSER_RE = /chrome|msedge|microsoftedge|firefox|brave|opera|vivaldi|chromium|thorium|librewolf|waterfox/i;
const isBrowser = (id) => BROWSER_RE.test(String(id || ''));

const APP_NAMES = [
  [/spotify/i, 'spotify'],
  [/applemusic|apple\.music|itunes/i, 'apple music'],
  [/zunemusic|mediaplayer|groove/i, 'media player'],
  [/msedge|microsoftedge/i, 'edge'],
  [/chromium/i, 'chromium'],
  [/chrome/i, 'chrome'],
  [/firefox/i, 'firefox'],
  [/brave/i, 'brave'],
  [/opera/i, 'opera'],
  [/vivaldi/i, 'vivaldi'],
  [/vlc/i, 'vlc'],
  [/foobar/i, 'foobar'],
  [/musicbee/i, 'musicbee'],
  [/aimp/i, 'aimp'],
  [/tidal/i, 'tidal'],
  [/amazon/i, 'amazon music'],
  [/deezer/i, 'deezer'],
  [/youtube/i, 'youtube'],
  [/soundcloud/i, 'soundcloud'],
  [/saavn/i, 'jiosaavn'],
];

const appLabel = (id) => {
  const raw = String(id || '');
  for (const [re, name] of APP_NAMES) if (re.test(raw)) return name;
  const base = raw.split('!')[0].replace(/\.exe$/i, '').replace(/_[a-z0-9]{13}$/i, '');
  const last = base.split(/[.\\/]/).filter(Boolean).pop() || base;
  return (last || 'player').toLowerCase().slice(0, 14);
};

const ignoreList = (text) => String(text || '')
  .split(/[,;\n]+/)
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

/* text that goes to the helper is base64, so an app id with odd characters can't break the line */
const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');

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
   talking to windows
   ═══════════════════════════════════════════════════════════════════════
   one long-lived powershell.exe (windows powershell 5.1, which ships with windows) reads one
   command per line on stdin and answers each with one line of json on stdout:
       <id> TAB <command> TAB <arg> TAB <arg>   ->   <id> TAB {json}
   it does two jobs:
     · media: the system media transport controls (what the volume flyout and the lock screen
       use) list every app that is playing something, with title, artist, cover, position, and
       let us press play, next, seek, shuffle and repeat.
     · volume: the default output device's master volume and mute (windows core audio).
   the script is written without backticks, ${ and non-ascii characters on purpose: it lives
   inside a javascript template string, and the answers are ascii-escaped so no console code page
   can garble a title. */
const PS_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$tab = [string][char]9
$bt = [string][char]96
$bs = [string][char]92
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Json($obj) {
  $j = ConvertTo-Json -InputObject $obj -Depth 5 -Compress
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $j.ToCharArray()) {
    $n = [int]$ch
    if ($n -lt 127) { [void]$sb.Append($ch) }
    else { [void]$sb.Append($bs + 'u' + $n.ToString('x4')) }
  }
  return $sb.ToString()
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$mgr = $null
$mgrErr = ''
$asTask = $null
try {
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
  [Windows.Media.MediaPlaybackAutoRepeatMode,Windows.Media,ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + $bt + '1')
  })[0]
} catch { $mgrErr = $_.Exception.Message }

function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(6000)) { throw 'a windows call timed out' }
  return $task.Result
}

if (-not $mgrErr) {
  try {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  } catch { $mgrErr = $_.Exception.Message }
}

$audioSrc = @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint n);
  int SetMasterVolumeLevel(float level, ref Guid ctx);
  int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint ch, float level, ref Guid ctx);
  int SetChannelVolumeLevelScalar(uint ch, float level, ref Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float level);
  int GetChannelVolumeLevelScalar(uint ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IAudioEndpointVolume volume);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public static class MishAudio {
  static IAudioEndpointVolume Endpoint() {
    IMMDeviceEnumerator en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume vol;
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out vol));
    return vol;
  }
  public static float Volume {
    get { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(value, ref g)); }
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
    set { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(value, ref g)); }
  }
}
'@

$audioReady = $false
$audioErr = ''
function Ensure-Audio {
  if ($global:audioReady) { return }
  if ($global:audioErr) { throw $global:audioErr }
  try {
    Add-Type -TypeDefinition $audioSrc
    $global:audioReady = $true
  } catch {
    $global:audioErr = 'volume control unavailable: ' + $_.Exception.Message
    throw $global:audioErr
  }
}

function Get-Timeline($s) {
  $pb = $s.GetPlaybackInfo()
  $tl = $s.GetTimelineProperties()
  $start = $tl.StartTime.TotalSeconds
  $dur = $tl.EndTime.TotalSeconds - $start
  if ($dur -lt 0) { $dur = 0 }
  $pos = $tl.Position.TotalSeconds - $start
  if ($pb.PlaybackStatus.ToString() -eq 'Playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
    $d = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
    if ($d -gt 0 -and $d -lt 86400) { $pos += $d }
  }
  if ($pos -lt 0) { $pos = 0 }
  if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
  return @{ start = $start; dur = $dur; pos = $pos }
}

function Get-Sessions {
  $list = @()
  foreach ($s in $mgr.GetSessions()) {
    try {
      $pb = $s.GetPlaybackInfo()
      $t = Get-Timeline $s
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $shuffle = $false
      if ($null -ne $pb.IsShuffleActive) { $shuffle = [bool]$pb.IsShuffleActive }
      $repeat = 'None'
      if ($null -ne $pb.AutoRepeatMode) { $repeat = $pb.AutoRepeatMode.ToString() }
      $c = $pb.Controls
      $list += [pscustomobject]@{
        id = [string]$s.SourceAppUserModelId
        status = $pb.PlaybackStatus.ToString()
        title = [string]$p.Title
        artist = [string]$p.Artist
        album = [string]$p.AlbumTitle
        dur = [math]::Round($t.dur, 2)
        pos = [math]::Round($t.pos, 2)
        shuffle = $shuffle
        repeat = $repeat
        canShuffle = [bool]$c.IsShuffleEnabled
        canRepeat = [bool]$c.IsRepeatEnabled
      }
    } catch { }
  }
  return ,$list
}

function Find-Session($id) {
  $found = $null
  foreach ($s in $mgr.GetSessions()) {
    if ($s.SourceAppUserModelId -ne $id) { continue }
    if ($null -eq $found) { $found = $s }
    if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { return $s }
  }
  return $found
}

function Run-Cmd($cmd, $a1, $a2) {
  switch ($cmd) {
    'poll' {
      if ($null -eq $mgr) { return (Json @{ error = ('media controls unavailable: ' + $mgrErr) }) }
      return (Json @{ sessions = (Get-Sessions) })
    }
    'volget' {
      Ensure-Audio
      return (Json @{ vol = [math]::Round([MishAudio]::Volume, 3); muted = [MishAudio]::Mute })
    }
    'volset' {
      Ensure-Audio
      $pct = [math]::Min(100, [math]::Max(0, [double]::Parse($a1, $inv)))
      [MishAudio]::Volume = [float]($pct / 100)
      if ($pct -gt 0) { [MishAudio]::Mute = $false }
      return '{"ok":true}'
    }
    'muteset' {
      Ensure-Audio
      [MishAudio]::Mute = ($a1 -eq '1')
      return '{"ok":true}'
    }
    default {
      if ($null -eq $mgr) { return (Json @{ error = ('media controls unavailable: ' + $mgrErr) }) }
      $id = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($a1))
      $s = Find-Session $id
      if ($null -eq $s) { return '{"gone":true}' }
      $ok = $false
      switch ($cmd) {
        'toggle' {
          if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $ok = Await ($s.TryPauseAsync()) ([bool]) }
          else { $ok = Await ($s.TryPlayAsync()) ([bool]) }
          if (-not $ok) { $ok = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
        }
        'next' { $ok = Await ($s.TrySkipNextAsync()) ([bool]) }
        'prev' {
          $t = Get-Timeline $s
          $can = [bool]$s.GetPlaybackInfo().Controls.IsPreviousEnabled
          if ($t.pos -gt 3 -or -not $can) { $ok = Await ($s.TryChangePlaybackPositionAsync([long][math]::Round($t.start * 10000000))) ([bool]) }
          else { $ok = Await ($s.TrySkipPreviousAsync()) ([bool]) }
        }
        'stop' {
          $t = Get-Timeline $s
          [void](Await ($s.TryPauseAsync()) ([bool]))
          $ok = Await ($s.TryChangePlaybackPositionAsync([long][math]::Round($t.start * 10000000))) ([bool])
        }
        'seek' {
          $t = Get-Timeline $s
          $secs = [double]::Parse($a2, $inv)
          $ok = Await ($s.TryChangePlaybackPositionAsync([long][math]::Round(($t.start + $secs) * 10000000))) ([bool])
        }
        'shuffle' {
          $cur = $s.GetPlaybackInfo().IsShuffleActive
          $ok = Await ($s.TryChangeShuffleActiveAsync((-not [bool]$cur))) ([bool])
        }
        'repeat' {
          $mode = 'None'
          if ($a2 -eq 'one') { $mode = 'Track' } elseif ($a2 -eq 'all') { $mode = 'List' }
          $ok = Await ($s.TryChangeAutoRepeatModeAsync([Windows.Media.MediaPlaybackAutoRepeatMode]$mode)) ([bool])
        }
        'art' {
          $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
          if ($null -eq $p.Thumbnail) { return '{"none":true}' }
          $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
          $ms = New-Object System.IO.MemoryStream
          try {
            $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
            $net.CopyTo($ms)
          } finally { $stream.Dispose() }
          if ($ms.Length -lt 1 -or $ms.Length -gt 4000000) { return '{"none":true}' }
          return ('{"b64":"' + [Convert]::ToBase64String($ms.ToArray()) + '"}')
        }
        default { return (Json @{ error = ('unknown command ' + $cmd) }) }
      }
      return (Json @{ ok = [bool]$ok })
    }
  }
}

$stdin = [Console]::In
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  $f = $line.Split($tab)
  $reqId = $f[0]
  $cmd = ''
  if ($f.Length -gt 1) { $cmd = $f[1] }
  $a1 = ''
  if ($f.Length -gt 2) { $a1 = $f[2] }
  $a2 = ''
  if ($f.Length -gt 3) { $a2 = $f[3] }
  try { $out = Run-Cmd $cmd $a1 $a2 }
  catch { $out = Json @{ error = [string]$_.Exception.Message } }
  if ($out -is [array]) { $out = [string]$out[$out.Count - 1] }
  [Console]::Out.WriteLine($reqId + $tab + $out)
}
`;

/* the node side of the helper: starts it on demand, matches answers to requests by id,
   and stops it when it hangs, when the panel has been hidden a while, and on unload.
   every request resolves (never rejects) to { ok: true, data } or { ok: false, err }. */
class PsHelper {
  constructor() {
    this.proc = null;
    this.file = '';
    this.buf = '';
    this.err = '';
    this.lastErr = '';
    this.seq = 0;
    this.pending = new Map();
    this.lastUse = 0;
  }

  ensure() {
    if (this.proc) return true;
    if (!cp || !fs || !nodeOs || !nodePath) { this.lastErr = 'node is not available'; return false; }
    try {
      const pid = (typeof process !== 'undefined' && process.pid) || 0;
      const root = (typeof process !== 'undefined' && process.env && process.env.SystemRoot) || 'C:\\Windows';
      const exe = nodePath.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      this.file = nodePath.join(nodeOs.tmpdir(), 'mish-music-helper-' + pid + '.ps1');
      fs.writeFileSync(this.file, PS_HELPER, 'utf8');
      /* -ExecutionPolicy Bypass only applies to this one process: nothing on the system is changed.
         node quotes the path for us, so spaces in a user name are fine. */
      const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.file];
      const proc = cp.spawn(fs.existsSync(exe) ? exe : 'powershell.exe', args,
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;
      this.buf = '';
      this.err = '';
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => this.onData(chunk));
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (chunk) => { this.err = (this.err + chunk).slice(-400); });
      proc.stdin.on('error', () => { /* the helper died; 'exit' below handles it */ });
      proc.on('error', (e) => this.onDead(proc, String((e && e.message) || e)));
      proc.on('exit', (code) => this.onDead(proc, 'powershell exited (' + code + ') ' + this.err.trim()));
      return true;
    } catch (e) {
      this.proc = null;
      this.lastErr = String((e && e.message) || e);
      return false;
    }
  }

  onData(chunk) {
    this.buf += chunk;
    let at;
    while ((at = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, at).replace(/^\uFEFF/, '').replace(/\r$/, '');
      this.buf = this.buf.slice(at + 1);
      const tab = line.indexOf('\t');
      if (tab < 0) continue;                                   /* stray output: ignore */
      const id = Number(line.slice(0, tab));
      const job = this.pending.get(id);
      if (!job) continue;
      this.pending.delete(id);
      window.clearTimeout(job.timer);
      try {
        job.resolve({ ok: true, data: JSON.parse(line.slice(tab + 1)) });
      } catch (e) {
        job.resolve({ ok: false, err: 'unreadable answer from powershell' });
      }
    }
  }

  request(cmd, args, timeout) {
    return new Promise((resolve) => {
      if (!this.ensure()) { resolve({ ok: false, err: this.lastErr || 'powershell is not available' }); return; }
      const id = ++this.seq;
      const timer = window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        resolve({ ok: false, err: 'timeout' });
        this.stop();                                          /* hung: the next request starts a fresh one */
      }, timeout || 15000);
      this.pending.set(id, { resolve, timer });
      this.lastUse = Date.now();
      const clean = (v) => String(v).replace(/[\t\r\n]+/g, ' ');
      try {
        this.proc.stdin.write([id, cmd].concat((args || []).map(clean)).join('\t') + '\n');
      } catch (e) {
        window.clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, err: String((e && e.message) || e) });
      }
    });
  }

  failAll(why) {
    const jobs = Array.from(this.pending.values());
    this.pending.clear();
    jobs.forEach((job) => { window.clearTimeout(job.timer); job.resolve({ ok: false, err: why }); });
  }

  onDead(proc, why) {
    if (this.proc !== proc) return;                           /* an old helper we already replaced */
    this.proc = null;
    this.lastErr = why;
    this.failAll(why);
    this.cleanup();
  }

  idleStop(ms) {
    if (this.proc && Date.now() - this.lastUse > ms) this.stop();
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.failAll('stopped');
    if (proc) {
      try { proc.stdin.end(); } catch (e) { /* already gone */ }
      try { proc.kill(); } catch (e) { /* already gone */ }
    }
    this.cleanup();
  }

  cleanup() {
    if (this.file && fs) { try { fs.unlinkSync(this.file); } catch (e) { /* fine */ } }
  }
}

/* cover bytes -> a blob url, whatever the format. some apps put a short header in front, so look for the magic bytes */
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
  else if ((at = sig([0x52, 0x49, 0x46, 0x46], 0)) >= 0 && buf[at + 8] === 0x57 && buf[at + 9] === 0x45 && buf[at + 10] === 0x42 && buf[at + 11] === 0x50) type = 'image/webp';
  else if ((at = sig([0x47, 0x49, 0x46, 0x38], 0)) >= 0) type = 'image/gif';
  if (!type) return '';
  return URL.createObjectURL(new Blob([buf.subarray(at)], { type }));
};

/* ═══════════════════════════════════════════════════════════════════════
   the player: one per plugin, shared by every open view.
   it asks windows what is playing, decides which app the card should show,
   and turns button presses into commands.
   ═══════════════════════════════════════════════════════════════════════ */

const idleSnap = (hint) => ({
  src: 'none', label: 'idle', playing: false, title: '', artist: '', album: '', art: '',
  dur: 0, pos: 0, at: Date.now(), vol: null, shuffle: false, repeat: 'off',
  canShuffle: false, canRepeat: false, key: '', sid: '', hint: hint || '',
});

const REPEAT_FROM_WINDOWS = { None: 'off', Track: 'one', List: 'all' };
const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };

class Player {
  constructor(plugin) {
    this.plugin = plugin;
    this.helper = new PsHelper();
    this.snap = idleSnap();
    this.views = new Set();
    this.cur = 'none';
    this.busy = false;
    this.lastPoll = 0;
    this.wasPlaying = { app: false, browser: false };
    this.last = { app: '', browser: '' };   /* the app shown last for each kind, so two players don't keep swapping */
    this.hold = {};                  /* fields we just changed ourselves: ignore the player's old answer for a moment */
    this.artKey = '';
    this.artBlob = '';
    this.warned = '';
    this.sys = { vol: null, muted: false, checked: false };   /* windows' own output volume */
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

  /* called once a second; looks at the player every `poll` seconds, and only while a card is on screen.
     while nothing is on screen the helper is let go after half a minute. */
  maybePoll() {
    if (!this.visible()) { this.helper.idleStop(30000); return; }
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

  /* one windows media session -> what the card shows. `kind` is 'app' or 'browser' */
  fromSession(d, kind) {
    return {
      src: kind, label: appLabel(d.id), playing: d.status === 'Playing',
      title: d.title || '', artist: d.artist || '', album: d.album || '', art: '',
      dur: Number(d.dur) || 0, pos: Number(d.pos) || 0, at: Date.now(),
      vol: null,                     /* windows has no per-app volume in this api: the bar is the system volume */
      shuffle: Boolean(d.shuffle), repeat: REPEAT_FROM_WINDOWS[d.repeat] || 'off',
      canShuffle: Boolean(d.canShuffle), canRepeat: Boolean(d.canRepeat),
      key: kind + '|' + d.id + '|' + d.title + '|' + d.artist, sid: d.id, hint: '',
    };
  }

  /* of several apps of one kind: the one that is playing (the one we showed last, if several are), else the last shown */
  pickSession(list, lastId) {
    if (!list.length) return null;
    return list.find((d) => d.status === 'Playing' && d.id === lastId)
      || list.find((d) => d.status === 'Playing')
      || list.find((d) => d.id === lastId)
      || list[0];
  }

  /* which kind the card shows. the one that is playing wins; if both are, the one that
     started most recently; if neither, the last one that had something. */
  choose(cand, prefer) {
    const order = prefer === 'app' ? ['app'] : prefer === 'browser' ? ['browser'] : ['app', 'browser'];
    const playing = order.filter((k) => cand[k] && cand[k].playing);
    let pick = 'none';
    if (playing.length) {
      pick = playing.includes(this.cur) ? this.cur : (playing.find((k) => !this.wasPlaying[k]) || playing[0]);
    } else if (order.includes(this.cur) && cand[this.cur]) {
      pick = this.cur;
    } else {
      pick = order.find((k) => cand[k]) || 'none';
    }
    this.wasPlaying = { app: Boolean(cand.app && cand.app.playing), browser: Boolean(cand.browser && cand.browser.playing) };
    return pick;
  }

  async poll(force) {
    if (this.busy) return;
    if (!force && !this.visible()) return;
    this.busy = true;
    this.lastPoll = Date.now();
    try {
      if (!cp || !Platform.isWin) {
        this.emit(idleSnap('this plugin needs windows 10 or 11'));
        return;
      }
      const s = this.plugin.settings;
      const cand = { app: null, browser: null };
      const hints = [];

      if (!s.sources.apps && !s.sources.browsers) {
        hints.push('turn on a source in settings');
      } else {
        const r = await this.helper.request('poll', [], 20000);
        if (!r.ok) {
          hints.push('media controls: no answer');
          if (r.err !== this.warned) { this.warned = r.err; console.warn('[mish.music]', r.err); }
        } else if (r.data && r.data.error) {
          hints.push(String(r.data.error).slice(0, 70));
        } else {
          const raw = r.data && r.data.sessions;
          const sessions = Array.isArray(raw) ? raw : (raw ? [raw] : []);
          const skip = ignoreList(s.ignore);
          const groups = { app: [], browser: [] };
          for (const d of sessions) {
            if (!d || !d.id) continue;
            if (!['Playing', 'Paused', 'Changing'].includes(d.status)) continue;
            if (!d.title && !d.artist) continue;
            const id = String(d.id).toLowerCase();
            const label = appLabel(d.id);
            if (skip.some((t) => id.includes(t) || label.includes(t))) continue;
            const kind = isBrowser(d.id) ? 'browser' : 'app';
            if (kind === 'app' ? s.sources.apps : s.sources.browsers) groups[kind].push(d);
          }
          ['app', 'browser'].forEach((kind) => {
            const d = this.pickSession(groups[kind], this.last[kind]);
            if (d) { cand[kind] = this.fromSession(d, kind); this.last[kind] = d.id; }
          });
        }
      }

      const pick = this.choose(cand, s.prefer);
      this.cur = pick;
      const next = pick === 'none' ? idleSnap(hints[0] || '') : cand[pick];

      /* things we just changed ourselves keep their new value for a moment */
      const now = Date.now();
      Object.keys(this.hold).forEach((f) => { if (now > this.hold[f]) delete this.hold[f]; });
      if (next.src !== 'none' && next.src === this.snap.src && next.key === this.snap.key) {
        ['playing', 'shuffle', 'repeat'].forEach((f) => { if (this.hold[f]) next[f] = this.snap[f]; });
        if (this.hold.pos) { next.pos = this.snap.pos; next.at = this.snap.at; }
      }

      /* cover art: asked for once per song, then kept as a blob url */
      if (next.src !== 'none') {
        if (this.artKey !== next.key) {
          this.artKey = next.key;
          this.setBlob('');
          this.fetchArt(next.key, next.sid, 0);
        }
        next.art = this.artBlob;
      } else if (this.artKey) {
        this.artKey = '';
        this.setBlob('');
      }

      this.emit(next);
    } finally {
      this.busy = false;
    }
  }

  /* some apps update the cover a moment after the title, so an empty answer is tried again a few times */
  async fetchArt(key, sid, tries) {
    const r = await this.helper.request('art', [b64(sid)], 15000);
    if (this.artKey !== key) return;
    const data64 = r.ok && r.data && r.data.b64;
    let url = '';
    try { url = data64 ? coverBlob(Buffer.from(data64, 'base64')) : ''; } catch (e) { url = ''; }
    if (!url) {
      if (tries < 3) window.setTimeout(() => { if (this.artKey === key) this.fetchArt(key, sid, tries + 1); }, 1500);
      return;                        /* no cover: the card keeps its placeholder */
    }
    this.setBlob(url);
    this.emit(Object.assign({}, this.snap, { art: url }));
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
    } else if (name === 'shuffle') {
      if (!s.canShuffle) return;
      this.emit(Object.assign({}, s, { shuffle: !s.shuffle }));
      guard('shuffle');
    } else if (name === 'repeat') {
      if (!s.canRepeat) return;
      const nextRepeat = REPEAT_NEXT[s.repeat] || 'off';
      sent = nextRepeat;
      this.emit(Object.assign({}, s, { repeat: nextRepeat }));
      guard('repeat');
    }

    if (s.sid) {
      const args = [b64(s.sid)];
      if (sent != null) args.push(String(sent));
      await this.helper.request(name, args, 15000);
    }

    window.setTimeout(() => this.poll(true), 350);
  }

  /* ── windows' output volume ──────────────────────────────────────────────
     the master volume of the default output device, the one the taskbar speaker and the
     keyboard change. if it can't be read, `vol` stays null and the bar stays empty. */
  async pollSystem(force) {
    if (!cp || !Platform.isWin) return;
    if (this.sysPolling || this.sysBusy) return;
    if (!force && (Date.now() < this.sysHold || !this.visible())) return;
    this.sysPolling = true;
    try {
      const r = await this.helper.request('volget', [], 30000);
      if (this.sysBusy || Date.now() < this.sysHold) return;       /* we changed it while asking */
      if (!r.ok) {
        this.sys.checked = true;                                   /* keep the last known value */
      } else {
        const d = r.data || {};
        const v = Number(d.vol);
        this.sys = {
          vol: d.error || d.vol == null || !Number.isFinite(v) ? null : Math.min(1, Math.max(0, v)),
          muted: Boolean(d.muted),
          checked: true,
        };
      }
      this.views.forEach((view) => view.tick());
    } finally {
      this.sysPolling = false;
    }
  }

  /* the bar moves at once; windows is told in the background. while you drag, only the newest
     value is sent (one request at a time), so it never queues up. dragging unmutes. */
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
        await this.helper.request('volset', [String(pct)], 30000);
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
    this.helper.request('muteset', [muted ? '1' : '0'], 30000);
  }

  destroy() {
    this.setBlob('');
    this.views.clear();
    this.helper.stop();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   the view
   ═══════════════════════════════════════════════════════════════════════ */

const OS_GLYPH = '\uF17A';        /* the windows logo (U+F17A is in the bundled icon font) */

/* the terminal look's `help` card: [what you type, what it does] */
const HELP = [
  ['play pause stop', 'stop goes back to 0:00 and waits there'],
  ['next prev', 'prev restarts the song if it has been playing a while'],
  ['seek <time>', 'seek 1:30, seek 90, seek +10, seek -15'],
  ['louder quieter', "volume up or down by 10%. it is windows' volume"],
  ['vol <0-100>', 'sets the volume. mute toggles it'],
  ['shuffle repeat', 'only where the player supports them. repeat: off, all, one'],
  ['source <name>', 'auto, app or browser. same as the lilac pill'],
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
      this.say(res || "can't read the windows volume", res ? 'ok' : 'err');
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

  /* where the volume bar gets its number: windows' own output volume (null until it has been read) */
  volState() {
    const sys = this.player.sys;
    return { kind: 'system', v: sys.vol, muted: Boolean(sys.muted) };
  }

  setVolume(ratio) {
    this.player.setSystemVolume(ratio);
  }

  volRatio(ratio, final) {
    this.dragVol = ratio;
    this.player.setSystemVolume(ratio);       /* the real volume follows the drag */
    this.tick();
    if (final) {
      this.dragVol = null;
      this.tick();
    }
  }

  /* mute / unmute. returns 'muted', 'unmuted', or false when the volume can't be read */
  toggleMute() {
    const st = this.volState();
    if (st.v == null) return false;
    this.player.setSystemMuted(!st.muted);
    return st.muted ? 'unmuted' : 'muted';
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
    r.srcPill.title = 'click to switch source: auto, app, browser (now: ' + this.plugin.settings.prefer + ')';
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
        if (vs.v == null) return bad("can't read the windows volume");
        const now = Math.round(vs.v * 100);
        const to = Math.min(100, Math.max(0, now + (name === 'louder' ? 10 : -10)));
        this.setVolume(to / 100);
        return ok('volume ' + to + '%');
      }

      case 'vol': {
        const n = Number(String(arg).replace('%', '').trim());
        if (!String(arg).trim() || !Number.isFinite(n) || n < 0 || n > 100) return bad('usage: vol 0-100');
        this.setVolume(n / 100);
        return ok('volume ' + Math.round(n) + '%');
      }

      case 'mute': {
        const res = this.toggleMute();
        return res ? ok(res) : bad("can't read the windows volume");
      }

      case 'shuffle':
        if (idle) return nothing();
        if (!s.canShuffle) return bad('this player has no shuffle');
        p.cmd('shuffle');
        return ok('shuffle ' + (s.shuffle ? 'off' : 'on'));

      case 'repeat': {
        if (idle) return nothing();
        if (!s.canRepeat) return bad('this player has no repeat');
        const next = REPEAT_NEXT[s.repeat] || 'off';
        p.cmd('repeat');
        return ok('repeat ' + next);
      }

      case 'source': {
        const want = String(arg).trim().toLowerCase();
        if (!want) return ok('source: ' + this.plugin.settings.prefer);
        const map = { auto: 'auto', app: 'app', apps: 'app', music: 'app', browser: 'browser', browsers: 'browser', web: 'browser', youtube: 'browser' };
        if (!map[want]) return bad('source: auto, app or browser');
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
      artist: none ? 'play something in any media app' : (tidy(snap.artist) || (snap.src === 'browser' ? snap.label : '')),
      album: none ? (snap.hint || 'or on youtube, in your browser') : tidy(snap.album),
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
    c.repeat.classList.toggle('is-na', !snap.canRepeat && !none);
    this.setBtnIcon(c.repeat, snap.repeat === 'one' ? 'repeat-1' : 'repeat');
    c.shuffle.title = snap.canShuffle || none ? 'shuffle' : 'shuffle (not supported here)';
    c.repeat.title = snap.canRepeat ? 'repeat: ' + snap.repeat : (none ? 'repeat' : 'repeat (not supported here)');

    /* terminal look: words swap in place, "on" is an underline */
    setText(t.play, snap.playing ? 'pause' : 'play');
    t.shuffle.classList.toggle('is-on', snap.shuffle);
    t.shuffle.classList.toggle('is-na', !snap.canShuffle && !none);
    t.repeat.classList.toggle('is-on', snap.repeat !== 'off');
    t.repeat.classList.toggle('is-na', !snap.canRepeat && !none);
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

    saved('apps', 'show what is playing in desktop apps: spotify, apple music, media player, vlc and anything else that has media controls in the windows volume flyout.')
      .addToggle((t) => t.setValue(s.sources.apps).onChange(async (v) => { s.sources.apps = v; await plugin.saveSettings(); }));

    saved('browsers', 'show video and audio playing in chrome, edge, firefox, brave and other browsers: youtube, soundcloud, jiosaavn and so on. nothing to turn on or install.')
      .addToggle((t) => t.setValue(s.sources.browsers).onChange(async (v) => { s.sources.browsers = v; await plugin.saveSettings(); }));

    saved('ignore apps', 'apps to leave out, separated by commas. part of the name is enough, for example: vlc, teams. empty shows everything.')
      .addText((t) => t
        .setPlaceholder('vlc, teams')
        .setValue(s.ignore)
        .onChange(async (v) => { s.ignore = v; await plugin.saveSettings(); }));

    saved('prefer', 'auto shows whichever is playing. you can also click the right pill on the prompt.')
      .addDropdown((d) => d
        .addOptions(uiOptions({ auto: 'auto', app: 'apps', browser: 'browsers' }))
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

    saved('volume bar', "show the volume bar, in both looks. it is windows' output volume: it moves when you press the volume keys, and dragging it sets the real volume. the terminal also takes louder, quieter and vol 40.")
      .addToggle((t) => t.setValue(s.showVolume).onChange(async (v) => { s.showVolume = v; await plugin.saveSettings(); }));
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

  /* the source pill: auto > apps > browsers > auto */
  async setPrefer(value) {
    if (!PREFER.includes(value)) return;
    this.settings.prefer = value;
    this.player.cur = 'none';
    await this.saveSettings();
  }

  async cyclePrefer() {
    const i = PREFER.indexOf(this.settings.prefer);
    await this.setPrefer(PREFER[(i + 1) % PREFER.length]);
    new Notice('music source: ' + ({ auto: 'auto', app: 'apps', browser: 'browsers' }[this.settings.prefer] || 'auto'));
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
