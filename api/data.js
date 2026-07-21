// Reads and writes the whole team dataset to a Redis database
// using the standard Redis connection string in REDIS_URL.

import { createClient } from "redis";

const KEY = "pcc-forecast";

export default async function handler(req, res) {
  const url = process.env.REDIS_URL;
  if (!url) {
    res.status(500).json({ error: "REDIS_URL is not set. Check the database is connected in Vercel, then redeploy." });
    return;
  }

  let client;
  try {
    client = createClient({ url });
    client.on("error", () => {}); // avoid crashing the function on a transient blip
    await client.connect();

    if (req.method === "POST") {
      const value = (req.body && req.body.value) || "";
      await client.set(KEY, value);
      res.status(200).json({ ok: true });
    } else {
      const value = await client.get(KEY);
      res.status(200).json({ value: value ?? null });
    }
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    if (client) { try { await client.quit(); } catch (e) {} }
  }
}
