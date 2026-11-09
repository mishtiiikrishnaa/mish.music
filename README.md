# mish.music

a starship-style now-playing card for the Obsidian sidebar. it shows, and controls, whatever is playing in **Music.app**, or in a **Safari** tab (YouTube, SoundCloud, JioSaavn, or any site you list).

two looks, one player, always in sync:

- **player**: cover art, icon buttons, a seek bar and a volume bar.
- **terminal**: an mpv-style screen with a flags line, a block progress bar, and a command line you can type into.

it is the third of the family, dressed like [mish.eza](https://github.com/mishtiiikrishnaa/mish.eza) and [mish.fastfetch](https://github.com/mishtiiikrishnaa/mish.fastfetch): the same powerline prompt, the same rainbow ring, the same palette, the same bundled font.

> **macOS only, desktop only.** the plugin talks to your Mac by running `osascript`. on Windows and Linux the card just says it needs macOS, and mobile cannot load it at all.

## requirements

- macOS
- Obsidian 1.15.0 or newer, desktop
- Music.app and/or Safari

## install

**by hand.** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/mishtiiikrishnaa/mish.music/releases/latest), put them in `<your vault>/.obsidian/plugins/mish-music/`, reload Obsidian, and switch the plugin on under settings, community plugins.

**with BRAT.** add `mishtiiikrishnaa/mish.music` as a beta plugin.

then click the music note in the ribbon, or run **Open music in sidebar** from the command palette.

## first run: two permissions

**Music.app.** the first time the plugin asks Music what is playing, macOS asks whether Obsidian may control it. say yes. if you said no by accident, it lives in System Settings, Privacy & Security, Automation.

**Safari.** reading a tab needs one switch: in Safari, settings, Developer, turn on **Allow JavaScript from Apple Events**. (if you cannot see the Developer tab, turn on "Show features for web developers" under the Advanced tab first.) when the switch is off, the card tells you so.

## what works where

| | Music.app | Safari tab |
| --- | --- | --- |
| play, pause, stop | yes | yes |
| next, previous | yes (previous restarts the track if it has played for more than 3 seconds) | uses the site's own next and previous buttons, else skips to the end or restarts |
| seek | yes | yes |
| shuffle | yes | no |
| repeat | off, all, one | loops the current video, on or off |
| cover art | the track's own artwork | what the page reports, else a YouTube thumbnail |

**auto** shows whichever is playing. it sticks with the one you are watching, and moves to the other when that one starts playing. click the pill on the right of the prompt to cycle between auto, Music.app and Safari, or pin one in settings.

### volume

the volume bar is **your Mac's output volume**, the same one the menu bar and the keyboard change, not the volume inside the player. some outputs (HDMI, certain display speakers) have no volume control; there the bar falls back to the player's own volume. a setting switches it back to the player's volume for good.

## the terminal look

switch from the card itself, from settings, or with **Switch between player and terminal look**. **Type a command (terminal look)** opens the panel, switches look, and focuses the command line.

| command | what it does |
| --- | --- |
| `play`, `pause`, `toggle`, `stop` | what they say (`pp` and `resume` work too) |
| `next`, `prev` | change track (`skip`, `back`, `previous` work too) |
| `seek 1:30` · `seek +10` · `seek -15` | jump to a time, or move by seconds |
| `vol 0-100` | set the volume (`volume` works too) |
| `louder`, `quieter` | volume up or down by 10 (`up`, `down` work too) |
| `mute` | mute or unmute |
| `shuffle` | toggle shuffle (Music.app only) |
| `repeat` | cycle repeat |
| `source auto\|music\|safari` | pick where the sound comes from (`src`, and `youtube` or `web` for Safari) |
| `player` | back to the card (`exit`, `quit`, `card`) |
| `help` | show this list (`?`) |
| `clear` | clear the message line (`cls`) |

tab completes a command, up and down walk through what you typed before, escape leaves the line.

## the command palette

- Open music in sidebar
- Play / pause
- Next track
- Previous track
- Switch between player and terminal look
- Type a command (terminal look)

bind any of them to a hotkey and you can run the whole thing without touching the sidebar.

## looks

nearly everything about how it looks is a setting, under settings, mish.music:

