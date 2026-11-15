import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { admin } from './lib/admin.mjs';
import { createPenpotClient } from './lib/client.mjs';
import { channel } from './lib/channel.mjs';
import { checkMcp } from './lib/mcp-smoke.mjs';

const origin = process.env.PENPOT_ORIGIN || 'http://frontend:8080';
const recoveryPath = '.local/multiuser-recovery.json';
const sockets = [];
const exists = path => access(path).then(() => true, () => false);
const makeClient = credentials => createPenpotClient({ origin, credentials });
let state;
const persist = async () => writeFile(recoveryPath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
async function cleanup() {
  for (const socket of sockets) socket.close();
  const errors = [];
  const ownerRecord = state.accounts[0];
  if (ownerRecord && state.teamId) {
    const owner = makeClient(ownerRecord.credentials);
    try {
      const members = await owner.rpc('get-team-members', { 'team-id': state.teamId });
      for (const member of members.filter(m => m.id !== ownerRecord.id)) {
        await owner.rpc('delete-team-member', { 'team-id': state.teamId, 'member-id': member.id });
      }
    } catch (error) { if (![400, 401, 403, 404].includes(error.status)) errors.push('shared membership cleanup'); }
  }
  // The owner is last so team members can be removed before owner deletion.
  const ordered = [...state.accounts.slice(1), ...state.accounts.slice(0, 1)];
  for (const record of ordered) {
    try { await makeClient(record.credentials).rpc('delete-profile'); }
    catch (error) { if (![400, 401, 404].includes(error.status)) errors.push('profile cleanup'); }
  }
  let rejected = 0;
  for (const record of state.accounts) {
    try { await makeClient(record.credentials).sessionCookie(); errors.push('temporary account is still usable'); }
    catch (error) { if ([400, 401, 403].includes(error.status)) rejected++; else errors.push('account cleanup could not be verified'); }
  }
  if (!errors.length) await unlink(recoveryPath);
  return { requestedProfileDeletions: state.accounts.length, temporaryLoginsRejected: rejected, errors, recoveryFileRetained: errors.length > 0 };
}
if (process.argv.includes('--cleanup')) {
  if (!(await exists(recoveryPath))) { console.log('No pending test cleanup.'); process.exit(0); }
  state = JSON.parse(await readFile(recoveryPath, 'utf8'));
  const result = await cleanup(); console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors.length ? 1 : 0);
}
if (await exists(recoveryPath)) throw new Error('A previous test needs cleanup. Run ./penpot test:cleanup first.');
await mkdir('.local', { recursive: true, mode: 0o700 });
await mkdir('test-results', { recursive: true });
const run = randomBytes(6).toString('hex');
state = { startedAt: new Date().toISOString(), accounts: [] };
await writeFile(recoveryPath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
const report = {
  startedAt: state.startedAt, origin,
  scope: 'Ten distinct authenticated accounts and real collaboration WebSockets: eight editors (including the test owner), two viewers. An additional outsider tests access isolation. Five concurrent edit rounds on eight independent shapes. This is a short protocol integration test, not ten browser sessions or a long-running load test.',
  checks: [], rounds: [],
};
const started = performance.now();
try {
  for (let i = 0; i < 11; i++) {
    const credentials = { email: `collab-${run}-${i}@example.invalid`, fullname: `Collaboration test ${i}`, password: randomBytes(32).toString('base64url') + 'Aa9!' };
    const record = { credentials, role: i < 8 ? 'editor' : i < 10 ? 'viewer' : 'outsider' };
    state.accounts.push(record); await persist();
    await admin('create-profile', { ...credentials, isActive: true });
    record.api = makeClient(credentials);
    record.id = (await record.api.rpc('get-profile')).id;
    // Do not persist session cookies or API client objects.
    await persist();
  }
  assert.equal(new Set(state.accounts.map(a => a.id)).size, 11);
  report.checks.push('eleven distinct profiles log in with native password authentication');
  const owner = state.accounts[0].api;
  const team = await owner.rpc('create-team', { name: `Collaboration verification ${run}` });
  state.teamId = team.id; await persist();
  for (const role of ['editor', 'viewer']) {
    const emails = state.accounts.slice(1, 10).filter(a => a.role === role).map(a => a.credentials.email);
    await owner.rpc('create-team-invitations', { 'team-id': team.id, emails, role });
  }
  const projects = await owner.rpc('get-projects', { 'team-id': team.id });
  const project = projects.find(p => p.isDefault) || projects[0];
  const created = await owner.rpc('create-file', { 'project-id': project.id, name: 'Shared collaboration test' });
  state.fileId = created.id; await persist();
  let file = await owner.rpc('get-file', { id: created.id });
  const pageId = file.data.pages[0], zero = '00000000-0000-0000-0000-000000000000';
  const shapeIds = Array.from({ length: 8 }, () => randomUUID());
  const changes = shapeIds.map((id, index) => {
    const x = index * 60 + 20, y = 20, width = 40, height = 40;
    const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const obj = { id, name: `Editor ${index}`, type: 'rect', x, y, width, height,
      'parent-id': zero, 'frame-id': zero,
      selrect: { x, y, width, height, x1: x, y1: y, x2: x + width, y2: y + height },
      points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }],
      transform: matrix, 'transform-inverse': matrix,
      fills: [{ 'fill-color': '#2563EB', 'fill-opacity': 1 }],
    };
    return { type: 'add-obj', id, obj, 'page-id': pageId, 'frame-id': zero, 'parent-id': zero };
  });
  await owner.rpc('update-file', { id: file.id, 'session-id': randomUUID(), revn: file.revn, vern: file.vern, changes });
  file = await owner.rpc('get-file', { id: file.id });
  assert.equal(Object.keys(file.data.pagesIndex[pageId].objects).length, 9);
  report.checks.push('isolated test team and file contain eight real editable rectangle shapes');
  const members = state.accounts.slice(0, 10);
  const loads = await Promise.all(members.map(async member => {
    const start = performance.now();
    assert.equal((await member.api.rpc('get-file', { id: file.id })).id, file.id);
    return Math.round(performance.now() - start);
  }));
  report.concurrentFileLoadMs = loads;
  report.checks.push('ten independent native sessions read the same file concurrently');
  for (const member of members) {
    const teams = await member.api.rpc('get-teams');
    assert.equal(teams.find(t => t.id === team.id).permissions.canEdit, member.role === 'editor');
    const ws = await channel({ origin, cookie: await member.api.sessionCookie(), fileId: file.id });
    sockets.push(ws); ws.subscribe();
  }
  await sockets[0].wait(text => text.includes(members[9].id) && /join-file|presence/.test(text), 'last viewer presence');
  report.peakAuthenticatedWebSockets = sockets.length;
  report.checks.push('ten distinct accounts hold simultaneous subscribed collaboration connections');
  for (let round = 0; round < 5; round++) {
    const current = await owner.rpc('get-file', { id: file.id });
    const markers = shapeIds.map((id, index) => `edit-${run}-${round}-${index}`);
    const start = performance.now();
    await Promise.all(members.slice(0, 8).map((member, index) => member.api.rpc('update-file', {
      id: file.id, 'session-id': sockets[index].sessionId, revn: current.revn, vern: current.vern,
      changes: [{ type: 'mod-obj', id: shapeIds[index], 'page-id': pageId, operations: [
        { type: 'set', attr: 'name', val: markers[index] },
        { type: 'set', attr: 'opacity', val: 0.5 + round * 0.1 },
      ] }],
    })));
    const writesMs = Math.round(performance.now() - start);
    await Promise.all(sockets.flatMap((ws, receiver) => markers.filter((_, sender) => receiver !== sender).map(marker => ws.wait(text => text.includes('file-change') && text.includes(marker), 'peer edit propagation'))));
    const propagatedMs = Math.round(performance.now() - start);
    for (const viewer of members.slice(8)) {
      const current = await viewer.api.rpc('get-file', { id: file.id });
      for (let i = 0; i < 8; i++) {
        const shape = current.data.pagesIndex[pageId].objects[shapeIds[i]];
        assert.equal(shape.name, markers[i]); assert.ok(Math.abs(shape.opacity - (0.5 + round * 0.1)) < 0.001);
      }
    }
    report.rounds.push({ round: round + 1, concurrentEditors: 8, writesMs, allPeerNotificationsMs: propagatedMs });
  }
  report.checks.push('forty concurrent shape edits persist without losing independent updates and reach all peers');
  const latest = await owner.rpc('get-file', { id: file.id });
  for (const viewer of members.slice(8)) {
    await assert.rejects(viewer.api.rpc('update-file', { id: file.id, 'session-id': randomUUID(), revn: latest.revn, vern: latest.vern,
      changes: [{ type: 'mod-obj', id: shapeIds[0], 'page-id': pageId, operations: [{ type: 'set', attr: 'name', val: 'VIEWER_MUST_NOT_WRITE' }] }],
    }), error => [403, 404].includes(error.status));
  }
  assert.notEqual((await owner.rpc('get-file', { id: file.id })).data.pagesIndex[pageId].objects[shapeIds[0]].name, 'VIEWER_MUST_NOT_WRITE');
  report.checks.push('both viewers receive real-time changes but cannot edit the file');
  await assert.rejects(state.accounts[10].api.rpc('get-file', { id: file.id }), error => [403, 404].includes(error.status));
  report.checks.push('a logged-in outsider cannot access the shared file');
  const personalTeams = await members[1].api.rpc('get-teams');
  const privateTeam = personalTeams.find(t => t.id !== team.id && t.permissions.isOwner);
  const privateProjects = await members[1].api.rpc('get-projects', { 'team-id': privateTeam.id });
  const privateFile = await members[1].api.rpc('create-file', { 'project-id': privateProjects[0].id, name: 'Private access isolation test' });
  await assert.rejects(members[2].api.rpc('get-file', { id: privateFile.id }), error => [403, 404].includes(error.status));
  report.checks.push('sharing one team does not grant access to another member personal project');
  const anonymous = await fetch(origin + '/api/rpc/command/get-file', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ id: file.id }) });
  assert.ok([401, 403, 404].includes(anonymous.status)); await anonymous.arrayBuffer();
  report.checks.push('anonymous file access is rejected');
  report.mcp = await checkMcp(origin);
  report.checks.push('MCP tools are discoverable and unauthenticated design execution is rejected');
  // Close the editor socket before invalidating its session.
  sockets[7].close();
  const cookie = await members[7].api.sessionCookie();
  await members[7].api.rpc('logout', { 'profile-id': members[7].id });
  const afterLogout = await fetch(origin + '/api/rpc/command/get-file', { method: 'POST', headers: { cookie, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ id: file.id }) });
  assert.ok([401, 403, 404].includes(afterLogout.status)); await afterLogout.arrayBuffer();
  report.checks.push('logout invalidates a session after collaborative editing');
  report.observedNotificationMessages = sockets.reduce((sum, ws) => sum + ws.count(), 0);
  report.connectedEditors = 8; report.connectedViewers = 2; report.concurrentShapeUpdates = 40;
} catch (error) {
  report.error = String(error.message).replace(/userToken=[^\s&"']+/g, 'userToken=[redacted]');
  process.exitCode = 1;
} finally {
  report.cleanup = await cleanup();
  if (report.cleanup.errors.length) process.exitCode = 1;
  report.elapsedMs = Math.round(performance.now() - started);
  report.finishedAt = new Date().toISOString();
  report.passed = !report.error && !report.cleanup.errors.length;
  report.checkCount = report.checks.length;
  const path = `test-results/multiuser-${report.finishedAt.replace(/[:.]/g, '-')}.json`;
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, reportFile: path }, null, 2));
}
