import { createHash } from 'node:crypto';
export const VERSION = '1.0.0';
export const KINDS = ['jobs', 'candidates', 'applications', 'assessments'];
export const FIELDS = {
  jobs: ['id', 'title', 'status'],
  candidates: ['id', 'name', 'email'],
  applications: ['id', 'candidateId', 'jobId', 'stage', 'status'],
  assessments: ['id', 'applicationId', 'testId', 'status', 'score', 'maxScore'],
};
const RELATIONS = { candidateId: 'candidates', jobId: 'jobs', applicationId: 'applications' };
const STATES = {
  jobs: ['open', 'closed', 'draft'],
  applications: ['active', 'hired', 'rejected'],
  assessments: ['invited', 'in_progress', 'reports_pending', 'completed'],
};
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const identifier = (v) => typeof v === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(v);
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.status = 422;
  }
}
export function boundedJSON(value) {
  const stack = [[value, 0]];
  let nodes = 0,
    bytes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++nodes > 200000 || depth > 8) throw new InputError('Input is too large or deeply nested');
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new InputError('Only finite JSON numbers are supported');
      continue;
    }
    if (typeof v === 'string') {
      bytes += Buffer.byteLength(v);
      if (bytes > 8388608) throw new InputError('Input exceeds 8 MB');
      continue;
    }
    if (typeof v !== 'object') throw new InputError('Only JSON data is supported');
    for (const [key, child] of Object.entries(v)) {
      if (key.length > 128 || /[\u0000-\u001f]/.test(key))
        throw new InputError('Invalid object key');
      stack.push([child, depth + 1]);
    }
  }
}
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
      .join(',') +
    '}'
  );
}
export const digest = (v) => createHash('sha256').update(canonical(v)).digest('hex');

