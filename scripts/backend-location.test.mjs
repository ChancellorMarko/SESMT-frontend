import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { resolveBackendRoot } from './backend-location.mjs';

test('integração exige um repositório backend externo e permite worktree configurada', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sesmt-repository-location-'));
  const frontend = join(fixture, 'SESMT-frontend');
  mkdirSync(frontend);
  function backendAt(path) {
    for (const project of ['SESMT.API', 'SESMT.Infrastructure']) {
      mkdirSync(join(path, project), { recursive: true });
      writeFileSync(join(path, project, `${project}.csproj`), '<Project/>');
    }
    writeFileSync(join(path, '.git'), 'gitdir: external-worktree');
    writeFileSync(join(path, 'SESMT.slnx'), '<Solution/>');
    return realpathSync(path);
  }
  try {
    assert.throws(() => resolveBackendRoot({}, frontend), /Clone o repositório/);
    const official = backendAt(join(fixture, 'SESMT-backend'));
    assert.equal(resolveBackendRoot({}, frontend), official);
    const worktree = backendAt(join(fixture, 'backend-worktree'));
    assert.equal(resolveBackendRoot({ SESMT_BACKEND_PATH: worktree }, frontend), worktree);
    assert.equal(resolveBackendRoot({ SESMT_BACKEND_PATH: '../backend-worktree' }, frontend), worktree);
    const embedded = backendAt(join(frontend, 'SESMT-backend'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: embedded }, frontend), /fora da pasta do frontend/);
    const hiddenEmbedded = backendAt(join(frontend, '..embedded'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: hiddenEmbedded }, frontend), /fora da pasta do frontend/);
    mkdirSync(join(fixture, 'incomplete'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: '../incomplete' }, frontend), /incompleto/);
  } finally {
    // Remove only this test's freshly created temporary directory.
    assert.equal(relative(realpathSync(tmpdir()), realpathSync(fixture)).startsWith('..'), false);
    rmSync(fixture, { recursive: true, force: true });
  }
});
