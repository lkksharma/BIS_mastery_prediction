#!/usr/bin/env bash
#
# Build and publish the quiz to S3 + CloudFront.
#
#   BUCKET=my-bucket DIST_ID=E1234567890ABC ./scripts/deploy_aws.sh
#
# Assumes the bucket and distribution already exist -- DEPLOY_AWS.md walks
# through creating them once.  Safe to re-run; it is the normal update path.

set -euo pipefail

BUCKET="${BUCKET:-}"
DIST_ID="${DIST_ID:-}"
PROFILE_ARG=""
[ -n "${AWS_PROFILE:-}" ] && PROFILE_ARG="--profile ${AWS_PROFILE}"

if [ -z "$BUCKET" ]; then
  echo "BUCKET is not set. Example:" >&2
  echo "  BUCKET=bis-quiz-web DIST_ID=E123ABC ./scripts/deploy_aws.sh" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The Firebase config is baked in at build time, so it has to be present now.
if [ ! -f .env.production ] && [ -z "${VITE_FB_PROJECT_ID:-}" ]; then
  echo "warning: no .env.production and no VITE_FB_* in the environment." >&2
  echo "         The build will ship without Firestore and nothing will be saved." >&2
  read -r -p "         Continue anyway? [y/N] " reply
  [ "$reply" = "y" ] || exit 1
fi

echo "==> building"
npm run build

echo "==> uploading hashed assets (immutable, 1 year)"
# Assets carry a content hash in the filename, so they can cache forever.
aws s3 sync dist/ "s3://${BUCKET}/" $PROFILE_ARG \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

echo "==> uploading index.html (never cached)"
# index.html must NOT be cached, or browsers keep loading the old asset names
# after a deploy and the site appears frozen at the previous version.
aws s3 cp dist/index.html "s3://${BUCKET}/index.html" $PROFILE_ARG \
  --cache-control "no-cache,no-store,must-revalidate" \
  --content-type "text/html; charset=utf-8"

if [ -n "$DIST_ID" ]; then
  echo "==> invalidating CloudFront"
  ID=$(aws cloudfront create-invalidation $PROFILE_ARG \
        --distribution-id "$DIST_ID" \
        --paths "/*" \
        --query 'Invalidation.Id' --output text)
  echo "    invalidation $ID created"
  echo "==> waiting for it to complete"
  aws cloudfront wait invalidation-completed $PROFILE_ARG \
    --distribution-id "$DIST_ID" --id "$ID"
  DOMAIN=$(aws cloudfront get-distribution $PROFILE_ARG \
            --id "$DIST_ID" --query 'Distribution.DomainName' --output text)
  echo
  echo "live at https://${DOMAIN}"
else
  echo "DIST_ID not set — skipped CloudFront invalidation."
  echo "Viewers may keep seeing the previous build until their cache expires."
fi
