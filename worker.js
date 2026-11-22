export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/parse-order") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (!env.GEMINI_API_KEY) {
        return new Response(JSON.stringify({ error: "Missing GEMINI_API_KEY secret" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      try {
        const body = await request.json();
        const message = String(body.message || "").trim();
        if (!message) {
          return new Response(JSON.stringify({ error: "Empty message" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const today = new Date().toISOString().slice(0, 10);
        const prompt = [
          `Today's date is ${today}. Extract order fields from this client message and return ONLY valid JSON with these exact keys:`,
          `{"title": string, "service": string, "price": number | "", "currency": string, "deadline": string, "notes": string}`,
          `Rules:`,
          `- title: short order title (max 75 chars).`,
          `- service: pick the closest match from ["Book Cover Design", "Thumbnail Design", "Logo Design", "Video Editing", "Web Design", "Graphic Design"] or a short service name, or "" if unclear.`,
          `- price: numeric amount only (e.g. 120), or "" if not mentioned.`,
          `- currency: 3-letter code like "USD", "BDT", "EUR", "GBP", "INR", "CAD", "AUD" (default "USD").`,
          `- deadline: YYYY-MM-DD format if a date/deadline is mentioned, or "" if not.`,
          `- notes: concise summary or original message details (max 950 chars).`,
          `Client message:\n${message}`
        ].join("\n");

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json"
              }
            })
          }
        );

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          return new Response(JSON.stringify({ error: "Gemini API error", details: errText }), {
            status: 502,
            headers: { "Content-Type": "application/json" }
          });
        }

        const geminiData = await geminiRes.json();
        const rawJson = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const parsed = JSON.parse(rawJson);

        return new Response(
          JSON.stringify({
            title: String(parsed.title || "New Client Order").slice(0, 75),
            service: String(parsed.service || ""),
            price: typeof parsed.price === "number" ? parsed.price : (parsed.price ? Number(parsed.price) : ""),
            currency: String(parsed.currency || "USD").toUpperCase(),
            deadline: String(parsed.deadline || ""),
            notes: String(parsed.notes || message).slice(0, 950)
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      } catch (err) {
        return new Response(JSON.stringify({ error: "Failed to parse order" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};