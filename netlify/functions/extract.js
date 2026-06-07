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
    
    // Detect platform
    let platform = 'unknown';
    if (url.includes('douyin.com') || url.includes('iesdouyin.com')) platform = 'douyin';
    else if (url.includes('xiaohongshu.com') || url.includes('xhslink.com')) platform = 'xiaohongshu';
    else if (url.includes('bilibili.com') || url.includes('b23.tv')) platform = 'bilibili';

    let result = null;

    if (type === 'parse') {
      // Attempt to resolve short links and extract metadata
      const info = await parseMedia(url, platform);
      result = { success: true, platform, ...info };
    } else if (type === 'comments') {
      result = await fetchComments(url, platform);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(result || { success: false, error: 'Unknown type' })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};

async function parseMedia(url, platform) {
  // For short links, resolve the redirect first
  let finalUrl = url;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual' });
    const loc = r.headers.get('location');
    if (loc) {
      finalUrl = new URL(loc, url).href;
      // Re-detect platform
      if (finalUrl.includes('douyin.com')) platform = 'douyin';
      else if (finalUrl.includes('xiaohongshu.com')) platform = 'xiaohongshu';
    }
  } catch (e) {
    // Use original URL
  }

  if (platform === 'douyin') {
    return parseDouyin(finalUrl);
  } else if (platform === 'xiaohongshu') {
    return parseXiaohongshu(finalUrl);
  } else if (platform === 'bilibili') {
    return parseBilibili(finalUrl);
  }

  return { error: '不支持的平台', platform };
}

async function parseDouyin(url) {
  // Extract video ID
  const match = url.match(/video\/(\d+)/) || url.match(/note\/(\d+)/);
  const id = match ? match[1] : null;
  
  if (!id) return { error: '无法解析抖音链接，请使用分享链接' };

  // Try fetching the page to extract video info
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/json'
      }
    });
    const html = await resp.text();

    // Try to find video data in page
    const jsonMatch = html.match(/"videoData":\s*(\{[^}]+\})/);
    let title = '';
    let coverUrl = '';
    let videoUrl = '';

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) title = titleMatch[1].replace(/[\\s-]+抖音.*$/, '').trim();

    // Try to find playAddr
    const playMatch = html.match(/"playAddr":\s*"([^"]+)"/);
    if (playMatch) videoUrl = playMatch[1].replace(/\\u002F/g, '/');

    // Cover
    const coverMatch = html.match(/"cover":\s*"([^"]+)"/);
    if (coverMatch) coverUrl = coverMatch[1].replace(/\\u002F/g, '/');

    if (videoUrl || coverUrl) {
      return {
        type: videoUrl ? 'video' : 'image',
        title,
        cover: coverUrl,
        videoUrl: videoUrl || null,
        id
      };
    }

    // If page parsing failed, return basic info
    return {
      type: 'video',
      title: title || `抖音视频 ${id}`,
      cover: coverUrl || '',
      videoUrl: videoUrl || '',
      id,
      note: '如无法下载，请尝试使用其他解析工具'
    };
  } catch (e) {
    return { error: `解析失败: ${e.message}`, id };
  }
}

async function parseXiaohongshu(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
      }
    });
    const html = await resp.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(/[\\s-]+小红书.*$/, '').trim() : '小红书笔记';

    // Extract images
    const images = [];
    const imgRegex = /"traceId":"[^"]*","url":"(https?:\\/\\/[^"]+)"/g;
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      images.push(m[1].replace(/\\u002F/g, '/'));
    }

    // Extract video
    const videoMatch = html.match(/"videoUrl":"(https?:\\/\\/[^"]+)"/);
    const videoUrl = videoMatch ? videoMatch[1].replace(/\\u002F/g, '/') : null;

    if (images.length === 0 && !videoUrl) {
      return { error: '无法提取内容，可能需要登录', title };
    }

    return {
      type: videoUrl ? 'video' : (images.length > 1 ? 'gallery' : 'image'),
      title,
      images: images.slice(0, 18),
      videoUrl: videoUrl || null
    };
  } catch (e) {
    return { error: `解析失败: ${e.message}` };
  }
}

async function parseBilibili(url) {
  try {
    // Extract BV/AV ID
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
    const avMatch = url.match(/av(\d+)/);
    const id = bvMatch ? bvMatch[0] : (avMatch ? `av${avMatch[1]}` : null);
    
    if (!id) return { error: '无法解析B站链接' };

    // Use B站 API
    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${id}`;
    const resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.bilibili.com'
      }
    });
    const data = await resp.json();

    if (data.code !== 0) {
      return { error: data.message || 'B站API请求失败' };
    }

    const v = data.data;
    return {
      type: 'video',
      title: v.title,
      cover: v.pic,
      description: v.desc,
      duration: v.duration,
      author: v.owner?.name,
      id,
      videoUrl: null // B站需要额外API获取下载链接
    };
  } catch (e) {
    return { error: `B站解析失败: ${e.message}` };
  }
}

async function fetchComments(url, platform) {
  return {
    success: false,
    message: '评论抓取功能开发中，请期待后续更新'
  };
}
