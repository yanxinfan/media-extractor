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
    const { url } = JSON.parse(event.body);
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

function detectPlatform(url) {
  if (url.includes('douyin.com') || url.includes('iesdouyin.com')) return 'douyin';
  if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) return 'xiaohongshu';
  if (url.includes('bilibili.com') || url.includes('b23.tv')) return 'bilibili';
  return 'unknown';
}

async function parseMedia(url) {
  var platform = detectPlatform(url);
  var finalUrl = url;

  try {
    var r = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    var loc = r.headers.get('location');
    if (loc) finalUrl = new URL(loc, url).href;
  } catch (e) {}

  if (platform === 'douyin') {
    var apiUrl = 'https://devtool.liam.design/douyin/parse?url=' + encodeURIComponent(finalUrl);
    var r2 = await fetch(apiUrl);
    var d = await r2.json();
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
    return { error: 'parse failed, check link' };
  }

  if (platform === 'bilibili') {
    var bv = finalUrl.match(/BV[a-zA-Z0-9]+/);
    if (!bv) return { error: 'invalid bilibili link' };
    var r3 = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv[0], {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com' }
    });
    var d2 = await r3.json();
    if (d2.code !== 0) return { error: d2.message };
    return {
      type: 'video',
      title: d2.data.title,
      cover: d2.data.pic,
      author: d2.data.owner ? d2.data.owner.name : '',
      id: bv[0]
    };
  }

  return { error: 'unsupported platform. supported: douyin, xiaohongshu, bilibili' };
}
