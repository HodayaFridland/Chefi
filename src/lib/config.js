'use strict';

/**
 * config.js
 * ---------
 * Loads the rules config from S3 (not from code). The active version lives in
 * the RULES_KEY env var, so switching to rules v2 is a config change.
 *
 * Lambda keeps a container warm between invocations, so we cache the parsed
 * rules in module scope and fetch from S3 only on a cold start.
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({});
let cachedRules = null;

async function loadRules() {
  if (cachedRules) return cachedRules;

  const out = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.RULES_BUCKET,
      Key: process.env.RULES_KEY,
    })
  );
  const body = await out.Body.transformToString();
  cachedRules = JSON.parse(body);
  return cachedRules;
}

module.exports = { loadRules };
