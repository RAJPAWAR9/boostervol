// Booster OS - YouTube source worker (Cloudflare Workers)
// Routes:  /search?q=song name   -> JSON list of songs
//          /audio?id=VIDEO_ID     -> audio stream (supports Range, CORS enabled)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges',
};
const J = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
});
const AND_UA = 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';

async function yt(endpoint, body, ua) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/' + endpoint + '?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ua || 'Mozilla/5.0', 'Origin': 'https://www.youtube.com' },
    body: JSON.stringify(body),
  });
  return r.json();
}
function secs(t) {
  if (!t) return 0;
  return t.split(':').reduce((a, b) => a * 60 + Number(b), 0);
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const u = new URL(req.url);
    try {
      if (u.pathname === '/search') {
        const q = u.searchParams.get('q');
        if (!q) return J([]);
        const d = await yt('search', {
          context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'IN' } },
          query: q,
        });
        const sections = d?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const out = [];
        for (const s of sections) {
          for (const it of (s.itemSectionRenderer?.contents || [])) {
            const v = it.videoRenderer;
            if (!v || !v.videoId) continue;
            const dur = secs(v.lengthText?.simpleText);
            if (dur < 30 || dur > 900) continue;
            const th = v.thumbnail?.thumbnails || [];
            out.push({
              id: v.videoId,
              title: v.title?.runs?.[0]?.text || 'Untitled',
              artist: v.ownerText?.runs?.[0]?.text || 'YouTube',
              duration: dur,
              thumb: th.length ? th[th.length - 1].url.split('?')[0] : 'https://i.ytimg.com/vi/' + v.videoId + '/hqdefault.jpg',
            });
          }
        }
        return J(out.slice(0, 30));
      }

      if (u.pathname === '/audio') {
        const id = u.searchParams.get('id');
        if (!id || !/^[\w-]{6,20}$/.test(id)) return J({ error: 'bad id' }, 400);
        const d = await yt('player', {
          context: { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'IN' } },
          videoId: id, contentCheckOk: true, racyCheckOk: true,
        }, AND_UA);
        const fm = (d?.streamingData?.adaptiveFormats || [])
          .filter(f => f.url && /^audio\/mp4/.test(f.mimeType || ''))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        const f = fm.find(x => x.itag === 140) || fm[0];
        if (!f) return J({ error: d?.playabilityStatus?.reason || 'no stream available' }, 502);
        const r = await fetch(f.url, { headers: { Range: req.headers.get('Range') || 'bytes=0-', 'User-Agent': AND_UA } });
        const h = new Headers(CORS);
        h.set('Content-Type', 'audio/mp4');
        h.set('Accept-Ranges', 'bytes');
        for (const k of ['Content-Length', 'Content-Range']) if (r.headers.get(k)) h.set(k, r.headers.get(k));
        return new Response(r.body, { status: r.status, headers: h });
      }
      return J({ ok: true, routes: ['/search?q=', '/audio?id='] });
    } catch (e) {
      return J({ error: String(e && e.message || e) }, 500);
    }
  },
};
