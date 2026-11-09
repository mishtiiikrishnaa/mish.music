# third-party notices

mish.eza embeds two small fonts, as base64 woff2, at the top of `styles.css`. both are subsets (only the glyphs the panel draws) and both are renamed. nothing else is bundled: `main.js` contains no third-party code and uses nothing but obsidian's own api and node's `os` module. the only other thing borrowed from outside is a handful of colour values, credited below.

the plugin's own code is MIT (see `LICENSE`). the fonts are **not** relicensed by that: each stays under its own licence, listed below.

## cmu typewriter text → embedded as "mish mono"

- licence: SIL Open Font License, Version 1.1. full text, including the copyright block: `licenses/OFL-CMU-Typewriter.txt`
- copyright: (C) 2003-2009 Andrey V. Panov, with Reserved Font Family Name "Computer Modern Unicode fonts". based on the Computer Modern fonts by Donald E. Knuth and the other authors named in the copyright block of the licence file
- changes made: cut down to basic latin, latin-1 and a few punctuation and arrow characters (213 characters); layout features and hinting removed; converted to woff2; the family was renamed to "mish mono" so that the Reserved Font Name is not used. the copyright and licence records inside the font file were kept
- obtained from the `computer-modern` npm package, which repackages the CMU fonts
- the OFL means: the font may be bundled with software, but not sold by itself, and it stays under the OFL. the plugin's MIT licence applies to the plugin's code only

## symbols nerd font mono → embedded as "mish icons"

- source: Symbols Nerd Font Mono 3.5.1, from the Nerd Fonts project, https://github.com/ryanoasis/nerd-fonts
- licence: Nerd Fonts' licence file, which contains both its MIT and its SIL OFL 1.1 sections, is included unchanged as `licenses/NERD-FONTS-LICENSE.txt`. copyright (c) 2014 Ryan L McIntyre
- glyphs kept (six): `fa-apple` (U+F179), `fa-windows` (U+F17A), `fa-linux` (U+F17C), `oct-clock` (U+F43A), and the two heavy chevrons U+276E and U+276F
- where the icons come from: the three operating system logos are from **Font Awesome Free**, whose icons are licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the attribution required by that licence is this paragraph. the clock is from **Octicons** (MIT, GitHub). the licences of every icon set inside Nerd Fonts are listed in the Nerd Fonts repository's licence audit
- changes made: cut down to those six characters, renamed to "mish icons", converted to woff2
- the operating system logos remain trademarks of their respective owners and are used only to show which system you are on

## palette presets: catppuccin, dracula, nord, gruvbox

the palette menu in the settings has presets named after four well-known colour schemes. each preset is **six colour values** (hex codes) picked from that project's published palette, written into `main.js`. no code, files, logos or other assets from these projects are included, and the plugin is not affiliated with or endorsed by any of them. the names are only there so you know which palette a preset is based on.

| preset | from | six values used | licence | copyright |
| --- | --- | --- | --- | --- |
| catppuccin | [catppuccin](https://github.com/catppuccin/catppuccin), the mocha flavour | `#f5c2e7` pink, `#fab387` peach, `#f9e2af` yellow, `#a6e3a1` green, `#89b4fa` blue, `#cba6f7` mauve | MIT | Copyright (c) 2021-present Catppuccin Org |
| dracula | [dracula](https://github.com/dracula/dracula-theme), created by Zeno Rocha | `#ff79c6` pink, `#ffb86c` orange, `#f1fa8c` yellow, `#50fa7b` green, `#8be9fd` cyan, `#bd93f9` purple | MIT | "MIT License (c) Dracula Theme", as the project states it |
| nord | [nord](https://github.com/nordtheme/nord), by Sven Greb (begun as Arctic Ice Studio) | `#bf616a` (nord11), `#d08770` (nord12), `#ebcb8b` (nord13), `#a3be8c` (nord14), `#81a1c1` (nord9), `#b48ead` (nord15) | MIT | Copyright (c) 2016-present Sven Greb |
| gruvbox | [gruvbox](https://github.com/morhetz/gruvbox), by Pavel Pertsev (morhetz) | the bright colours: `#fb4934` red, `#fe8019` orange, `#fabd2f` yellow, `#b8bb26` green, `#83a598` blue, `#d3869b` purple | "MIT/X11", as its readme states it | none named upstream |

about gruvbox: its readme says "MIT/X11", but the repository ships no licence file and names no copyright holder, so there is no licence text to reproduce here. credit goes to Pavel Pertsev, who made it.

the MIT licence for the first three reads, in full:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

the other presets (mish, ocean, sunset, forest, greyscale) are original to this plugin. the six custom colours you pick yourself belong to you.

## obsidian and its icons

the plugin runs on obsidian's own api, which is not bundled. a few small icons in the plugin come from the Lucide set that obsidian itself ships and draws (``git-branch`, `rotate-ccw``). they are not copied into this plugin. Lucide is licensed ISC (https://lucide.dev/license).

## adding or changing something later

if you embed another font, add a section here, put its licence text in `licenses/`, and rename the family if its licence reserves the name. if you add another preset or copy colours from another project, add its licence and copyright line to the palette section above.
