import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { resolveBackendRoot } from './backend-location.mjs';

test('resolve a API embutida e preserva seleção explícita de repositório externo', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sesmt-repository-location-'));
  const frontend = join(fixture, 'SESMT-frontend');
  mkdirSync(frontend);
  function backendAt(path, git = true) {
    for (const project of ['SESMT.API', 'SESMT.Application', 'SESMT.Domain', 'SESMT.Infrastructure', 'SESMT.Tests']) {
      mkdirSync(join(path, project), { recursive: true });
      writeFileSync(join(path, project, `${project}.csproj`), '<Project/>');
    }
    if (git) writeFileSync(join(path, '.git'), 'gitdir: external-worktree');
    writeFileSync(join(path, 'SESMT.slnx'), '<Solution/>');
    return realpathSync(path);
  }
  try {
    assert.throws(() => resolveBackendRoot({}, frontend), /Confira a pasta backend/);
    const official = backendAt(join(fixture, 'SESMT-backend'));
    assert.equal(resolveBackendRoot({}, frontend), official);
    const worktree = backendAt(join(fixture, 'backend-worktree'));
    assert.equal(resolveBackendRoot({ SESMT_BACKEND_PATH: worktree }, frontend), worktree);
    assert.equal(resolveBackendRoot({ SESMT_BACKEND_PATH: '../backend-worktree' }, frontend), worktree);
    const bundled = backendAt(join(frontend, 'backend'), false);
    assert.equal(resolveBackendRoot({}, frontend), bundled);
    assert.equal(resolveBackendRoot({ SESMT_BACKEND_PATH: 'backend' }, frontend), bundled);
    assert.equal(resolveBackendRoot({ SESMT_BACKEND_PATH: '../backend-worktree' }, frontend), worktree);
    unlinkSync(join(bundled, 'SESMT.Domain/SESMT.Domain.csproj'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: 'backend' }, frontend), /incompleto/);
    const embedded = backendAt(join(frontend, 'SESMT-backend'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: embedded }, frontend), /fora da pasta do frontend/);
    const hiddenEmbedded = backendAt(join(frontend, '..embedded'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: hiddenEmbedded }, frontend), /fora da pasta do frontend/);
    mkdirSync(join(fixture, 'incomplete'));
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: '../incomplete' }, frontend), /incompleto/);
    const noRepository = backendAt(join(fixture, 'no-repository'), false);
    assert.throws(() => resolveBackendRoot({ SESMT_BACKEND_PATH: noRepository }, frontend), /\.git ausente/);
  } finally {
    // Remove only this test's freshly created temporary directory.
    assert.equal(relative(realpathSync(tmpdir()), realpathSync(fixture)).startsWith('..'), false);
    rmSync(fixture, { recursive: true, force: true });
  }
});
