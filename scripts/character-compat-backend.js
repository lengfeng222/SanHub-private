const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CHARACTER_BACKEND_PORT || 8000);
const HOST = process.env.CHARACTER_BACKEND_HOST || '0.0.0.0';
const DATA_FILE =
  process.env.CHARACTER_BACKEND_DATA ||
  path.join(process.cwd(), 'data', 'character-backend.json');
const ADMIN_USERNAME = process.env.CHARACTER_BACKEND_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.CHARACTER_BACKEND_ADMIN_PASSWORD || 'admin123';
const API_KEY = process.env.CHARACTER_BACKEND_API_KEY || 'compat-character-key';

function ensureStore() {
  const dir = path.dirname(DATA_FILE);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          characters: [],
          tokens: [],
          nextTokenId: 1,
          adminToken: `adm_${Math.random().toString(36).slice(2)}`,
        },
        null,
        2
      )
    );
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function sendJson(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

function notFound(res, pathname) {
  return sendJson(res, 404, {
    error: {
      message: `未找到接口路径 ${pathname}`,
      type: 'not_found',
    },
  });
}

function unauthorized(res) {
  return sendJson(res, 401, { success: false, message: 'Unauthorized' });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ raw });
      }
    });
    req.on('error', reject);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeUsername(input) {
  const raw = String(input || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 32);
  return raw || `char_${Math.random().toString(36).slice(2, 10)}`;
}

