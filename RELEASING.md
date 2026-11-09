# releasing mish.eza

this file is for you, the maintainer. it is not shown to plugin users.

obsidian plugins are not npm packages. the "package" is **three files attached to a github release**: `main.js`, `manifest.json` and `styles.css`. nothing else is uploaded to anywhere.

## before every release

1. **bump the version** in `manifest.json`, and add the same version to `versions.json` (`"1.0.1": "1.5.0"`, the minimum obsidian version it needs).
2. run `bash scripts/check.sh`. it must end with "all good."
3. do the manual tests below, in a **scratch vault** (never your real ones).
4. commit, push, and tag.

## the tests

### from a clean install (the one that matters most)

- [ ] make a brand-new empty vault. copy only `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/mish-eza/`. enable the plugin. it works with nothing else around.
- [ ] open developer tools (cmd + option + i): the console shows **no errors** while you use the plugin.
- [ ] the network tab stays **empty** while you use the plugin (this is the "no network" claim in the readme).
- [ ] disable then enable the plugin; then reload obsidian: no duplicated panels, nothing stuck.
- [ ] delete `data.json` from the plugin folder and reload: it starts with defaults.
- [ ] turn the plugin **off**, then uninstall it: the native file explorer is back and nothing is left hidden.

### the vault shapes

- [ ] an empty vault.
- [ ] a vault with about 5,000 notes (make them with a loop in the terminal): opening, folding, and typing stay smooth.
- [ ] folders and files with spaces, emoji, accents, tamil or hindi script, a leading dot, and very long names.
- [ ] deeply nested folders (10 levels).
- [ ] a vault path with spaces and unicode in it.

### looks

- [ ] obsidian's default theme, light and dark.
- [ ] one popular community theme, light and dark.
- [ ] your own pink theme/snippet on top.
- [ ] a machine or user account **without** cmu fonts installed: the panel still looks right (the font is embedded).
- [ ] font menu: bundled, obsidian monospace, system monospace, a custom css list, and **scan** (try pressing "deny" on the permission prompt: nothing breaks).
- [ ] resize the sidebar very narrow and very wide.

### mish-eza specific

- [ ] **every command**, once each: `touch`, `mkdir`, `rename` (open note, and with a folder path), `mv`, `cp` (with and without names), `rm`, `rm -r`, `delete`, `sort` (each order), `reveal`, `collapse`, `expand`, `help`.
- [ ] **trying to escape the vault**: `touch ../escape`, `mkdir ../../escape`, `mv "a" "../b"`, `rm ../anything`. nothing outside the vault may be created, moved or deleted.
- [ ] **collisions**: `touch` / `mkdir` / `cp` / `mv` onto a name that already exists. nothing is overwritten and the message is clear.
- [ ] names with spaces need quotes: test with and without quotes; test an unbalanced quote.
- [ ] `rm` really goes to the **system trash** (check the macOS trash) and `rm -r` on a folder with contents works.
- [ ] **the y/n question**: `rm <file>` shows the yellow `[y/N]` line and the placeholder changes to `y / n`. `y` and `yes` delete, `n` cancels, a bare enter cancels, esc cancels, clicking the output line cancels, typing another command cancels. a folder says how many items are inside. `rm -f` skips the question. turn **ask before deleting** off in settings: no question. nothing is trashed until you answer `y`.
- [ ] `mv` and `rename` update `[[links]]` in other notes.
- [ ] rename the note that is currently open: the panel highlight follows it.
- [ ] `cp` with no names and no open note: a polite message, no crash.
- [ ] tab completion with spaces, with unicode, with nothing to complete. up/down history after a reload.
- [ ] click to fold/unfold, cmd-click to open in a new tab, right-click menu.
- [ ] the git pill: a vault that **is** a git repo, one that is **not**, one with a detached head, and a `.git` that is a file (worktrees).
- [ ] files appearing or vanishing from outside obsidian (make one in terminal): the tree updates.
- [ ] **toggle native file explorer** and **redraw the prompt** from the command palette.
- [ ] other plugins that also touch the file explorer, enabled together.


### the repository

- [ ] fresh clone into a temp folder (`git clone ... /tmp/x`), run `bash scripts/check.sh` there.
- [ ] the readme renders on github: every link works, no broken images.
- [ ] `LICENSE`, `THIRD-PARTY-NOTICES.md` and `licenses/` are all present, and github's sidebar says **MIT** (not "view license"). the `LICENSE` file must stay the plain, unedited mit text or github cannot identify it; anything extra goes in `THIRD-PARTY-NOTICES.md`.
- [ ] screenshots live in `docs/screenshots/`, each under about 300 KB, and show no real name, vault path or private note titles. (they are portrait, about 600 px wide, so the readme shows them at 260 to 300 px.)
- [ ] the minimum version: either install obsidian 1.5.x and test on it, or raise `minAppVersion` to the oldest version you actually tested. a promise you haven't tested is a fib.

## cutting the release

```sh
git add -A && git commit -m "release 1.0.0"
git push
git tag 1.0.0          # exactly the manifest version, no "v"
git push origin 1.0.0
```

the workflow in `.github/workflows/release.yml` runs `scripts/check.sh` and makes a **draft** release with the three files. open it on github, read the notes, and press **publish release**.

## after publishing

- [ ] in another scratch vault install with **brat** (`mishtiiikrishnaa/mish.eza`) and check it works from the real release.
- [ ] download the three assets from the release page and diff them against your repo files: they must be identical.
- [ ] optional, later: submit to the community plugin list (see below).

## community plugins (optional, slow)

1. fork https://github.com/obsidianmd/obsidian-releases.
2. add this to the end of `community-plugins.json` (put a comma after the entry above it), and open a pull request titled `Add plugin: mish.eza`:

```json
{
  "id": "mish-eza",
  "name": "mish.eza",
  "author": "mishti",
  "description": "Replace the file explorer with an eza-style tree, a starship-style prompt and a small command line for making, renaming, copying and deleting notes.",
  "repo": "mishtiiikrishnaa/mish.eza"
}
```

3. the `id`, `name`, `author` and `description` must match `manifest.json` exactly.
4. a bot checks the entry, then a human reviews the code. the queue is long. read obsidian's plugin guidelines first: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
