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
    let platform = detectPlatform(url);

    if (type === 'parse') {
      const result = await parseMedia(url, platform);
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify(result)
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Unknown type' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};

function detectPlatform(url) {
  if (url.includes('douyin.com') || url.includes('iesdouyin.com')) return 'douyin';
  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) return 'xiaohongshu';
  if (url.includes('bilibili.com') || url.includes('b23.tv')) return 'bilibili';
  return 'unknown';
}

async function parseMedia(url, platform) {
  let finalUrl = url;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    const loc = r.headers.get('location');
    if (loc) { finalUrl = new URL(loc, url).href; platform = detectPlatform(finalUrl); }
  } catch (e) {}

  if (platform === 'douyin') return parseDouyin(finalUrl);
  if (platform === 'xiaohongshu') return parseXiaohongshu(finalUrl);
  if (platform === 'bilibili') return parseBilibili(finalUrl);

  return { error: '涓嶆敮鎸佺殑骞冲彴銆傜洰鍓嶆敮鎸侊細鎶栭煶銆佸皬绾功銆丅绔?, platform };
}

// 鈹€鈹€ Douyin: use third-party parser APIs 鈹€鈹€
async function parseDouyin(url) {
  // Extract video ID from URL
  let id = null;
  let m = url.match(/video\/(\d+)/);
  if (m) id = m[1];
  if (!id) { m = url.match(/note\/(\d+)/); if (m) id = m[1]; }
  if (!id) { m = url.match(/modal_id=(\d+)/); if (m) id = m[1]; }

  // Try multiple free douyin parser APIs
  const parsers = [
    async () => {
      // API 1: devtool.liam.design
      const r = await fetch('https://devtool.liam.design/douyin/parse?url=' + encodeURIComponent(url));
      const d = await r.json();
      if (d.code === 200 && d.data) {
        return {
          type: d.data.type === 'video' ? 'video' : 'image',
          title: d.data.title || '鎶栭煶瑙嗛',
          cover: d.data.cover || '',
          videoUrl: d.data.video_url || d.data.url || null,
          images: d.data.images || [],
          author: d.data.author || '',
          id: id || d.data.id || ''
        };
      }
      return null;
    },
    async () => {
      // API 2: pearktrue API
      const r = await fetch('https://api.pearktrue.cn/api/video/douyin/?url=' + encodeURIComponent(url));
      const d = await r.json();
      if (d.code === 200 && d.data) {
        return {
          type: 'video',
          title: d.data.title || '鎶栭煶瑙嗛',
          cover: d.data.cover || '',
          videoUrl: d.data.video_url || d.data.url || null,
          author: d.data.author || '',
          id: id || ''
        };
      }
      return null;
    },
    async () => {
      // API 3: fallback - try scraping ourselves
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' },
          redirect: 'follow'
        });
        const html = await resp.text();
        const finalUrl = resp.url;
        if (!id) {
          let m2 = finalUrl.match(/video\/(\d+)/); if (m2) id = m2[1];
        }
        if (id) {
          const titleMatch = html.match(/<title>([^<]+)<\/title>/);
          const title = titleMatch ? titleMatch[1].replace(/\s*[-|].*$/, '').trim() : '鎶栭煶瑙嗛';
          const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
          const cover = coverMatch ? coverMatch[1].replace(/\\u002F/g, '/') : '';
          return { type: 'video', title, cover, videoUrl: null, id };
        }
        return null;
      } catch (e) { return null; }
    }
  ];

  for (const parser of parsers) {
    try {
      const result = await parser();
      if (result) return result;
    } catch (e) {}
  }

  return { error: '鎵€鏈夎В鏋愭柟寮忓潎澶辫触锛岃绋嶅悗閲嶈瘯鎴栦娇鐢ㄥ叾浠栭摼鎺?, id: id || null };
}

async function parseXiaohongshu(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' }
    });
    const html = await resp.text();

    let title = '灏忕孩涔︾瑪璁?;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) title = titleMatch[1].replace(/\s*[-|].*$/, '').trim();

    const images = [];
    const imgRegex = /"url":"(https?:[^"]+)"/g;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      const imgUrl = m[1].replace(/\\u002F/g, '/');
      if (imgUrl.includes('sns-webpic') || imgUrl.includes('xhscdn')) images.push(imgUrl);
    }

    const videoMatch = html.match(/"videoUrl":"(https?:[^"]+)"/);
    const videoUrl = videoMatch ? videoMatch[1].replace(/\\u002F/g, '/') : null;

    return {
      type: videoUrl ? 'video' : (images.length > 1 ? 'gallery' : 'image'),
      title,
      images: images.slice(0, 18),
      videoUrl: videoUrl || null
    };
  } catch (e) {
    return { error: '瑙ｆ瀽澶辫触: ' + e.message };
  }
}

async function parseBilibili(url) {
  try {
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
    const avMatch = url.match(/av(\d+)/);
    const id = bvMatch ? bvMatch[0] : (avMatch ? 'av' + avMatch[1] : null);
    if (!id) return { error: '鏃犳硶瑙ｆ瀽B绔欓摼鎺? };

    const resp = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + id, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com' }
    });
    const data = await resp.json();

    if (data.code !== 0) return { error: data.message || 'B绔橝PI澶辫触' };

    return {
      type: 'video',
      title: data.data.title,
      cover: data.data.pic,
      description: data.data.desc,
      duration: data.data.duration,
      author: data.data.owner ? data.data.owner.name : '',
      id
    };
  } catch (e) {
    return { error: 'B绔欒В鏋愬け璐? ' + e.message };
  }
}
