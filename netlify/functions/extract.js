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
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405 };
  }

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
  // Resolve short links
  let finalUrl = url;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    const loc = r.headers.get('location');
    if (loc) { finalUrl = new URL(loc, url).href; platform = detectPlatform(finalUrl); }
  } catch (e) {}

  if (platform === 'douyin') return parseDouyin(finalUrl);
  if (platform === 'xiaohongshu') return parseXiaohongshu(finalUrl);
  if (platform === 'bilibili') return parseBilibili(finalUrl);

  return { error: '不支持的平台。目前支持：抖音、小红书、B站', platform };
}

async function parseDouyin(url) {
  const match = url.match(/video\/(\d+)/);
  const id = match ? match[1] : null;
  if (!id) return { error: '无法解析抖音链接' };

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' }
    });
    const html = await resp.text();

    let title = '抖音视频';
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      title = titleMatch[1].replace(/\s*[-|].*$/, '').trim();
    }

    let coverUrl = '';
    const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
    if (coverMatch) coverUrl = coverMatch[1].replace(/\\u002F/g, '/');

    let videoUrl = '';
    const playMatch = html.match(/"playAddr":\s*"([^"]+)"/);
    if (playMatch) videoUrl = playMatch[1].replace(/\\u002F/g, '/');

    return {
      type: videoUrl ? 'video' : 'image',
      title: title || '抖音视频 ' + id,
      cover: coverUrl,
      videoUrl: videoUrl || null,
      id
    };
  } catch (e) {
    return { error: '解析失败: ' + e.message, id };
  }
}

async function parseXiaohongshu(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' }
    });
    const html = await resp.text();

    let title = '小红书笔记';
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      title = titleMatch[1].replace(/\s*[-|].*$/, '').trim();
    }

    const images = [];
    const imgRegex = /"url":"(https?:[^"]+)"/g;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      const imgUrl = m[1].replace(/\\u002F/g, '/');
      if (imgUrl.includes('sns-webpic') || imgUrl.includes('xhscdn')) {
        images.push(imgUrl);
      }
    }
    if (images.length === 0) {
      // Fallback: try traceId pattern
      const fallbackRegex = /"traceId":"[^"]*","url":"(https?:[^"]+)"/g;
      while ((m = fallbackRegex.exec(html)) !== null) {
        images.push(m[1].replace(/\\u002F/g, '/'));
      }
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
    return { error: '解析失败: ' + e.message };
  }
}

async function parseBilibili(url) {
  try {
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
    const avMatch = url.match(/av(\d+)/);
    const id = bvMatch ? bvMatch[0] : (avMatch ? 'av' + avMatch[1] : null);
    if (!id) return { error: '无法解析B站链接' };

    const resp = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + id, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com' }
    });
    const data = await resp.json();

    if (data.code !== 0) {
      return { error: data.message || 'B站API失败' };
    }

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
    return { error: 'B站解析失败: ' + e.message };
  }
}
