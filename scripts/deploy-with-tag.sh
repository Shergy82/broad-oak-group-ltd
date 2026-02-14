#!/usr/bin/env bash
set -e

TAG="deploy-$(date +%Y-%m-%d-%H%M)"
echo "Creating recovery tag: $TAG"

git tag -a "$TAG" -m "Auto recovery tag before deploy"
git push origin "$TAG"

firebase deploy
