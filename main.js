'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   mish.music
   a powerline prompt + a now-playing card, as a sidebar view.
   it shows (and controls) whatever is playing in music.app, or in a safari tab
   on youtube / soundcloud / jiosaavn (the list is in settings).
   dressed like mish.eza and mish.fastfetch: same prompt, same rainbow ring,
   same palette variables, same bundled font.

   two looks, one player: "card" (cover art, icons, sliders) and "terminal" (the old
   mpv-style screen: a flags line, block progress bar, commands as words, and a command
   line you can type into). switch from the card itself, from settings, or from the
   command palette. both are always painted, so switching is instant.

   how it talks to the mac: osascript (JavaScript for Automation), spawned from
   obsidian's node side. nothing is installed, nothing runs in the background
   when the panel is hidden.

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
const POLLS = [1, 2, 3, 5];

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
  showArt: true,
  showVolume: true,
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
  if (!POLLS.includes(Number(cfg.poll))) cfg.poll = 2;
  cfg.poll = Number(cfg.poll);
  cfg.cardWidth = num(cfg.cardWidth, 240, 380, 300);
  cfg.sites = String(cfg.sites || '');
  cfg.pathLabel = String(cfg.pathLabel || '~/music');
  cfg.username = String(cfg.username || '');
  return cfg;
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

const lightTheme = () => document.body.classList.contains('theme-light');

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
const STOPS = [
  ['--vf-pink-hi', '--mz-pink-hi', '#ffa6c9'], ['--vf-peach', '--mz-peach', '#ffd6a6'],
  ['--vf-yellow', '--mz-yellow', '#fff1a8'], ['--vf-green', '--mz-green', '#c9ffa6'],
  ['--vf-blue', '--mz-blue', '#a6c9ff'], ['--vf-lilac', '--mz-lilac', '#c9b0ff'],
];

const resolveColour = (css) => {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;color:' + css;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
};

const paintRainbow = () => {
  const svg = document.getElementById(RAINBOW_ID);
  if (!svg) return;
  svg.querySelectorAll('stop').forEach((stop, i) => {
    const [vf, mz, fallback] = STOPS[i];
    const css = 'var(' + vf + ', var(' + mz + ', ' + fallback + '))';
    stop.style.stopColor = resolveColour(css) || css;
  });
};

