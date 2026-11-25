import { InputError } from './engine.mjs';
export const SCENARIOS = ['clean', 'missing', 'mismatch', 'orphan', 'duplicate'];
export function generate(count = 12, scenario = 'clean') {
  if (!Number.isInteger(count) || count < 1 || count > 3000 || !SCENARIOS.includes(scenario))
    throw new InputError('Choose 1 to 3000 candidates and a supported scenario');
  const source = {
      schemaVersion: 1,
      synthetic: true,
      expectedCounts: { jobs: 3, candidates: count, applications: count, assessments: count },
      jobs: [],
      candidates: [],
      applications: [],
      assessments: [],
    },
    mapping = { jobs: [], candidates: [], applications: [], assessments: [] };
  for (let i = 0; i < 3; i++)
    source.jobs.push({
      id: 'j' + i,
      title: ['Platform engineer', 'Product designer', 'Data engineer'][i],
      status: 'open',
    });
  for (let i = 0; i < count; i++) {
    source.candidates.push({
      id: 'c' + i,
      name: 'Candidate ' + String(i + 1).padStart(4, '0'),
      email: 'candidate' + i + '@example.test',
    });
    source.applications.push({
      id: 'a' + i,
      candidateId: 'c' + i,
      jobId: 'j' + (i % 3),
      stage: 'Technical',
      status: 'active',
    });
    source.assessments.push({
      id: 'r' + i,
      applicationId: 'a' + i,
      testId: 'backend',
      status: 'completed',
      score: 50 + (i % 51),
      maxScore: 100,
    });
  }
  const target = structuredClone(source);
  for (const kind of Object.keys(mapping))
    for (const row of target[kind]) {
      const old = row.id;
      row.id = 'new-' + old;
      mapping[kind].push({ sourceId: old, targetId: row.id });
      for (const field of ['candidateId', 'jobId', 'applicationId'])
        if (Object.hasOwn(row, field)) row[field] = 'new-' + row[field];
      if (kind === 'applications') row.stage = 'Technical interview';
    }
  if (scenario === 'missing') target.candidates.pop();
  if (scenario === 'mismatch') target.assessments[0].score = 49;
  if (scenario === 'orphan') target.applications[0].candidateId = 'new-missing';
  if (scenario === 'duplicate') target.candidates.push(structuredClone(target.candidates[0]));
  return {
    schemaVersion: 1,
    source,
    target,
    mapping,
    rules: { stageMap: { Technical: 'Technical interview' }, trimDisplayText: false },
  };
}
