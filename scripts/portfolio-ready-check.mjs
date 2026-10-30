#!/usr/bin/env node
// Fail-closed portfolio ready probe for owned planes only.
// Never treats stranger_occupant or cold-start as ready without recovery.
// Exit 0 only if both Conduit and Resonance Netlify report ready.

import { setTimeout as sleep } from 'node:timers/promises';

const TARGETS = [
  { name: 'conduit', url: 'https://conduit-feco.onrender.com/ready', expect: (j) => j.status === 'ready' && j.production === true },
  { name: 'resonance', url: 'https://resonancenexus.netlify.app/api/ready', expect: (j) => j.status === 'ready' && j.posture === 'contract_passed' && Array.isArray(j.missingRequired) && j.missingRequired.length === 0 },
];

async function probe(target, attempt = 1) {
  const maxAttempts = 3;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(target.url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (target.expect(json)) {
      console.log(`${target.name}: READY (attempt ${attempt})`);
      return true;
    }
    throw new Error('posture not met');
  } catch (err) {
    console.log(`${target.name}: attempt ${attempt} failed (${err.message})`);
    if (attempt < maxAttempts) {
      await sleep(2000 * attempt);
      return probe(target, attempt + 1);
    }
    return false;
  }
}

async function main() {
  const results = await Promise.all(TARGETS.map(t => probe(t)));
  if (results.every(Boolean)) {
    console.log('PORTFOLIO READY');
    process.exit(0);
  } else {
    console.error('PORTFOLIO NOT READY');
    process.exit(1);
  }
}

main();