function requireApiKey(req, res) {
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${API_KEY}`) return true;
  sendJson(res, 401, { error: { message: 'Invalid API key', type: 'unauthorized' } });
  return false;
}

function requireAdmin(req, res, store) {
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${store.adminToken}`) return true;
  return unauthorized(res);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return notFound(res, '');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;
  const store = readStore();

  try {
    if (pathname === '/' || pathname === '/api/health') {
      return sendJson(res, 200, {
        success: true,
        service: 'character-compat-backend',
        status: 'ok',
      });
    }

    if (pathname === '/v1/skills' && req.method === 'GET') {
      return sendJson(res, 200, {
        auth: { format: 'Bearer {api_key}', header: 'Authorization', method: 'bearer' },
        base_url: `http://127.0.0.1:${PORT}`,
        categories: [
          {
            name: 'character',
            endpoints: [
              {
                id: 'create_character',
                name: '创建角色卡',
                method: 'POST',
                path: '/v1/characters',
              },
              {
                id: 'search_character',
                name: '搜索角色卡',
                method: 'GET',
                path: '/v1/characters/search',
              },
            ],
          },
        ],
      });
    }

    if (pathname === '/v1/models' && req.method === 'GET') {
      return sendJson(res, 200, {
        object: 'list',
        data: [{ id: 'sora-video-10s', object: 'model', owned_by: 'compat-backend' }],
      });
    }

    if (pathname === '/v1/characters' && req.method === 'POST') {
      if (!requireApiKey(req, res)) return;
      const body = await parseBody(req);
      const username = sanitizeUsername(body.username || body.display_name || body.displayName);
      const displayName = String(body.display_name || body.displayName || username).trim().slice(0, 64);
      const cameoId = id('ch');
      const characterId = id('char');
      const createdAt = nowIso();

      const character = {
        id: store.characters.length + 1,
        cameo_id: cameoId,
        character_id: characterId,
        token_id: 1,
        user_id: characterId,
        username,
        display_name: displayName,
        profile_url: '',
        instruction_set: String(body.instruction_set || body.instructionSet || ''),
        safety_instruction_set: String(body.safety_instruction_set || body.safetyInstructionSet || ''),
        visibility: 'private',
        status: 'finalized',
        created_at: createdAt,
        updated_at: createdAt,
      };

      store.characters.unshift(character);
      writeStore(store);

      return sendJson(res, 200, {
        id: characterId,
        object: 'character',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'sora-video-10s',
        data: {
          cameo_id: cameoId,
          username,
          display_name: displayName,
          message: 'Character created successfully',
        },
      });
    }

    if (pathname === '/v1/characters/search' && req.method === 'GET') {
      if (!requireApiKey(req, res)) return;
      const keyword = String(url.searchParams.get('username') || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 10)));
      const results = store.characters
        .filter((item) => {
          if (!keyword) return true;
          return (
            String(item.username || '').toLowerCase().includes(keyword) ||
            String(item.display_name || '').toLowerCase().includes(keyword)
          );
        })
        .slice(0, limit)
        .map((item) => ({
          user_id: item.user_id,
          username: item.username,
          display_name: item.display_name,
          profile_picture_url: item.profile_url || '',
          can_cameo: true,
          token: 'compat-local',
        }));

      return sendJson(res, 200, {
        success: true,
        query: keyword,
        count: results.length,
        results,
      });
    }

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await parseBody(req);
      if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { success: false, message: '用户名或密码错误' });
      }
      store.adminToken = `adm_${Math.random().toString(36).slice(2)}`;
      writeStore(store);
      return sendJson(res, 200, { success: true, token: store.adminToken });
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
      if (!requireAdmin(req, res, store)) return;
      return sendJson(res, 200, {
        success: true,
        data: {
          total_tokens: store.tokens.length,
          active_tokens: store.tokens.length,
          today_images: 0,
          total_images: 0,
          today_videos: 0,
          total_videos: 0,
        },
      });
    }

    if (pathname === '/api/tokens/rt2at' && req.method === 'POST') {
      if (!requireAdmin(req, res, store)) return;
      const body = await parseBody(req);
      const rt = String(body.rt || '').trim();
      if (!rt) return sendJson(res, 400, { success: false, message: '缺少 rt' });
      return sendJson(res, 200, {
        success: true,
        message: 'RT converted to AT successfully',
        access_token: `at_${Buffer.from(rt).toString('base64').slice(0, 24)}`,
        refresh_token: rt,
        expires_in: 3600,
      });
    }

    if (pathname === '/api/tokens' && req.method === 'POST') {
      if (!requireAdmin(req, res, store)) return;
      const body = await parseBody(req);
      const tokenId = store.nextTokenId++;
      store.tokens.push({
        token_id: tokenId,
        token: String(body.token || ''),
        rt: String(body.rt || ''),
        created_at: nowIso(),
      });
      writeStore(store);
      return sendJson(res, 200, { success: true, token_id: tokenId });
    }

    if (pathname === '/api/tokens' && req.method === 'GET') {
      if (!requireAdmin(req, res, store)) return;
      return sendJson(res, 200, {
        success: true,
        tokens: store.tokens,
      });
    }

    if (pathname === '/api/characters' && req.method === 'GET') {
      if (!requireAdmin(req, res, store)) return;
      return sendJson(res, 200, {
        success: true,
        characters: store.characters,
      });
    }

    if (pathname.startsWith('/api/characters/by-token/') && req.method === 'GET') {
      if (!requireAdmin(req, res, store)) return;
      const tokenId = Number(pathname.split('/').pop());
      return sendJson(res, 200, {
        success: true,
        characters: store.characters.filter((item) => Number(item.token_id) === tokenId),
      });
    }

    if (pathname.startsWith('/api/characters/') && pathname.endsWith('/update') && req.method === 'POST') {
      if (!requireAdmin(req, res, store)) return;
      const cameoId = pathname.split('/')[3];
      const body = await parseBody(req);
      const target = store.characters.find((item) => item.cameo_id === cameoId);
      if (!target) return sendJson(res, 404, { success: false, message: '角色不存在' });
      target.instruction_set = String(body.instruction_set || target.instruction_set || '');
      target.safety_instruction_set = String(body.safety_instruction_set || target.safety_instruction_set || '');
      target.visibility = body.visibility === 'public' ? 'public' : 'private';
      target.updated_at = nowIso();
      writeStore(store);
      return sendJson(res, 200, { success: true, character: target });
    }

    if (pathname.startsWith('/api/characters/') && req.method === 'GET') {
      if (!requireAdmin(req, res, store)) return;
      const cameoId = pathname.split('/').pop();
      const target = store.characters.find((item) => item.cameo_id === cameoId);
      if (!target) return sendJson(res, 404, { success: false, message: '角色不存在' });
      return sendJson(res, 200, { success: true, character: target });
    }

    if (pathname.startsWith('/api/characters/') && req.method === 'DELETE') {
      if (!requireAdmin(req, res, store)) return;
      const cameoId = pathname.split('/').pop();
      store.characters = store.characters.filter((item) => item.cameo_id !== cameoId);
      writeStore(store);
      return sendJson(res, 200, { success: true });
    }

    return notFound(res, pathname);
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[character-compat-backend] listening on http://${HOST}:${PORT}`);
});
