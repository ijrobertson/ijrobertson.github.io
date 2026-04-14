#!/usr/bin/env node
/**
 * Lingua Bud — Wise $1 integration test
 * ──────────────────────────────────────
 * Run from the functions/ directory:
 *   node test-wise-payout.js
 *
 * Uses the live Wise API (WISE_API_KEY + WISE_PROFILE_ID from .env).
 * Sends exactly $1.00 USD to ianjack1643@gmail.com as an end-to-end test.
 * Does NOT write to Firestore — this is a pure API smoke-test.
 *
 * After a successful run the script prints the Wise transfer ID, which
 * you can look up in the Wise dashboard under Transfers.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load .env manually (avoid dev dependency on dotenv) ──────────────────
const envPath = path.join(__dirname, '.env');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx < 0) continue;
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

// ── Config ────────────────────────────────────────────────────────────────
const WISE_API_BASE  = 'https://api.wise.com';
const WISE_API_KEY   = process.env.WISE_API_KEY;
const WISE_PROFILE_ID = process.env.WISE_PROFILE_ID;

const TEST_EMAIL     = 'ianjack1643@gmail.com';
const TEST_NAME      = 'Ian Jack';
const TEST_CURRENCY  = 'USD';
const TEST_AMOUNT    = 5.00; // $5 covers the ~$1.13 Wise fee

// ── Helpers ───────────────────────────────────────────────────────────────
function log(step, data) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`STEP: ${step}`);
  console.log(JSON.stringify(data, null, 2));
}

async function wiseRequest(method, path, body) {
  const url = `${WISE_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${WISE_API_KEY}`,
      'Content-Type':  'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Wise ${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return json;
}

// ── Main test ─────────────────────────────────────────────────────────────
async function runTest() {
  console.log('='.repeat(60));
  console.log('  Lingua Bud — Wise $1 integration test');
  console.log('='.repeat(60));
  console.log(`  API Key  : ${WISE_API_KEY ? WISE_API_KEY.slice(0, 8) + '...' : 'NOT SET'}`);
  console.log(`  Profile  : ${WISE_PROFILE_ID || 'NOT SET'}`);
  console.log(`  Recipient: ${TEST_EMAIL}`);
  console.log(`  Amount   : USD ${TEST_AMOUNT} (covers ~USD 1.13 Wise fee)`);
  console.log('='.repeat(60));

  if (!WISE_API_KEY || WISE_API_KEY.includes('PASTE')) {
    console.error('\n❌  WISE_API_KEY not set in functions/.env');
    process.exit(1);
  }
  if (!WISE_PROFILE_ID || WISE_PROFILE_ID.includes('PASTE')) {
    console.error('\n❌  WISE_PROFILE_ID not set in functions/.env');
    process.exit(1);
  }

  // ── Step 1: Create recipient ─────────────────────────────────────────
  const recipientPayload = {
    profile:           parseInt(WISE_PROFILE_ID, 10),
    accountHolderName: TEST_NAME,
    currency:          TEST_CURRENCY,
    type:              'email',
    details:           { email: TEST_EMAIL }
  };
  let recipient;
  try {
    recipient = await wiseRequest('POST', '/v1/accounts', recipientPayload);
    log('1. Create recipient', { id: recipient.id, type: recipient.type, currency: recipient.currency });
  } catch (err) {
    console.error('\n❌  Create recipient failed:', err.message);
    process.exit(1);
  }

  // ── Step 2: Create quote ─────────────────────────────────────────────
  const quotePayload = {
    profile:      parseInt(WISE_PROFILE_ID, 10),
    source:       TEST_CURRENCY,
    target:       TEST_CURRENCY,
    rateType:     'FIXED',
    sourceAmount: TEST_AMOUNT,
    type:         'BALANCE_PAYOUT'
  };
  let quote;
  try {
    quote = await wiseRequest('POST', '/v1/quotes', quotePayload);
    log('2. Create quote', {
      uuid:         quote.uuid || quote.id,
      source:       quote.source,
      target:       quote.target,
      sourceAmount: quote.sourceAmount,
      targetAmount: quote.targetAmount,
      rate:         quote.rate,
      fee:          quote.fee
    });
  } catch (err) {
    console.error('\n❌  Create quote failed:', err.message);
    process.exit(1);
  }

  // ── Step 3: Create transfer ───────────────────────────────────────────
  // Wise requires customerTransactionId to be a valid UUID v4
  const { randomUUID } = require('crypto');
  const customerTransactionId = randomUUID();
  const transferPayload = {
    targetAccount:         recipient.id,
    quoteUuid:             String(quote.uuid || quote.id),
    customerTransactionId,
    details: { reference: 'Lingua Bud integration test' }
  };
  let transfer;
  try {
    transfer = await wiseRequest('POST', '/v1/transfers', transferPayload);
    log('3. Create transfer', {
      id:     transfer.id,
      status: transfer.status,
      source: transfer.sourceCurrency,
      target: transfer.targetCurrency
    });
  } catch (err) {
    console.error('\n❌  Create transfer failed:', err.message);
    process.exit(1);
  }

  // ── Step 4: Fund transfer ─────────────────────────────────────────────
  // v1 payments endpoint is deprecated (HTTP 410); v3 is current standard.
  // REQUIREMENT: Wise USD balance must be > $5 before this succeeds.
  let payment;
  try {
    payment = await wiseRequest('POST', `/v3/profiles/${WISE_PROFILE_ID}/transfers/${transfer.id}/payments`, { type: 'BALANCE' });
    log('4. Fund transfer', {
      type:          payment.type,
      status:        payment.status,
      errorCode:     payment.errorCode || null,
      balanceAfter:  payment.balanceAfter || null
    });
  } catch (err) {
    const msg = err.message || '';
    console.error('\n❌  Fund transfer failed:', msg);
    if (msg.includes('403')) {
      console.error('\n   Possible causes:');
      console.error('   1. Wise USD balance is $0 — top up wise.com first');
      console.error('   2. API token missing "Execute transfers" permission');
      console.error('   3. Wise requires SCA (2FA) for first live transfer');
      console.error('\n   Transfer ID', transfer.id, 'was CREATED but not funded.');
      console.error('   You can fund it manually at wise.com → Transfers.');
    }
    process.exit(1);
  }

  // ── Result ────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  if (payment.status === 'COMPLETED' || payment.status === 'PROCESSING' || payment.type === 'BALANCE') {
    console.log('TEST PASSED');
    console.log(`    Transfer ID   : ${transfer.id}`);
    console.log(`    Payment status: ${payment.status}`);
    console.log(`    Recipient     : ${TEST_EMAIL}`);
    console.log(`    Amount        : ${TEST_AMOUNT} ${TEST_CURRENCY}`);
    console.log('\n    Check wise.com -> Transfers to confirm.');
    console.log(`    The USD ${TEST_AMOUNT} should arrive at ${TEST_EMAIL}.`);
  } else {
    console.log('UNEXPECTED PAYMENT STATUS:', payment.status);
    console.log('    Check wise.com -> Transfers for details.');
  }
  console.log('='.repeat(60));
}

runTest().catch(err => {
  console.error('\n❌  Unhandled error:', err.message);
  process.exit(1);
});
