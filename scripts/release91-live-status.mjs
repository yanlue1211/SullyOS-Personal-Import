// Read-only production acceptance for merged PR #91. No secrets, DB writes,
// CLI login, AI requests or changes to Cloudflare environment/bindings.
const expected = { pagesCommit: '2b4b784', branch: 'personal/audio-listening', worker: '2026-11-08.11' };
const pages = 'https://yanlue1211.github.io/SullyOS-Personal-Import/';
const worker = 'https://sullyos-amsg.yanlue.workers.dev/';
const report = (label, fields = {}) => console.log('[release91:live-readonly]', JSON.stringify({ label, ...fields }));
const get = async (url, accept) => {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { Accept: accept, 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw Error('HTTP_' + response.status);
  return response;
};
let pagesMatched = false, workerMatched = false;
try {
  const response = await get(pages + '?release91=' + Date.now(), 'text/html');
  const html = await response.text();
  const commit = html.match(/["']__BUILD_COMMIT__["']\\s*:\\s*["']([0-9a-f]{7,40})["']/)?.[1] ?? null;
  const branch = html.match(/["']__BUILD_BRANCH__["']\\s*:\\s*["']([^"']+)["']/)?.[1] ?? null;
  pagesMatched = commit === expected.pagesCommit && branch === expected.branch;
  report('PAGES_VERSION', { commit, branch, expected: expected.pagesCommit, matched: pagesMatched });
} catch (e) {
  report('PAGES_UNKNOWN', { errorType: e instanceof Error ? e.name : 'unknown' });
}
try {
  const response = await get(worker + 'config-check', 'application/json');
  const info = await response.json();
  const version = typeof info.workerVersion === 'string' ? info.workerVersion : null;
  workerMatched = version === expected.worker;
  report('WORKER_VERSION', {
    workerVersion: version, expected: expected.worker, matched: workerMatched,
    configurationOk: info.configurationOk === true,
    instantTick: info.instantTick === true,
    selfUpdateSupported: info.selfUpdateSupported === true,
    backgroundJobs: info.backgroundJobs === true,
    warningCount: Array.isArray(info.warningCodes) ? info.warningCodes.length : null,
    missingCount: Array.isArray(info.missing) ? info.missing.length : null,
  });
} catch (e) {
  report('WORKER_UNKNOWN', { errorType: e instanceof Error ? e.name : 'unknown' });
}
try {
  const response = await get(worker + 'debug', 'application/json');
  const info = (await response.json())?.data ?? {};
  report('WORKER_DATA', {
    d1Reachable: info.storage?.reachable === true,
    schemaReady: info.storage?.schemaReady === true,
    tickStatus: typeof info.tick === 'string' ? info.tick : 'unknown',
    pendingTasks: Number.isSafeInteger(info.storage?.pendingTasks) ? info.storage.pendingTasks : null,
    overdueTasks: Number.isSafeInteger(info.storage?.overdueTasks) ? info.storage.overdueTasks : null,
    pushRegistered: info.storage?.pushSubscriptionRegistered === true,
  });
} catch (e) {
  report('WORKER_DATA_UNKNOWN', { errorType: e instanceof Error ? e.name : 'unknown' });
}
try {
  const response = await get(pages + 'amsg-worker.bundle.js?release91=' + Date.now(), 'text/javascript');
  const code = await response.text();
  report('PAGES_WORKER_BUNDLE', {
    candidateVersionPresent: code.includes(expected.worker),
    sizeBytes: Buffer.byteLength(code, 'utf8'),
  });
} catch (e) {
  report('PAGES_WORKER_BUNDLE_UNKNOWN', { errorType: e instanceof Error ? e.name : 'unknown' });
}
// A mismatch is a release-status fact, NOT a reason to try unsafe deployment.
if (!pagesMatched || !workerMatched) report('NEEDS_DEPLOYMENT_VERIFICATION', { pagesMatched, workerMatched });
