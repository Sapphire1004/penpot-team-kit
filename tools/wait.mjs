const origin = process.env.PENPOT_ORIGIN || 'http://frontend:8080';
for (let attempt = 0; attempt < 60; attempt++) {
  const ready = await fetch(origin + '/readyz', { signal: AbortSignal.timeout(3_000) }).then(r => r.ok).catch(() => false);
  if (ready) { console.log('Penpot frontend and backend are ready. Create an account with ./penpot account:create.'); process.exit(0); }
  await new Promise(resolve => setTimeout(resolve, 2_000));
}
throw new Error('Penpot did not become ready in 120 seconds.');
