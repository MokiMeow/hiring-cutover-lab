export function knownBundle() {
  const source = {
    schemaVersion: 1,
    synthetic: true,
    expectedCounts: { jobs: 1, candidates: 2, applications: 2, assessments: 1 },
    jobs: [{ id: 'j1', title: 'Backend engineer', status: 'open' }],
    candidates: [
      { id: 'c1', name: 'Casey Example', email: 'casey@example.test' },
      { id: 'c2', name: 'Morgan Example', email: 'morgan@example.test' },
    ],
    applications: [
      { id: 'a1', candidateId: 'c1', jobId: 'j1', stage: 'Technical', status: 'active' },
      { id: 'a2', candidateId: 'c2', jobId: 'j1', stage: 'Applied', status: 'active' },
    ],
    assessments: [
      {
        id: 'r1',
        applicationId: 'a1',
        testId: 'backend',
        status: 'completed',
        score: 85,
        maxScore: 100,
      },
    ],
  };
  const target = structuredClone(source);
  target.jobs[0].id = 'job-1';
  target.candidates[0].id = 'candidate-1';
  target.candidates[1].id = 'candidate-2';
  target.applications[0] = {
    ...target.applications[0],
    id: 'application-1',
    candidateId: 'candidate-1',
    jobId: 'job-1',
    stage: 'Technical interview',
  };
  target.applications[1] = {
    ...target.applications[1],
    id: 'application-2',
    candidateId: 'candidate-2',
    jobId: 'job-1',
  };
  target.assessments[0] = {
    ...target.assessments[0],
    id: 'report-1',
    applicationId: 'application-1',
  };
  return {
    schemaVersion: 1,
    source,
    target,
    mapping: {
      jobs: [{ sourceId: 'j1', targetId: 'job-1' }],
      candidates: [
        { sourceId: 'c1', targetId: 'candidate-1' },
        { sourceId: 'c2', targetId: 'candidate-2' },
      ],
      applications: [
        { sourceId: 'a1', targetId: 'application-1' },
        { sourceId: 'a2', targetId: 'application-2' },
      ],
      assessments: [{ sourceId: 'r1', targetId: 'report-1' }],
    },
    rules: { stageMap: { Technical: 'Technical interview' }, trimDisplayText: false },
  };
}
