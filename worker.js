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
        const message = String(body?.message || "").trim();
        if (!message) {
          return new Response(JSON.stringify({ error: "Empty message" }), {
            status: 400,
            headers: { "Content-Type": "application/json" }
          });
        }

        const today = new Date().toISOString().slice(0, 10);
        const prompt = [
          `Today's date is ${today}. Extract order fields from this client message.`,
          `Rules:`,
          `- title: short order title (max 75 chars).`,
          `- service: closest match from ["Book Cover Design", "Thumbnail Design", "Logo Design", "Video Editing", "Web Design", "Graphic Design"] or a short service name, or "" if unclear.`,
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
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    service: { type: "STRING" },
                    price: { type: "STRING" },
                    currency: { type: "STRING" },
                    deadline: { type: "STRING" },
                    notes: { type: "STRING" }
                  },
                  required: ["title", "service", "price", "currency", "deadline", "notes"]
                }
              }
            })
          }
        );

        const geminiRawText = await geminiRes.text();
        if (!geminiRes.ok) {
          return new Response(
            JSON.stringify({
              error: `Gemini API returned ${geminiRes.status}`,
              details: geminiRawText.slice(0, 600)
            }),
            {
              status: geminiRes.status >= 400 && geminiRes.status < 600 ? geminiRes.status : 502,
              headers: { "Content-Type": "application/json" }
            }
          );
        }

        const geminiData = JSON.parse(geminiRawText);
        let rawJson = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        rawJson = rawJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

        const parsed = JSON.parse(rawJson);
        const numericPrice = parsed.price === "" || parsed.price === null || parsed.price === undefined
          ? ""
          : Number(String(parsed.price).replace(/[^0-9.]/g, ""));

        return new Response(
          JSON.stringify({
            title: String(parsed.title || "New Client Order").trim().slice(0, 75),
            service: String(parsed.service || "").trim(),
            price: Number.isFinite(numericPrice) ? numericPrice : "",
            currency: String(parsed.currency || "USD").trim().toUpperCase().slice(0, 3) || "USD",
            deadline: String(parsed.deadline || "").trim(),
            notes: String(parsed.notes || message).trim().slice(0, 950)
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: "Failed to parse order", details: String(err?.message || err) }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
