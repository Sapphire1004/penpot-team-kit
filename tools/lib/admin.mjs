import net from 'node:net';
export function admin(command, params) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: process.env.PENPOT_ADMIN_HOST || '127.0.0.1', port: Number(process.env.PENPOT_ADMIN_PORT || 6063) });
    let buffered = '';
    const finish = (error, value) => { socket.destroy(); error ? reject(error) : resolve(value); };
    socket.setTimeout(30_000, () => finish(new Error('Account management timed out.')));
    socket.on('error', () => finish(new Error('Account management unavailable; run inside the backend network namespace.')));
    socket.on('connect', () => socket.write(JSON.stringify({ cmd: command, params }) + '\n'));
    socket.on('data', data => {
      buffered += data.toString();
      while (buffered.includes('\n')) {
        const i = buffered.indexOf('\n'), line = buffered.slice(0, i); buffered = buffered.slice(i + 1);
        let result; try { result = JSON.parse(line); } catch { return finish(new Error('Invalid management response.')); }
        if (result.tag === 'ret') {
          if (result.err) return finish(new Error(`Management command failed: ${result.err.code || 'error'}`));
          return finish(null, result.val);
        }
      }
    });
  });
}
