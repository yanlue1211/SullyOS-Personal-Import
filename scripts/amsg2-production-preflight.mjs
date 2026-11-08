/**
 * Read-only public preflight for the known personal production Worker.
 * Exactly one unauthenticated GET /config-check; never reads secrets or calls a paid model.
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
