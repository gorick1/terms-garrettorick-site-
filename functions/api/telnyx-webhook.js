export async function onRequestPost(context) {
  const { request, env } = context;

  const key = new URL(request.url).searchParams.get("key");
  if (!key || key !== env.WEBHOOK_KEY) {
    return new Response("Not found", { status: 404 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("ok", { status: 200 });
  }

  const data = payload.data;
  if (!data) {
    return new Response("ok", { status: 200 });
  }

  // Debug: log every inbound webhook event (send status, delivery receipts, etc.)
  await env.SUBSCRIBERS.put(`debug:event:${Date.now()}`, JSON.stringify(data), {
    expirationTtl: 60 * 60 * 24,
  });

  if (data.event_type !== "message.received") {
    return new Response("ok", { status: 200 });
  }

  const from = data.payload?.from?.phone_number;
  const text = (data.payload?.text || "").trim().toUpperCase();
  if (!from || !text) {
    return new Response("ok", { status: 200 });
  }

  const kvKey = `subscriber:${from}`;
  const existing = await env.SUBSCRIBERS.get(kvKey, "json");

  if (text === "YES" || text === "Y" || text === "START" || text === "SUBSCRIBE") {
    await env.SUBSCRIBERS.put(kvKey, JSON.stringify({
      phone: from,
      consentedAt: existing?.consentedAt ?? Date.now(),
      ip: existing?.ip ?? null,
      confirmed: true,
      confirmedAt: Date.now(),
    }));

    await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.TELNYX_FROM_NUMBER,
        to: from,
        text: "Garrett Orick: You're subscribed! Reply STOP anytime to opt out, HELP for help.",
      }),
    });
  } else if (text === "STOP" || text === "STOPALL" || text === "UNSUBSCRIBE" || text === "CANCEL") {
    await env.SUBSCRIBERS.put(kvKey, JSON.stringify({
      phone: from,
      consentedAt: existing?.consentedAt ?? Date.now(),
      ip: existing?.ip ?? null,
      confirmed: false,
      optedOutAt: Date.now(),
    }));
  } else if (text === "HELP") {
    await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.TELNYX_FROM_NUMBER,
        to: from,
        text: "This number sends personal SMS notifications. For support, contact contact@garrettorick.com. Reply STOP to unsubscribe.",
      }),
    });
  }

  return new Response("ok", { status: 200 });
}
