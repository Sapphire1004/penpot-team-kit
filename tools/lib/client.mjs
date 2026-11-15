import { readFile } from 'node:fs/promises';

export function createPenpotClient({ origin, credentialsFile, credentials }) {
  let cookie = '';
  let loginPromise;
  const cookies = new Map();
  function absorbCookies(values = []) {
    for (const value of values) {
      const pair = value.split(';')[0], index = pair.indexOf('=');
      if (index < 1) continue;
      const name = pair.slice(0, index), content = pair.slice(index + 1);
      if (!content || /max-age=0(?:;|$)/i.test(value)) cookies.delete(name);
      else cookies.set(name, content);
    }
    cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  async function request(method, params, { form } = {}) {
    const response = await fetch(`${origin}/api/rpc/command/${method}`, {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { accept: 'application/json', ...(form ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: form || JSON.stringify(params),
    });
    absorbCookies(response.headers.getSetCookie());
    return response;
  }
  async function login() {
    if (!loginPromise) loginPromise = (async () => {
      const { email, password } = credentials || JSON.parse(await readFile(credentialsFile, 'utf8'));
      const response = await request('login-with-password', { email, password });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw Object.assign(new Error('Penpot 로그인 정보를 확인하세요.'), { status: response.status, code: detail.code || detail.type });
      }
      await response.arrayBuffer();
    })().finally(() => { loginPromise = null; });
    await loginPromise;
  }
  async function command(method, params = {}, options) {
    if (!cookie) await login();
    let response = await request(method, params, options);
    if (response.status === 401) { await login(); response = await request(method, params, options); }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = new Error(response.status === 404 || response.status === 403 ? '파일이 없거나 이 계정에 접근 권한이 없습니다.' : 'Penpot 요청을 완료하지 못했습니다.');
      error.status = response.status; error.code = detail.code || detail.type;
      error.hint = detail.hint;
      throw error;
    }
    return response;
  }
  async function rpc(method, params) {
    const text = await (await command(method, params)).text();
    return text ? JSON.parse(text) : null;
  }
  async function exportFile(fileId) {
    const response = await command('export-binfile', { 'file-id': fileId, 'include-libraries': true, 'embed-assets': false });
    const events = (await response.text()).split(/\r?\n\r?\n/);
    const end = events.find(event => /^event:\s*end\s*$/m.test(event));
    if (!end) throw new Error('디자인 내보내기를 완료하지 못했습니다.');
    const data = JSON.parse(end.split(/\r?\n/).find(line => line.startsWith('data:')).slice(5).trim());
    const exported = new URL(typeof data === 'string' ? data : data['~#uri']);
    // Penpot's public URI differs from its internal Docker hostname.
    if (!exported.pathname.match(/^\/assets\/by-id\/[\da-f-]+$/i)) throw new Error('올바르지 않은 다운로드 주소입니다.');
    const download = await fetch(new URL(exported.pathname, origin), { headers: { cookie }, signal: AbortSignal.timeout(60_000) });
    if (!download.ok) throw new Error('디자인 다운로드를 완료하지 못했습니다.');
    return Buffer.from(await download.arrayBuffer());
  }
  async function sessionCookie() {
    if (!cookie) await login();
    return cookie;
  }
  return { rpc, command, exportFile, sessionCookie, refreshSession: login, absorbCookies };
}
