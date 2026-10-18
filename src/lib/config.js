'use strict';

// Loads the rules config from S3 (not from code); active version is the RULES_KEY env
// var. Cached in module scope so we only fetch on a cold start.

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});
let cachedRules = null;

async function loadRules() {
  if (cachedRules) return cachedRules;
  const out = await s3.send(
    new GetObjectCommand({ Bucket: process.env.RULES_BUCKET, Key: process.env.RULES_KEY })
  );
  cachedRules = JSON.parse(await out.Body.transformToString());
  return cachedRules;
}

module.exports = { loadRules };
