// Reads and writes the whole team dataset to Upstash Redis.
// No npm packages needed — it talks to Upstash over its REST API.
//
// It looks for the database credentials under the names Vercel/Upstash
// commonly inject. If you add Upstash through Vercel's Storage tab these
// are set for you. If you set them by hand, name them:
//   UPSTASH_REDIS_REST_URL   and   UPSTASH_REDIS_REST_TOKEN

const KEY = "pcc-forecast";

function creds() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_TOKEN;
  return { url, token };
}

async function redis(url, token, command) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  return r.json(); // { result: ... }
}

export default async function handler(req, res) {
  const { url, token } = creds();
  if (!url || !token) {
    res.status(500).json({ error: "Database not connected yet. Add Upstash in the Vercel Storage tab, then redeploy." });
    return;
  }

  try {
    if (req.method === "POST") {
      const value = (req.body && req.body.value) || "";
      await redis(url, token, ["SET", KEY, value]);
      res.status(200).json({ ok: true });
      return;
    }
    // GET
    const j = await redis(url, token, ["GET", KEY]);
    res.status(200).json({ value: j.result ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
