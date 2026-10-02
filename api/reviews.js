// VCIL player reviews
// GET  /api/reviews  -> the latest reviews
// POST /api/reviews  -> save a new review (name, rating, message, optional photo)
// Reviews and photos are stored in Vercel Blob storage. Each review is one small file in "reviews/data/".
// To remove a review: Vercel dashboard -> Storage -> your Blob store -> delete its file in reviews/data/.
import { put, list } from "@vercel/blob";

const MAX_REVIEWS = 60;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: "Reviews are not switched on yet. Please try again soon." });
  }

  try {
    if (req.method === "GET") {
      const { blobs } = await list({ prefix: "reviews/data/", limit: 1000 });
      blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      const latest = blobs.slice(0, MAX_REVIEWS);
      const reviews = (await Promise.all(latest.map(async (b) => {
        try {
          const r = await fetch(b.url);
          return r.ok ? await r.json() : null;
        } catch (e) {
          return null;
        }
      }))).filter(Boolean);
      return res.status(200).json({ reviews });
    }

    if (req.method === "POST") {
      let body = req.body || {};
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      // Hidden "website" field: real people leave it empty, spam bots fill it in
      if (body.website) return res.status(200).json({ ok: true });

      const name = clean(body.name, 60);
      const message = clean(body.message, 800);
      const rating = parseInt(body.rating, 10);
      if (!name || !message || !(rating >= 1 && rating <= 5)) {
        return res.status(400).json({ error: "Please add your name, a star rating and your review." });
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      let photo = null;
      if (body.photo) {
        const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.photo));
        if (!m) return res.status(400).json({ error: "That photo could not be read. Please try a JPG or PNG photo." });
        const buf = Buffer.from(m[2], "base64");
        if (buf.length > MAX_PHOTO_BYTES) return res.status(400).json({ error: "That photo is too large. Please choose a smaller one." });
        const ext = m[1] === "jpeg" ? "jpg" : m[1];
        const up = await put(`reviews/photos/${id}.${ext}`, buf, { access: "public", contentType: `image/${m[1]}`, addRandomSuffix: true });
        photo = up.url;
      }

      const review = { id, name, rating, message, photo, date: new Date().toISOString() };
      await put(`reviews/data/${id}.json`, JSON.stringify(review), { access: "public", contentType: "application/json", addRandomSuffix: true });
      return res.status(201).json({ review });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("reviews error", err);
    return res.status(500).json({ error: "Your review could not be saved right now. Please try again later." });
  }
}
