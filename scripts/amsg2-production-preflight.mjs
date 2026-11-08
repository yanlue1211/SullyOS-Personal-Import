/**
 * Read-only public preflight for the known personal production Worker.
 * Exactly two unauthenticated GETs: /config-check and /debug; no secret values or paid models.
 * An inaccessible endpoint is reported as UNKNOWN, never as a successful live deployment.
 * This script is intentionally informational and non-blocking for PR CI.
 */
const WORKER_CONFIG_CHECK = 'https://sullyos-amsg.yanlue.workers.dev/config-check';
const EXPECTED_VERSION = '2026-11-08.10';

const report = (message, data = {}) => {
  console.log('[amsg2:production-readonly] ' + JSON.stringify({ message, ...data }));
};

try {
  const response = await fetch(WORKER_CONFIG_CHECK, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    report('UNKNOWN: Worker config-check HTTP error; no live-version conclusion', { httpStatus: response.status });
  } else {
    const body = await response.json();
    if (body?.success !== true || !body?.data || typeof body.data !== 'object') {
      report('UNKNOWN: unexpected config-check response; no live-version conclusion');
    } else {
      const data = body.data;
      const version = typeof data.workerVersion === 'string' ? data.workerVersion : null;
      const missing = Array.isArray(data.missing) ? data.missing.filter(x => typeof x === 'string') : [];
      const warningCodes = Array.isArray(data.warnings)
        ? data.warnings.map(x => x?.code).filter(x => typeof x === 'string') : [];
      report(version === EXPECTED_VERSION
        ? 'VERSION_MATCHES: public Worker reports expected code; production delivery still unverified'
        : 'VERSION_DIFFERENT: production Worker is not yet the candidate version', {
        workerVersion: version,
        expectedVersion: EXPECTED_VERSION,
        configurationOk: data.ok === true,
        missing,
        warningCodes,
        instantTick: data.instantTick === true,
        selfUpdateSupported: data.selfUpdate?.supported === true,
        backgroundJobs: data.backgroundJobs === true,
      });
    }
  }
} catch (error) {
  // Do not print arbitrary response bodies, URLs from redirects, or credential-bearing error text.
  report('UNKNOWN: cannot reach public Worker from GitHub runner; do not infer anything about deployment', {
    errorType: error instanceof Error ? error.name : 'unknown',
  });
}

// The existing Worker already exposes a read-only /debug inspection route.
// Perform exactly one additional GET before a production release; only report
// whitelisted health booleans/status/counts. Never dump the raw debug response.
try {
  const response = await fetch('https://sullyos-amsg.yanlue.workers.dev/debug', {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    report('DEBUG_UNKNOWN: Worker debug HTTP error', { httpStatus: response.status });
  } else {
    const body = await response.json();
    if (body?.success !== true || !body.data || typeof body.data !== 'object') {
      report('DEBUG_UNKNOWN: unexpected Worker debug response');
    } else {
      const { config, storage, tick, schema } = body.data;
      const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      report('DEBUG_READONLY: existing production Worker and D1 status (no secret values)', {
        configurationOk: config?.ok === true,
        d1Reachable: storage?.reachable === true,
        schemaReady: storage?.schemaReady === true ? true : storage?.schemaReady === false ? false : null,
        schemaProbePresent: schema !== null && schema !== undefined,
        tickStatus: ['idle', 'healthy', 'failing', 'stalled', 'unknown'].includes(tick) ? tick : 'unknown',
        pendingTaskCount: safeCount(storage?.pendingTasks),
        overdueTaskCount: safeCount(storage?.overdueTasks),
        registeredPush: storage?.pushSubscriptionRegistered === true,
        pushDeliveryStatus: storage?.pushDelivery && typeof storage.pushDelivery === 'object'
          ? 'available' : 'unknown',
      });
    }
  }
} catch (error) {
  report('DEBUG_UNKNOWN: cannot inspect public production Worker debug from CI', {
    errorType: error instanceof Error ? error.name : 'unknown',
  });
}


// Live Pages is a separate deployment from the source branch and from the Worker.
// Do not infer a successful Pages deployment merely because GitHub merge succeeded.
// Vite inserts __BUILD_COMMIT__/__BUILD_BRANCH__ directly in the HTML (not the JS).
const PAGES_URL = 'https://yanlue1211.github.io/SullyOS-Personal-Import/';
const EXPECTED_PAGES_COMMIT = '6c4343d'; // PR #80 merge commit in personal/audio-listening
try {
  const response = await fetch(PAGES_URL + '?amsg2-readonly=' + Date.now(), {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) {
    report('PAGES_UNKNOWN: production HTML HTTP error', { httpStatus: response.status });
  } else {
    const html = await response.text();
    const publishedCommit = html.match(/["']__BUILD_COMMIT__["']\s*:\s*["']([0-9a-f]{7,40})["']/)?.[1] ?? null;
    const publishedBranch = html.match(/["']__BUILD_BRANCH__["']\s*:\s*["']([^"']+)["']/)?.[1] ?? null;
    report(publishedCommit === EXPECTED_PAGES_COMMIT && publishedBranch === 'personal/audio-listening'
      ? 'PAGES_MATCHES: public HTML reports the merged PR #80 build'
      : 'PAGES_NOT_CONFIRMED: public HTML does not report the required merged build', {
      httpStatus: response.status,
      publishedCommit,
      publishedBranch,
      expectedCommit: EXPECTED_PAGES_COMMIT,
    });
  }
} catch (error) {
  report('PAGES_UNKNOWN: cannot reach the live site from CI', {
    errorType: error instanceof Error ? error.name : 'unknown',
  });
}

// An unchanged old HTML may still exist in a client's Service Worker cache,
// so check the public Worker bundle independently as a second Pages artifact.
// This fetch does NOT install/run the Worker; it only scans a public .js text file.
try {
  const response = await fetch(PAGES_URL + 'amsg-worker.bundle.js?amsg2-readonly=' + Date.now(), {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { Accept: 'application/javascript', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) {
    report('PAGES_BUNDLE_UNKNOWN: public Worker bundle HTTP error', { httpStatus: response.status });
  } else {
    const bundle = await response.text();
    const candidatePresent = bundle.includes('2026-11-08.10');
    const oldPresent = bundle.includes('2026-11-08.3');
    report(candidatePresent ? 'PAGES_BUNDLE_MATCHES: new Worker bundle is publicly served'
      : 'PAGES_BUNDLE_NOT_CONFIRMED: new Worker bundle not identified in Pages', {
      httpStatus: response.status,
      candidatePresent,
      oldPresent,
      sizeBytes: Buffer.byteLength(bundle, 'utf8'),
    });
  }
} catch (error) {
  report('PAGES_BUNDLE_UNKNOWN: cannot reach public static Worker asset', {
    errorType: error instanceof Error ? error.name : 'unknown',
  });
}
