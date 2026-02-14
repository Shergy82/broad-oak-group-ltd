#!/usr/bin/env bash
set -e

KEEP=5

echo "Keeping last $KEEP deploy tags, deleting older ones..."

TAGS=$(git tag --list "deploy-*" --sort=-creatordate)

COUNT=0
for TAG in $TAGS; do
  COUNT=$((COUNT+1))
  if [ $COUNT -le $KEEP ]; then
    echo "KEEP  $TAG"
  else
    echo "DELETE $TAG"
    git tag -d "$TAG"
    git push origin ":refs/tags/$TAG"
  fi
done

echo "Cleanup complete."