- **look**: player or terminal.
- **prompt**: show or hide the user, path and source pills; pill shape (arrow, round or flat); the path label (`~/music` by default); the name in the first pill (auto-detected unless you type one).
- **colours**: a palette preset, six colours you can edit by hand, and the pill text colour. presets: *mish* (follows your theme, the default), catppuccin, dracula, nord, gruvbox, ocean, sunset, forest, greyscale, and custom.
- **card and layout**: border (rainbow, accent, subtle or none), border width and angle, corner radius, margin, alignment, text size, and the card width. the card has a **fixed size on purpose**: shuffle, repeat, a long title, a missing cover or an error never move or resize anything. by default it copies the width of mish.fastfetch when that is open.
- **cover art**: show it or not, its size, its corner radius, its ring.
- **controls and bars**: bar style (rainbow, accent or solid), bar height, and the play button style (gradient, solid or outline).
- **motion**: the scrolling of long titles, and the animations.
- **appearance**: the font (bundled, Obsidian's, the system's, any installed family, or a custom one), and a button that finds the monospace fonts you have.
- **lowercase ui**: the settings text is lowercase to match the terminal. turn it off for normal sentence case.
- **reset**: reset appearance, or reset everything.

## privacy, and what the plugin runs

nothing leaves your Mac because of this plugin, and there is no telemetry. to be exact about what it does:

- **it runs `osascript`.** the one and only process it starts is `/usr/bin/osascript`, through Node's `child_process.execFile`, with no shell. it uses it to ask Music.app and Safari what is playing, to send them play, pause, seek and so on, and to read and set the Mac's output volume. nothing is installed, and no helper runs in the background.
- **it sleeps when hidden.** it only looks at the player while the panel is visible, one `osascript` at a time, every 1, 2, 3 or 5 seconds (your choice, 2 by default).
- **in Safari it looks at tabs on the sites you list**, and only those (default: youtube.com, youtu.be, soundcloud.com, jiosaavn.com). for a matching tab it runs a small script inside the page that reads the media element (position, length, volume) and the page's media-session metadata (title, artist, album, artwork address). pause and seek are the same kind of script. it never reads other tabs, history, cookies or form data.
- **cover art for Music.app** is exported by Music to a single temporary file (`mish-music-cover.bin` in your system's temp folder), read back, and shown from memory.
- **the plugin makes no network requests of its own.** it does show a cover image from a web address, so Obsidian loads that image: either the artwork address the Safari page reported, or, for a YouTube video whose page reports none, the thumbnail at `i.ytimg.com`. that is an ordinary image load, the same as opening the page.
- **settings** are saved in the plugin's own `data.json`, inside your vault.

the code is one plain JavaScript file, so you can read all of it.

## fonts, colours and licences

the panel bundles two small subsets of fonts so it looks the same on a Mac that has neither installed. both are renamed (`mish mono`, `mish icons`) so they never shadow a font you already have, and both stay under their own licences:

- **CMU Typewriter Text**, SIL Open Font License 1.1, by Andrey V. Panov, from Donald E. Knuth's Computer Modern.
- a handful of glyphs (OS logos, a clock, the prompt chevrons) from the **Nerd Fonts** symbols font, which gathers Font Awesome and Octicons.

the catppuccin, dracula, nord and gruvbox presets use those themes' published colours. the full credits and licence texts are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the [licenses](licenses) folder.

## if something is wrong

| you see | because |
| --- | --- |
| "nothing playing" | nothing is playing in a source you have switched on, or (Safari) the tab is not on a listed site |
| a hint about Apple Events | the Safari switch above is off |
| the card never updates, and macOS never asked | Obsidian was refused control of Music.app or Safari: System Settings, Privacy & Security, Automation |
| the volume bar follows the player, not the Mac | your output has no system volume control (HDMI, some display speakers) |
| shuffle is greyed out | shuffle exists in Music.app only |

## for the repo

there is no build step: `main.js` and `styles.css` are the source. before tagging a release, run

```
bash scripts/check.sh
```

it checks the manifest, the version map, the licences, that `main.js` contains no network code, no dynamic code and no process launching other than `execFile` on `osascript`, and that this readme discloses every remote host the code mentions. pushing a tag that matches the manifest version (like `1.0.0`, no `v`) runs the same checks on GitHub and prepares a draft release for you to read and publish.

## licence

MIT, see [LICENSE](LICENSE). the bundled fonts keep their own licences, as above.
