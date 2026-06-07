exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  try {
    const { url, type } = JSON.parse(event.body);
    const result = await parseMedia(url);
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};

async function parseMedia(url) {
  const platform = detectPlatform(url);
  let finalUrl = url;

  // Resolve short links
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3000) });
    const loc = r.headers.get('location');
    if (loc) finalUrl = new URL(loc, url).href;
  } catch (e) {}

  // Use third-party parser API (fast, reliable)
  if (platform === 'douyin') {
    try {
      const apiUrl = 'https://devtool.liam.design/douyin/parse?url=' + encodeURIComponent(finalUrl);
      const r = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (d.code === 200 && d.data) {
        return {
          type: d.data.type === 'image' ? 'image' : 'video',
          title: d.data.title || '',
          cover: d.data.cover || '',
          videoUrl: d.data.video_url || d.data.url || null,
          images: d.data.images || [],
          author: d.data.author || '',
          id: d.data.id || ''
        };
      }
    } catch (e) {
      return { error: '瑙ｆ瀽瓒呮椂锛岃绋嶅悗閲嶈瘯' };
    }
    return { error: '瑙ｆ瀽澶辫触锛岃纭閾炬帴鏈夋晥' };
  }

  if (platform === 'xiaohongshu') {
    try {
      const r = await fetch(finalUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      const html = await r.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/\s*[-|].*$/, '').trim() : '';
      return { type: 'image', title, images: [], videoUrl: null };
    } catch (e) {
      return { error: '灏忕孩涔﹁В鏋愯秴鏃? };
    }
  }

  if (platform === 'bilibili') {
    try {
      const bv = finalUrl.match(/BV[a-zA-Z0-9]+/);
      if (!bv) return { error: '鏃犳晥B绔欓摼鎺? };
      const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv[0], {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com' },
        signal: AbortSignal.timeout(5000)
      });
      const d = await r.json();
      if (d.code !== 0) return { error: d.message };
      return {
        type: 'video',
        title: d.data.title,
        cover: d.data.pic,
        author: d.data.owner ? d.data.owner.name : '',
        id: bv[0]
      };
    } catch (e) {
      return { error: 'B绔欒В鏋愯秴鏃? };
    }
  }

  return { error: '涓嶆敮鎸佺殑骞冲彴' };
}

function detectPlatform(url) {
  if (url.includes('douyin.com') || url.includes('iesdouyin.com')) return 'douyin';
  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) return 'xiaohongshu';
  if (url.includes('bilibili.com') || url.includes('b23.tv')) return 'bilibili';
  return 'unknown';
}
