// Vercel serverless function: /api/geocode?address=...
//
// The Geocoding API is a web service, so Google's HTTP-referrer restrictions
// do not apply to it — a key sitting in the browser can be lifted and spent by
// anyone. Proxying keeps the key in an environment variable on the server.
//
// Setup:
//   1. Google Cloud Console > Credentials > Create credentials > API key
//   2. Restrict that key to the Geocoding API only (API restrictions tab)
//   3. Set a daily quota cap on the Geocoding API so a leak can't run up a bill
//   4. Vercel > Project > Settings > Environment Variables > GEOCODE_KEY
//   5. Redeploy

const ALLOWED_ORIGINS = [
  "https://www.myholidaydisplay.com",
  "https://myholidaydisplay.com",
];

export default async function handler(req, res) {
  // Only same-site callers. Not a hard security boundary (Origin is spoofable
  // outside a browser), but it stops other sites from embedding your quota.
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ status: "FORBIDDEN" });
  }

  const address = (req.query.address || "").toString().trim();
  if (!address || address.length > 300) {
    return res.status(400).json({ status: "INVALID_REQUEST" });
  }

  const key = process.env.GEOCODE_KEY;
  if (!key) {
    console.error("GEOCODE_KEY is not set");
    return res.status(500).json({ status: "SERVER_MISCONFIGURED" });
  }

  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      "?address=" + encodeURIComponent(address) +
      "&components=country:US" +
      "&key=" + key;

    const upstream = await fetch(url);
    const data = await upstream.json();

    // Return only what the client needs — never echo the upstream error text,
    // which can contain the key.
    const first = data.results && data.results[0];
    const body = {
      status: data.status,
      results: first
        ? [{
            geometry: { location: first.geometry.location },
            formatted_address: first.formatted_address,
          }]
        : [],
    };

    // Same address resolves to the same point; let the edge cache absorb repeats.
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(body);
  } catch (err) {
    console.error("geocode proxy failed:", err.message);
    return res.status(502).json({ status: "UPSTREAM_ERROR" });
  }
}
