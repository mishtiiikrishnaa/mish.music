#!/usr/bin/env bash
# run from the repository root:  bash scripts/check.sh
# checks the things that are cheap to check by machine, before a release.
set -u
ID="mish-eza"
GREP_RE='child_process|fetch\(|XMLHttpRequest|WebSocket|eval\(|new Function|innerHTML'
fail=0
ok()  { echo "  ok    $1"; }
bad() { echo "  FAIL  $1"; fail=1; }
warn(){ echo "  warn  $1"; }

echo "files"
for f in main.js manifest.json styles.css versions.json LICENSE THIRD-PARTY-NOTICES.md README.md \
         licenses/OFL-CMU-Typewriter.txt licenses/NERD-FONTS-LICENSE.txt; do
  [ -s "$f" ] && ok "$f" || bad "$f is missing or empty"
done

echo "manifest"
ID="$ID" python3 - <<'PY' || fail=1
import json, os, re, sys
bad = 0
def ok(m): print("  ok    " + m)
def no(m):
    global bad
    bad = 1
    print("  FAIL  " + m)
try:
    man = json.load(open("manifest.json", encoding="utf-8"))
    ver = json.load(open("versions.json", encoding="utf-8"))
    ok("manifest.json and versions.json are valid json")
except Exception as e:
    print("  FAIL  invalid json: %s" % e)
    sys.exit(1)
for k in ("id", "name", "version", "minAppVersion", "description", "author", "isDesktopOnly"):
    if k not in man:
        no("manifest.json has no '%s'" % k)
v, m, i = man.get("version", ""), man.get("minAppVersion", ""), man.get("id", "")
want = os.environ["ID"]
if i == want: ok("id is " + want)
else: no("id is %r, expected %r" % (i, want))
if re.fullmatch(r"\d+\.\d+\.\d+", v): ok("version %s looks like x.y.z" % v)
else: no("version %r is not x.y.z" % v)
if ver.get(v) == m: ok("versions.json maps %s -> %s" % (v, m))
else: no("versions.json has no entry %r: %r" % (v, m))
if man.get("isDesktopOnly") is True: ok("isDesktopOnly is true (the plugin uses node's os module)")
else: no("isDesktopOnly must be true")
d = man.get("description", "")
if d.endswith("."): ok("description ends with a full stop")
else: no("description should end with a full stop")
if len(d) <= 250: ok("description is %d characters (max 250)" % len(d))
else: no("description is longer than 250 characters")
if "obsidian" in (man.get("name", "") + i).lower(): no("id and name must not contain 'obsidian'")
else: ok("id and name do not contain 'obsidian'")
if os.environ.get("GITHUB_REF_TYPE") == "tag":
    t = os.environ.get("GITHUB_REF_NAME", "")
    if t == v: ok("tag %s matches manifest version" % t)
    else: no("tag %s does not match manifest version %s" % (t, v))
sys.exit(bad)
PY

echo "code"
if command -v node >/dev/null; then
  node --check main.js 2>/dev/null && ok "main.js parses" || bad "main.js has a syntax error"
else warn "node not installed: syntax check skipped"; fi
if grep -nE "$GREP_RE" main.js >/dev/null; then bad "the readme says this grep finds nothing, but it does:"; grep -nE "$GREP_RE" main.js | head; else ok "readme claim holds: grep finds nothing"; fi
python3 - <<'PY' && ok "styles.css braces balance" || bad "styles.css braces do not balance"
import re,sys
t=re.sub(r'base64,[A-Za-z0-9+/=]+','',open('styles.css',encoding='utf-8').read())
t=re.sub(r'/\*.*?\*/','',t,flags=re.S)
sys.exit(0 if t.count('{')==t.count('}') else 1)
PY
if grep -qE 'Mish (Typewriter|Symbols)' styles.css main.js; then bad "old font names are still around"; else ok "no leftover old font names"; fi
[ "$(grep -c '@font-face' styles.css)" = "2" ] && ok "two @font-face blocks" || bad "expected exactly two @font-face blocks"
for img in $(grep -oE 'docs/screenshots/[A-Za-z0-9._-]+' README.md | sort -u); do
  if [ -f "$img" ]; then ok "readme image exists: $img"; else bad "README shows $img but that file does not exist"; fi
done
[ -f LICENSE ] && head -1 LICENSE | grep -q '^MIT License$' && ok "LICENSE starts with the standard MIT title (github can identify it)" || bad "LICENSE should be the plain MIT text, untouched"

echo "git hygiene"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  media=$(git ls-files | grep -Ei '\.(png|jpe?g|gif|webp|mp4|mov|heic)$' | grep -v '^docs/screenshots/' || true)
  [ -z "$media" ] && ok "no stray images or videos are tracked (docs/screenshots/ is the only allowed home)" || { bad "tracked media outside docs/screenshots/:"; echo "$media"; }
  big=$(git ls-files docs/screenshots 2>/dev/null | while read -r f; do [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 400000 ] && echo "$f"; done)
  [ -z "$big" ] && ok "tracked screenshots are all under 400 KB" || { bad "screenshots over 400 KB, shrink them:"; echo "$big"; }
  junk=$(git ls-files | grep -E '(^|/)(data\.json|\.DS_Store)$' || true)
  [ -z "$junk" ] && ok "data.json and .DS_Store are not tracked" || { bad "tracked junk found:"; echo "$junk"; }
  [ -z "$(git status --porcelain)" ] && ok "working tree is clean" || warn "uncommitted changes"
else warn "not a git repository: git checks skipped"; fi

echo "size"
echo "  main.js $(wc -c < main.js | tr -d ' ') bytes, styles.css $(wc -c < styles.css | tr -d ' ') bytes"

echo
[ $fail -eq 0 ] && echo "all good." || { echo "something failed. fix it before tagging."; exit 1; }