const mountRainbow = () => {
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
  paintRainbow();
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

  destroy() {
    this.setBlob('');
    this.views.clear();
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   the view
   ═══════════════════════════════════════════════════════════════════════ */

const OS_GLYPH = '\uF179';

const INFO = [
  ['source', 'music.app, or a safari tab on youtube / soundcloud / jiosaavn. click the right pill to pin one.'],
  ['look', 'click "terminal" below to type commands instead of pressing buttons. "card" brings the buttons back.'],
  ['seek', 'click or drag the bar'],
  ['shuffle', 'music.app only'],
  ['repeat', 'music.app: off, all, one. safari: loops the video'],
  ['volume', 'click the speaker to mute'],
  ['safari', 'settings > advanced > show features for web developers, then developer > allow javascript from apple events'],
  ['macos', 'system settings > privacy & security > automation > obsidian > music, safari'],
];

/* the terminal look's `help` card: [what you type, what it does] */
const HELP = [
  ['play pause stop', 'stop goes back to 0:00 and waits there'],
  ['next prev', 'prev restarts the song if it has been playing a while'],
  ['seek <time>', 'seek 1:30, seek 90, seek +10, seek -15'],
  ['louder quieter', 'volume up or down by 10%'],
  ['vol <0-100>', 'sets the volume. mute toggles it'],
  ['shuffle repeat', 'shuffle: music.app only. repeat: off, all, one'],
  ['source <name>', 'auto, music or safari. same as the lilac pill'],
  ['card', 'back to the card look (exit works too)'],
  ['clear', 'wipes the message line and closes this'],
];

/* every word the terminal answers to. TERM_WORDS is what tab completes; ALIAS maps the rest onto them */
const TERM_WORDS = ['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'seek', 'louder', 'quieter', 'vol', 'mute',
  'shuffle', 'repeat', 'source', 'card', 'help', 'clear'];
const ALIAS = {
  previous: 'prev', back: 'prev', skip: 'next', pp: 'toggle', resume: 'play', up: 'louder', down: 'quieter',
  volume: 'vol', src: 'source', exit: 'card', quit: 'card', '?': 'help', cls: 'clear',
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

    /* volume */
    const vol = el('div', 'mm-volrow');
    c.mute = this.button('mm-mute', 'volume-2', 'mute', () => this.toggleMute());
    c.vol = this.slider((ratio, final) => this.volRatio(ratio, final));
    c.vol.classList.add('thin');
    c.volNum = el('span', 'mm-volnum', '');
    vol.appendChild(c.mute);
    vol.appendChild(c.vol);
    vol.appendChild(c.volNum);
    face.appendChild(vol);
    c.volRow = vol;

    /* the "what is all this" card, same as mish.fastfetch's */
    const info = el('div', 'mm-info');
    info.hidden = true;
    const icmd = el('div', 'mm-cmd');
    icmd.appendChild(el('span', 'mm-chev', '\u276F'));
    icmd.appendChild(document.createTextNode(' '));
    icmd.appendChild(el('span', 'mm-exe', 'nowplaying'));
    icmd.appendChild(document.createTextNode(' '));
    icmd.appendChild(el('span', 'mm-arg', '--info'));
    info.appendChild(icmd);
    const grid = el('div', 'mm-info-grid');
    INFO.forEach(([k, d]) => {
      grid.appendChild(el('div', 'mm-k', k));
      grid.appendChild(el('div', 'mm-info-d', d));
    });
    info.appendChild(grid);
    face.appendChild(info);

    const last = el('div', 'mm-cmd mm-last');
    last.appendChild(el('span', 'mm-chev', '\u276F'));
    last.appendChild(el('span', 'mm-cursor'));
    const tools = el('span', 'mm-tools');
    const swap = el('span', 'mm-link', 'terminal');
    swap.title = 'switch to the terminal look';
    swap.addEventListener('click', () => {
      this.plugin.setLook('terminal');
      this.focusInput();
    });
    const btn = el('span', 'mm-link mm-info-btn', '? info');
    btn.title = 'what do these things do?';
    btn.addEventListener('click', () => {
      info.hidden = !info.hidden;
      btn.textContent = info.hidden ? '? info' : '\u00D7 close';
    });
    tools.appendChild(swap);
    tools.appendChild(btn);
    last.appendChild(tools);
    face.appendChild(last);

    card.appendChild(face);
    return c;
  }

  /* look two: the old terminal player. a command line you can type into, a block progress
     bar, words instead of icons. the same fixed-size rules as the card: states are colours. */
  buildTermFace(card) {
    const t = {};
    const face = el('div', 'mm-face mm-face-term');
    t.face = face;

    /* ❯ nowplaying --src=music.app --vol=60 _   (the flags follow the real player) */
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

    /* block progress bar + clock */
    const prog = el('div', 'mm-prog mm-tprog');
    t.seek = this.slider((ratio, final) => this.seekRatio(ratio, final));
    t.seek.classList.add('blocks');
    const clock = el('span', 'mm-clock');
    t.tLeft = el('span', 'l', '--:--');
    t.tRight = el('span', 'd', '--:--');
    clock.appendChild(t.tLeft);
    clock.appendChild(el('span', 'd', ' / '));
    clock.appendChild(t.tRight);
    prog.appendChild(t.seek);
    prog.appendChild(clock);
    face.appendChild(prog);

    /* the commands, as words. clicking one is the same as typing it */
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
    t.quieter = word('w-quieter', 'quieter', 'quieter');
    t.louder = word('w-louder', 'louder', 'louder');
    face.appendChild(words);
    t.words = words;

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

    /* ❯ type a command   help  card */
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
    row.appendChild(input);
    t.input = input;

    const tools = el('span', 'mm-tools');
    t.helpBtn = el('span', 'mm-link', 'help');
    t.helpBtn.title = 'list the commands';
    t.helpBtn.addEventListener('click', () => this.toggleHelp());
    const swap = el('span', 'mm-link', 'card');
    swap.title = 'switch to the card look';
    swap.addEventListener('click', () => this.plugin.setLook('card'));
    tools.appendChild(t.helpBtn);
    tools.appendChild(swap);
    row.appendChild(tools);
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

  volRatio(ratio, final) {
    this.dragVol = ratio;
    this.tick();
    if (final) {
      const to = this.dragVol;
      this.dragVol = null;
      this.player.cmd('vol', to);
    }
  }

  /* mute / unmute. returns 'muted', 'unmuted', or false when this player won't say its volume */
  toggleMute() {
    const v = this.snap.vol;
    if (v == null) return false;
    if (v > 0) {
      this.lastVol = v;
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
    const segs = [
      ['mm-user', OS_GLYPH + ' ' + (s.username || detectUser())],
      ['mm-path', s.pathLabel],
      ['mm-ch mm-ch1', ''], ['mm-ch mm-ch2', ''], ['mm-ch mm-ch3', ''],
      ['mm-src', ''],
    ];
    const nodes = segs.map(([cls, text], i) => {
      const seg = el('span', 'mm-seg ' + cls, text);
      seg.style.zIndex = String(segs.length - i);   /* each arrow tip sits over the next segment */
      bar.appendChild(seg);
      return seg;
    });
    r.srcPill = nodes[nodes.length - 1];
    r.srcPill.addEventListener('click', () => this.plugin.cyclePrefer());

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

  /* settings that change how the card looks, including which look */
  applyLook() {
    const r = this.refs;
    const s = this.plugin.settings;
    if (!r.card || !r.c || !r.t) return;
    const term = s.look === 'terminal';
    r.card.style.setProperty('--mm-w', s.cardWidth + 'px');
    SHAPES.forEach((n) => r.card.classList.toggle('mm-shape-' + n, s.pillShape === n));
    r.card.classList.toggle('look-term', term);
    r.card.classList.toggle('look-card', !term);
    r.card.classList.toggle('no-art', !s.showArt);
    r.c.face.hidden = term;
    r.t.face.hidden = !term;
    r.c.volRow.hidden = !s.showVolume;
    if (r.fit) r.fit();
    this.fitLines();
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
        if (idle) return nothing();
        if (s.vol == null) return bad("this player won't say its volume");
        const now = Math.round(s.vol * 100);
        const to = Math.min(100, Math.max(0, now + (name === 'louder' ? 10 : -10)));
        if (to > 0) this.lastVol = to / 100;
        p.cmd('vol', to / 100);
        return ok('volume ' + to + '%');
      }

      case 'vol': {
        if (idle) return nothing();
        const n = Number(String(arg).replace('%', '').trim());
        if (!String(arg).trim() || !Number.isFinite(n) || n < 0 || n > 100) return bad('usage: vol 0-100');
        if (n > 0) this.lastVol = n / 100;
        p.cmd('vol', n / 100);
        return ok('volume ' + Math.round(n) + '%');
      }

      case 'mute': {
        if (idle) return nothing();
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

      case 'card':
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
      title: none ? 'nothing playing' : (snap.title || 'untitled'),
      artist: none ? 'play something in music.app' : (snap.artist || (snap.src === 'safari' ? snap.label : '')),
      album: none ? (snap.hint || 'or on youtube, in safari') : (snap.album || ''),
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
    const v = this.dragVol != null ? this.dragVol : s.vol;
    const vp = Math.round((v == null ? 0 : v) * 100);

    /* card */
    const c = r.c;
    c.seek.style.setProperty('--p', p);
    setText(c.tLeft, left);
    setText(c.tRight, right);
    c.vol.style.setProperty('--p', ((v == null ? 0 : v) * 100).toFixed(1) + '%');
    setText(c.volNum, v == null ? '' : vp + '%');
    this.setBtnIcon(c.mute, v == null || v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2');

    /* terminal */
    const t = r.t;
    t.seek.style.setProperty('--p', p);
    setText(t.tLeft, none ? '--:--' : left);
    setText(t.tRight, none ? '--:--' : right);

    const flags = [];
    if (!none) flags.push('--src=' + String(s.label).replace(/\s+/g, '-'));
    if (v != null) flags.push('--vol=' + vp);
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
  }

  display() {
    const { containerEl, plugin } = this;
    const s = plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName('look').setHeading();

    new Setting(containerEl)
      .setName('style')
      .setDesc('card: cover art, icons and sliders. terminal: the old mpv-style screen with a command line you can type into (try help). you can also switch from the card itself or the command palette.')
      .addDropdown((d) => d
        .addOptions({ card: 'card', terminal: 'terminal' })
        .setValue(s.look)
        .onChange(async (v) => { s.look = v; await plugin.saveSettings(); }));

    new Setting(containerEl).setName('sources').setHeading();

    new Setting(containerEl)
      .setName('music.app')
      .setDesc('show what is playing in music.app. macos asks once if obsidian may control it.')
      .addToggle((t) => t.setValue(s.sources.music).onChange(async (v) => { s.sources.music = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('safari')
      .setDesc('show video and audio playing in safari tabs. needs "allow javascript from apple events" (safari settings > developer).')
      .addToggle((t) => t.setValue(s.sources.safari).onChange(async (v) => { s.sources.safari = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('safari sites')
      .setDesc('only tabs on these sites are looked at, separated by commas. any site that plays audio or video works.')
      .addText((t) => t
        .setPlaceholder('youtube.com, soundcloud.com')
        .setValue(s.sites)
        .onChange(async (v) => { s.sites = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('prefer')
      .setDesc('auto shows whichever is playing. you can also click the right pill on the prompt.')
      .addDropdown((d) => d
        .addOptions({ auto: 'auto', music: 'music.app', safari: 'safari' })
        .setValue(s.prefer)
        .onChange(async (v) => { s.prefer = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('look again every')
      .setDesc('how often the player is asked what is playing. the bar and the clock move smoothly in between. it stops while the panel is hidden.')
      .addDropdown((d) => d
        .addOptions({ 1: '1 second', 2: '2 seconds', 3: '3 seconds', 5: '5 seconds' })
        .setValue(String(s.poll))
        .onChange(async (v) => { s.poll = Number(v); await plugin.saveSettings(); }));

    new Setting(containerEl).setName('card').setHeading();

    new Setting(containerEl)
      .setName('card width')
      .setDesc('in pixels. fixed on purpose: the card never resizes, it just moves when you resize the sidebar.')
      .addSlider((sl) => sl
        .setLimits(240, 380, 4)
        .setValue(s.cardWidth)
        .setDynamicTooltip()
        .onChange((v) => { s.cardWidth = v; plugin.restyle(); plugin.persist(); }));

    new Setting(containerEl)
      .setName('cover art')
      .setDesc('card look only')
      .addToggle((t) => t.setValue(s.showArt).onChange(async (v) => { s.showArt = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('volume row')
      .setDesc('card look only. in the terminal use louder, quieter or vol 40.')
      .addToggle((t) => t.setValue(s.showVolume).onChange(async (v) => { s.showVolume = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('prompt shape')
      .addDropdown((d) => d
        .addOptions({ arrow: 'arrow', round: 'round', flat: 'flat' })
        .setValue(s.pillShape)
        .onChange(async (v) => { s.pillShape = v; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('prompt path')
      .setDesc('the orange pill')
      .addText((t) => t
        .setPlaceholder('~/music')
        .setValue(s.pathLabel)
        .onChange(async (v) => { s.pathLabel = v.trim() || '~/music'; await plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('prompt name')
      .setDesc('empty = your mac username')
      .addText((t) => t
        .setValue(s.username)
        .onChange(async (v) => { s.username = v.trim(); await plugin.saveSettings(); }));

    new Setting(containerEl).setName('reset').setHeading();
    new Setting(containerEl)
      .setName('reset everything')
      .setDesc('puts every option on this page back to the default.')
      .addButton((b) => b.setButtonText('reset').setWarning().onClick(async () => {
        plugin.settings = sanitise(clone(DEFAULT_SETTINGS));
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

    mountRainbow();
    this.addSettingTab(new MusicSettingTab(this.app, this));

    /* theme changes: repaint the icon gradient (see mountRainbow for why it can't just use var()) */
    const repaint = () => paintRainbow();
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
      name: 'Switch between card and terminal look',
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
    this.registerEvent(this.app.workspace.on('layout-change', () => this.player.poll()));

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
  }

  async saveSettings() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    sanitise(this.settings);
    await this.saveData(this.settings);
    this.refreshViews();
    this.player.poll(true);
  }

  /* slider drags: save a moment after the last change */
  persist() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      this.saveData(this.settings);
    }, 500);
  }

  restyle() { this.eachView((v) => v.applyLook()); }

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
