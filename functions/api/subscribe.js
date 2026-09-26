function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return "+1" + digits;
  if (/^1\d{10}$/.test(digits)) return "+" + digits;
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), { status: 400 });
  }

  if (!body.consent) {
    return new Response(JSON.stringify({ ok: false, error: "Consent checkbox is required." }), { status: 400 });
  }

  const phone = normalizePhone(body.phone);
  if (!phone) {
    return new Response(JSON.stringify({ ok: false, error: "Enter a valid phone number." }), { status: 400 });
  }

  const key = `subscriber:${phone}`;
  const existing = await env.SUBSCRIBERS.get(key, "json");
  if (existing && existing.confirmed) {
    return new Response(JSON.stringify({ ok: true, alreadyConfirmed: true }), { status: 200 });
  }

  const telnyxRes = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.TELNYX_FROM_NUMBER,
      to: phone,
      text: "Garrett Orick: You requested SMS alerts, reminders, and status updates. Reply YES to confirm, STOP to opt out. Msg&data rates may apply.",
    }),
  });

  if (!telnyxRes.ok) {
    const errText = await telnyxRes.text();
    return new Response(JSON.stringify({ ok: false, error: "Could not send confirmation text.", detail: errText }), { status: 502 });
  }

  await env.SUBSCRIBERS.put(key, JSON.stringify({
    phone,
    consentedAt: Date.now(),
    ip: request.headers.get("cf-connecting-ip") || null,
    confirmed: false,
  }), {
    expirationTtl: 60 * 60 * 24 * 7,
  });

  return new Response(JSON.stringify({ ok: true, pending: true }), { status: 200 });
}
