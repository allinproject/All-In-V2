/**
 * ALL-252. Stripe webhook envelope authentication for a trusted service worker.
 * Never set STRIPE_WEBHOOK_SECRET in client/EXPO_PUBLIC_* configuration.
 *
 * This verifies only the webhook's authenticity and replay-time window. It
 * does not verify payment, trial eligibility, current subscription state,
 * immutable purchase owner, or grant access. Retrieve the current Stripe
 * subscription through a trusted secret-key API adapter after verification.
 */
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const hexBytes = hex => {
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/.{2}/g), part => Number.parseInt(part, 16));
};

export async function authenticateStripeWebhookEnvelope({
  rawBody,
  signatureHeader,
  webhookSecret,
  nowSeconds,
  toleranceSeconds = 300,
  expectedLiveMode = false,
} = {}) {
  if (!(rawBody instanceof Uint8Array) || rawBody.length === 0 ||
      rawBody.length > 1024 * 1024 ||
      typeof signatureHeader !== 'string' || signatureHeader.length > 4096 ||
      typeof webhookSecret !== 'string' || webhookSecret.length < 16 ||
      !Number.isSafeInteger(nowSeconds) || nowSeconds < 0 ||
      !Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 0 ||
      typeof expectedLiveMode !== 'boolean') {
    return { status: 'invalid_request' };
  }

  const parts = signatureHeader.split(',').map(s => s.trim());
  const timestamps = parts.filter(s => s.startsWith('t=')).map(s => s.slice(2));
  const signatures = parts.filter(s => s.startsWith('v1=')).map(s => hexBytes(s.slice(3))).filter(Boolean);
  if (timestamps.length !== 1 || signatures.length === 0 ||
      !/^\d{1,15}$/.test(timestamps[0])) return { status: 'signature_rejected' };

  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { status: 'signature_rejected' };
  }
  // Stripe signs UTF-8 timestamp + "." + exact original body bytes.
  const prefix = textEncoder.encode(`${timestamp}.`);
  const signedBytes = new Uint8Array(prefix.length + rawBody.length);
  signedBytes.set(prefix);
  signedBytes.set(rawBody, prefix.length);

  let authenticated = false;
  try {
    const key = await crypto.subtle.importKey('raw', textEncoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    for (const signature of signatures) {
      if (await crypto.subtle.verify('HMAC', key, signature, signedBytes)) {
        authenticated = true;
        break;
      }
    }
  } catch {
    return { status: 'signature_rejected' };
  }
  if (!authenticated) return { status: 'signature_rejected' };

  let payload;
  try {
    payload = JSON.parse(textDecoder.decode(rawBody));
  } catch {
    return { status: 'payload_rejected' };
  }
  if (!payload || typeof payload !== 'object' ||
      payload.livemode !== expectedLiveMode ||
      typeof payload.id !== 'string' || !/^evt_[a-zA-Z0-9_]+$/.test(payload.id) ||
      typeof payload.type !== 'string' ||
      !payload.data || typeof payload.data !== 'object') {
    return { status: 'payload_rejected' };
  }

  return {
    status: 'authenticated_envelope',
    eventId: payload.id,
    eventType: payload.type,
    liveMode: payload.livemode,
    // No event.data used as entitlement truth. Provider subscription state
    // must be retrieved separately after verifying object identity and owner.
  };
}