export function reconcile(bundle) {
  if (!object(bundle)) throw new InputError('A rehearsal bundle object is required');
  boundedJSON(bundle);
  const issues = [],
    counts = { source: {}, target: {} },
    indexes = { source: {}, target: {} },
    maps = {},
    invalid = new Set();
  let totalIssues = 0,
    comparedRecords = 0,
    matchedRecords = 0;
  const short = (v) =>
    v === undefined
      ? null
      : typeof v === 'string'
        ? v.slice(0, 240)
        : v !== null && typeof v === 'object'
          ? '[unsupported value]'
          : v;
  const add = (code, side, kind, id, field, expected, actual, targetId = null) => {
    totalIssues++;
    if (issues.length < 2000)
      issues.push({
        code,
        severity: 'blocking',
        side,
        kind,
        sourceId: side === 'target' ? null : short(id),
        targetId: side === 'target' ? short(id) : short(targetId),
        field,
        expected: short(expected),
        actual: short(actual),
      });
    if (['source', 'target'].includes(side) && id != null)
      invalid.add(side + '|' + kind + '|' + id);
  };
  if (bundle.schemaVersion !== 1)
    add('SCHEMA_VERSION', 'bundle', 'snapshot', null, 'schemaVersion', 1, bundle.schemaVersion);
  for (const key of Object.keys(bundle))
    if (!['schemaVersion', 'source', 'target', 'mapping', 'rules'].includes(key))
      add('UNSUPPORTED_FIELD', 'bundle', 'snapshot', null, key, 'supported field', key);
  const rules = {
    stageMap: {},
    trimDisplayText: false,
    ...(object(bundle.rules) ? bundle.rules : {}),
  };
  if (bundle.rules !== undefined && !object(bundle.rules))
    add('INVALID_POLICY', 'rules', 'snapshot', null, 'rules', 'object', bundle.rules);
  for (const key of Object.keys(rules))
    if (!['stageMap', 'trimDisplayText'].includes(key))
      add('INVALID_POLICY', 'rules', 'snapshot', null, key, 'supported policy', key);
  if (typeof rules.trimDisplayText !== 'boolean')
    add(
      'INVALID_POLICY',
      'rules',
      'snapshot',
      null,
      'trimDisplayText',
      'boolean',
      rules.trimDisplayText,
    );
  if (!object(rules.stageMap)) {
    add('INVALID_POLICY', 'rules', 'snapshot', null, 'stageMap', 'object', rules.stageMap);
    rules.stageMap = {};
  }
  for (const [from, to] of Object.entries(rules.stageMap))
    if (
      !from ||
      from.length > 100 ||
      typeof to !== 'string' ||
      !to.trim() ||
      to.length > 100 ||
      /[\u0000-\u001f]/.test(from + to)
    )
      add('INVALID_POLICY', 'rules', 'snapshot', null, 'stageMap', 'nonempty stage labels', to);
  for (const side of ['source', 'target']) {
    const snap = object(bundle[side]) ? bundle[side] : {};
    if (snap.schemaVersion !== 1)
      add('SCHEMA_VERSION', side, 'snapshot', null, 'schemaVersion', 1, snap.schemaVersion);
    if (snap.synthetic !== true)
      add('SYNTHETIC_ONLY', side, 'snapshot', null, 'synthetic', true, snap.synthetic);
    for (const key of Object.keys(snap))
      if (!['schemaVersion', 'synthetic', 'expectedCounts', ...KINDS].includes(key))
        add('UNSUPPORTED_FIELD', side, 'snapshot', null, key, 'canonical field', key);
    if (!object(snap.expectedCounts))
      add('MISSING_MANIFEST', side, 'snapshot', null, 'expectedCounts', 'independent counts', null);
    for (const key of Object.keys(snap.expectedCounts ?? {}))
      if (!KINDS.includes(key))
        add('UNSUPPORTED_SCOPE', side, 'snapshot', null, key, 'supported entity count', key);
    for (const kind of KINDS) {
      const rows = Array.isArray(snap[kind]) ? snap[kind] : [];
      counts[side][kind] = rows.length;
      indexes[side][kind] = new Map();
      if (!Array.isArray(snap[kind]))
        add('MISSING_ARRAY', side, kind, null, 'records', 'array', null);
      if (rows.length > 20000) throw new InputError('Entity arrays cannot exceed 20,000 records');
      if (
        !Number.isInteger(snap.expectedCounts?.[kind]) ||
        snap.expectedCounts[kind] < 0 ||
        snap.expectedCounts[kind] !== rows.length
      )
        add(
          'COUNT_MISMATCH',
          side,
          kind,
          null,
          'expectedCounts',
          snap.expectedCounts?.[kind],
          rows.length,
        );
      if (side === 'source' && kind !== 'assessments' && !rows.length)
        add('EMPTY_SCOPE', side, kind, null, 'records', 'nonempty scope', 0);
      const seen = new Set();
      for (const row of rows) {
        if (!object(row)) {
          add('INVALID_RECORD', side, kind, null, 'record', 'object', row);
          continue;
        }
        const id = row.id;
        if (!identifier(id)) {
          add('INVALID_ID', side, kind, null, 'id', 'identifier', id);
          continue;
        }
        if (seen.has(id)) {
          add('DUPLICATE_ID', side, kind, id, 'id', 'unique identity', id);
          indexes[side][kind].delete(id);
          continue;
        }
        seen.add(id);
        for (const field of Object.keys(row))
          if (!FIELDS[kind].includes(field))
            add('UNSUPPORTED_FIELD', side, kind, id, field, 'canonical field', field);
        for (const field of FIELDS[kind]) {
          if (!Object.hasOwn(row, field)) {
            add('MISSING_FIELD', side, kind, id, field, 'required field', null);
            continue;
          }
          const v = row[field];
          if (['score', 'maxScore'].includes(field)) continue;
          if (field === 'id' || field === 'testId' || Object.hasOwn(RELATIONS, field)) {
            if (!identifier(v)) add('INVALID_FIELD', side, kind, id, field, 'identifier', v);
          } else if (
            typeof v !== 'string' ||
            !v.trim() ||
            v.length > (field === 'email' ? 254 : 160) ||
            /[\u0000-\u001f]/.test(v)
          )
            add('INVALID_FIELD', side, kind, id, field, 'bounded text', v);
        }
        if (STATES[kind] && !STATES[kind].includes(row.status))
          add('INVALID_STATUS', side, kind, id, 'status', 'supported status', row.status);
        if (
          kind === 'candidates' &&
          (typeof row.email !== 'string' || !/^[^\s@]+@example\.test$/i.test(row.email))
        )
          add(
            'SYNTHETIC_EMAIL',
            side,
            kind,
            id,
            'email',
            'synthetic @example.test address',
            row.email,
          );
        if (kind === 'assessments') {
          if (row.status === 'completed') {
            if (
              !Number.isFinite(row.score) ||
              !Number.isFinite(row.maxScore) ||
              row.maxScore <= 0 ||
              row.score < 0 ||
              row.score > row.maxScore
            )
              add(
                'INVALID_SCORE',
                side,
                kind,
                id,
                'score',
                'valid score within positive maximum',
                row.score,
              );
          } else if (row.score !== null || row.maxScore !== null)
            add('INVALID_SCORE', side, kind, id, 'score', 'null until completed', row.score);
        }
        if (!invalid.has(side + '|' + kind + '|' + id)) indexes[side][kind].set(id, row);
      }
    }
    for (const kind of KINDS)
      for (const row of indexes[side][kind].values())
        for (const [field, related] of Object.entries(RELATIONS))
          if (Object.hasOwn(row, field) && !indexes[side][related].has(row[field]))
            add('ORPHAN_REFERENCE', side, kind, row.id, field, 'existing ' + related, row[field]);
  }
  const mapping = object(bundle.mapping) ? bundle.mapping : {};
  for (const key of Object.keys(mapping))
    if (!KINDS.includes(key))
      add('UNSUPPORTED_MAPPING', 'mapping', 'snapshot', null, key, 'known kind', key);
  for (const kind of KINDS) {
    maps[kind] = new Map();
    const sources = new Set(),
      targets = new Set(),
      pairs = Array.isArray(mapping[kind]) ? mapping[kind] : [];
    if (!Array.isArray(mapping[kind]))
      add('MISSING_MAPPING', 'mapping', kind, null, 'mapping', 'explicit array', null);
    if (pairs.length > 20000) throw new InputError('Mapping arrays cannot exceed 20,000 pairs');
    for (const pair of pairs) {
      if (
        !object(pair) ||
        !identifier(pair.sourceId) ||
        !identifier(pair.targetId) ||
        Object.keys(pair).some((k) => !['sourceId', 'targetId'].includes(k))
      ) {
        add('INVALID_MAPPING', 'mapping', kind, null, 'mapping', 'sourceId and targetId', null);
        continue;
      }
      if (sources.has(pair.sourceId)) {
        add(
          'DUPLICATE_MAPPING',
          'mapping',
          kind,
          pair.sourceId,
          'sourceId',
          'one mapping',
          pair.sourceId,
        );
        continue;
      }
      if (targets.has(pair.targetId)) {
        add(
          'MAPPING_COLLISION',
          'mapping',
          kind,
          pair.sourceId,
          'targetId',
          'one-to-one mapping',
          pair.targetId,
        );
        continue;
      }
      sources.add(pair.sourceId);
      targets.add(pair.targetId);
      if (!indexes.source[kind].has(pair.sourceId) || !indexes.target[kind].has(pair.targetId)) {
        add(
          'DANGLING_MAPPING',
          'mapping',
          kind,
          pair.sourceId,
          'targetId',
          'existing source and target',
          pair.targetId,
        );
        continue;
      }
      maps[kind].set(pair.sourceId, pair.targetId);
    }
    for (const id of indexes.target[kind].keys())
      if (!targets.has(id))
        add('EXTRA_TARGET', 'target', kind, id, 'record', 'mapped cohort record', id);
  }
  for (const kind of KINDS)
    for (const source of indexes.source[kind].values()) {
      const targetId = maps[kind].get(source.id),
        target = indexes.target[kind].get(targetId);
      if (!target) {
        add('MISSING_TARGET', 'mapping', kind, source.id, 'record', 'mapped target', targetId);
        continue;
      }
      if (
        invalid.has('source|' + kind + '|' + source.id) ||
        invalid.has('target|' + kind + '|' + targetId)
      )
        continue;
      comparedRecords++;
      const before = totalIssues;
      for (const field of FIELDS[kind]) {
        if (field === 'id') continue;
        let expected = source[field],
          actual = target[field];
        if (Object.hasOwn(RELATIONS, field)) expected = maps[RELATIONS[field]].get(expected);
        if (field === 'stage' && Object.hasOwn(rules.stageMap, expected))
          expected = rules.stageMap[expected];
        if (rules.trimDisplayText === true && ['name', 'title'].includes(field)) {
          expected = expected.trim();
          actual = actual.trim();
        }
        if (expected !== actual)
          add('FIELD_MISMATCH', 'comparison', kind, source.id, field, expected, actual, targetId);
      }
      if (totalIssues === before) matchedRecords++;
    }
  issues.sort((a, b) =>
    [a.kind, a.sourceId ?? '', a.targetId ?? '', a.field, a.code, a.side]
      .join('|')
      .localeCompare(
        [b.kind, b.sourceId ?? '', b.targetId ?? '', b.field, b.code, b.side].join('|'),
        'en',
      ),
  );
  const sourceRecords = Object.values(counts.source).reduce((a, b) => a + b, 0),
    targetRecords = Object.values(counts.target).reduce((a, b) => a + b, 0);
  return {
    algorithmVersion: VERSION,
    verdict:
      totalIssues === 0 && sourceRecords > 0 && comparedRecords === sourceRecords
        ? 'ready'
        : 'blocked',
    summary: {
      sourceRecords,
      targetRecords,
      comparedRecords,
      matchedRecords,
      blockingIssues: totalIssues,
      issuesTruncated: totalIssues > issues.length,
      counts,
    },
    issues,
    evidence: {
      bundleHash: digest(bundle),
      sourceHash: digest(bundle.source ?? null),
      targetHash: digest(bundle.target ?? null),
      mappingHash: digest(bundle.mapping ?? {}),
      rulesHash: digest(rules),
    },
  };
}
