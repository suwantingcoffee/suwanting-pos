export default async function teardown() {
    // Windows process-tree termination alone can leave pg_ctl-started servers alive.
    const response = await fetch('http://127.0.0.1:4175/__test/shutdown', { method: 'POST', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Browser test database did not stop cleanly.');
}
