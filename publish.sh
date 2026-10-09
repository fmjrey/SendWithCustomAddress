#! /bin/bash
set -ueo pipefail

NAME="$(node -e 'console.log(require("./manifest.json").name)')"
VERSION="$(node -e 'console.log(require("./manifest.json").version)')"
FORCE=0
DRY_RUN=0
for arg in "$@"; do
    case $arg in
        --force)
            FORCE=1
            shift;;
        --dry-run)
            DRY_RUN=1
            shift;;
        *)
            echo "unknown flag: $arg"
            exit 1;;
    esac
done

# sanity checks (skipped with --force flag)
if [ $FORCE != 1 ]; then
    git fetch origin;
    if [ "$(git branch --show-current)" != "master" ]; then
        echo "publish can only run on master branch"
        exit 1
    fi
    if git rev-list "v$VERSION" &>/dev/null; then
        echo "tag $VERSION already exists"
        exit 1
    fi
    # Check working directory is clean with no uncommitted changes
    GIT_STATUS="$(git status --porcelain | grep -v 'M publish.sh' || true)"
    if [ "$GIT_STATUS" ]; then
        echo "git has uncommitted changes:"
        echo "$GIT_STATUS"
        exit 1
    fi
fi

# Files to include in the .xpi (glob relative to repo root)
FILES=(
  "*.js"
  "addon.css"
  "compose/*"
  "icons/*"
  "LICENSE"
  "manifest.json"
  "options/*"
)

# Expand globs
shopt -s nullglob # unmatched patterns vanish instead of staying literal
EXPANDED=()
for pattern in "${FILES[@]}"; do
  for f in $pattern; do   # expands globs
    EXPANDED+=("$f")
  done
done
shopt -u nullglob

# Copying files
echo "copying files..."
DIST="dist"
rm -rf "$DIST"
mkdir -p "$DIST"
for f in "${EXPANDED[@]}"; do
  mkdir -p "$DIST/$(dirname "$f")"
  cp "$f" "$DIST/$f"
done

# Build the .xpi
echo "creating xpi file..."
RELEASES="releases"
FILENAME="${RELEASES}/${NAME}_${VERSION}.xpi"
rm -f $FILENAME
cd "$DIST"
zip -r "../$FILENAME" .
cd ..
rm -rf "$DIST"

# publishing
if [ $DRY_RUN != 1 ]; then
    echo "publishing..."
    (set -x; gh release create "v$VERSION" -t "v$VERSION" "./$FILENAME.xpi" )
    git fetch origin
    echo "all done!"
else
    echo "all done! (dry-run)"
fi