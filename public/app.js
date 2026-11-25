const $ = (selector) => document.querySelector(selector);
let csrf = '',
  user = null,
  runs = [],
  current = null,
  pendingRequest = null,
  epoch = 0,
  refreshingEpoch = null,
  selectionGeneration = 0;
const returnFocus = new WeakMap();
function node(tag, text, cls) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = String(text);
  if (cls) element.className = cls;
  return element;
}
function setError(id, error, form) {
  if (error?.stale) return;
  const message = error?.message ?? String(error ?? '');
  $('#' + id).textContent = message;
  if (form)
    for (const field of form.querySelectorAll('input,textarea')) {
      const invalid =
        message &&
        (error?.field === field.name ||
          error?.status === 422 ||
          (error?.status === 401 && form.id === 'login-form'));
      if (invalid) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
}
function notice(error) {
  if (error?.stale) return;
  $('#notice').textContent = error?.message ?? String(error ?? '');
}
async function api(path, body, headers = {}) {
  const requestEpoch = epoch;
  let response;
  try {
    response = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    if (requestEpoch !== epoch)
      throw Object.assign(Error('Discarded an earlier session response'), { stale: true });
    throw Error('Connection lost. Your input is still here. Try again.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    if (requestEpoch !== epoch)
      throw Object.assign(Error('Discarded an earlier session response'), { stale: true });
    throw Error('The server returned an unreadable response. Try refreshing.');
  }
  if (requestEpoch !== epoch)
    throw Object.assign(Error('Discarded an earlier session response'), { stale: true });
  if (!response.ok) {
    if (response.status === 401 && user) {
      showLogin();
      setError('login-error', Error('Your session ended. Sign in again.'));
    }
    const error = Error(data.error ?? 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}
function showLogin() {
  epoch++;
  selectionGeneration++;
  user = null;
  csrf = '';
  runs = [];
  current = null;
  pendingRequest = null;
  refreshingEpoch = null;
  for (const id of ['stat-total', 'stat-ready', 'stat-blocked', 'stat-approved'])
    $('#' + id).textContent = '0';
  for (const form of document.querySelectorAll('form')) form.reset();
  $('#workspace').hidden = true;
  $('#workspace-nav').hidden = true;
  $('#login').hidden = false;
  $('#account').hidden = true;
  document.body.classList.remove('signed-in');
  for (const dialog of document.querySelectorAll('dialog')) dialog.close();
  for (const id of ['runs', 'audit', 'members', 'issues', 'detail-body'])
    $('#' + id).replaceChildren();
  $('#login-form input[name=username]').focus({ preventScroll: true });
}
function badge(text, cls = '') {
  return node('span', text, 'badge ' + cls);
}
function busy(form, active, statusId, message = 'Working…') {
  form.setAttribute('aria-busy', String(active));
  for (const button of form.querySelectorAll('button')) {
    button.disabled =
      active || (user?.role === 'viewer' && ['generate-form', 'import-form'].includes(form.id));
    button.setAttribute('aria-busy', String(active));
  }
  if (statusId) $('#' + statusId).textContent = active ? message : '';
}
function openDialog(dialog, trigger = document.activeElement) {
  dialog.dataset.generation = String(Number(dialog.dataset.generation ?? 0) + 1);
  if (!dialog.open) {
    returnFocus.set(dialog, trigger);
    dialog.showModal();
  }
  const focus =
    dialog.id === 'detail' ? $('#detail-title') : dialog.querySelector('input,textarea,button');
  if (focus) {
    if (dialog.id === 'detail') focus.tabIndex = -1;
    focus.focus({ preventScroll: true });
  }
}
for (const dialog of document.querySelectorAll('dialog'))
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    dialog.dataset.generation = String(Number(dialog.dataset.generation ?? 0) + 1);
    if (dialog.id === 'detail') {
      selectionGeneration++;
      current = null;
    }
    const trigger = returnFocus.get(dialog);
    let restore = trigger?.isConnected && !trigger.disabled ? trigger : null;
    if (!restore && trigger?.dataset.runId)
      restore = [...document.querySelectorAll('button[data-run-id]')].find(
        (button) => button.dataset.runId === trigger.dataset.runId,
      );
    if (!restore && trigger?.dataset.memberId)
      restore = [...document.querySelectorAll('button[data-member-id]')].find(
        (button) => button.dataset.memberId === trigger.dataset.memberId,
      );
    restore ??= dialog.id === 'disable-dialog' ? $('#team>summary') : $('#refresh');
    if (restore && user) restore.focus({ preventScroll: true });
  });
async function enter(session) {
  epoch++;
  csrf = session.csrf;
  user = session.user;
  $('#login').hidden = true;
  $('#workspace').hidden = false;
  $('#workspace-nav').hidden = false;
  $('#account').hidden = false;
  document.body.classList.add('signed-in');
  $('#identity').textContent = user.username + ' / ' + user.role;
  $('#team').hidden = $('#team-nav').hidden = user.role !== 'admin';
  $('#permission-note').hidden = user.role !== 'viewer';
  for (const id of ['generate-submit', 'import-submit']) {
    $('#' + id).disabled = user.role === 'viewer';
    if (user.role === 'viewer') $('#' + id).setAttribute('aria-describedby', 'permission-note');
    else $('#' + id).removeAttribute('aria-describedby');
  }
  await refresh();
}
async function refresh() {
  if (!user || refreshingEpoch === epoch) return;
  const start = epoch,
    admin = user.role === 'admin';
  refreshingEpoch = start;
  $('#refresh').disabled = true;
  $('#workspace').setAttribute('aria-busy', 'true');
  try {
    const [list, summary, audit, users] = await Promise.all([
      api('runs'),
      api('summary'),
      api('audit'),
      admin ? api('users') : Promise.resolve([]),
    ]);
    if (epoch !== start) return;
    runs = list;
    for (const [key, id] of Object.entries({
      total: 'stat-total',
      ready: 'stat-ready',
      blocked: 'stat-blocked',
      approved: 'stat-approved',
    }))
      $('#' + id).textContent = summary[key];
    renderRuns();
    $('#audit').replaceChildren(
      ...audit.map((row) =>
        node(
          'p',
          new Date(row.at).toLocaleString() +
            ' · ' +
            row.actor +
            ' · ' +
            row.action.replaceAll('_', ' ') +
            ' · ' +
            row.entity,
        ),
      ),
    );
    if (!audit.length) $('#audit').append(node('p', 'No audit events yet.'));
    const memberFocus = document.activeElement;
    $('#members').replaceChildren(
      ...users.map((member) => {
        const row = node('p'),
          text = node(
            'span',
            member.username + ' / ' + member.role + ' / ' + (member.active ? 'active' : 'disabled'),
          );
        row.append(text);
        if (member.active) {
          const button = node('button', 'Disable');
          button.dataset.memberId = member.id;
          button.setAttribute('aria-label', 'Disable ' + member.username);
          button.title = 'Disable ' + member.username;
          button.onclick = () => {
            const dialog = $('#disable-dialog');
            dialog.dataset.userId = member.id;
            $('#disable-description').textContent =
              'Revoke access for ' + member.username + '. All of their active sessions will end.';
            $('#disable-form').reset();
            busy($('#disable-form'), false);
            setError('disable-error', '', $('#disable-form'));
            openDialog(dialog, button);
          };
          row.append(button);
        }
        return row;
      }),
    );
    if (memberFocus?.dataset.memberId && !memberFocus.isConnected) {
      const replacement = [...document.querySelectorAll('[data-member-id]')].find(
        (button) => button.dataset.memberId === memberFocus.dataset.memberId,
      );
      (replacement ?? $('#team>summary')).focus({ preventScroll: true });
    }
    notice('');
  } catch (error) {
    if (epoch === start) notice(error);
  } finally {
    if (refreshingEpoch === start) refreshingEpoch = null;
    if (epoch === start) {
      $('#refresh').disabled = false;
      $('#workspace').setAttribute('aria-busy', 'false');
    }
  }
}
function renderRuns() {
  const query = $('#search').value.toLowerCase(),
    filtered = runs.filter((row) =>
      (
        row.label +
        ' ' +
        row.actor +
        ' ' +
        row.verdict +
        ' ' +
        (row.approved ? 'approved' : 'pending')
      )
        .toLowerCase()
        .includes(query),
    );
  $('#runs').replaceChildren(
    ...filtered.map((row) => {
      const tr = node('tr');
      tr.append(node('td', row.label), node('td', new Date(row.created).toLocaleString()));
      const state = node('td');
      state.append(
        badge(
          row.verdict === 'ready'
            ? row.approved
              ? 'Comparison passed'
              : 'Ready for review'
            : 'Blocked',
          row.verdict === 'blocked' ? 'blocked' : '',
        ),
      );
      tr.append(state, node('td', row.approved ? 'Approved' : 'Pending'));
      const cell = node('td'),
        button = node('button', 'Open');
      button.setAttribute('aria-label', 'Open ' + row.label);
      button.dataset.runId = row.id;
      button.onclick = () => openRun(row.id, button).catch(notice);
      cell.append(button);
      tr.append(cell);
      return tr;
    }),
  );
  $('#empty').hidden = filtered.length !== 0;
  $('#record-count').textContent =
    'Showing ' + filtered.length + ' of ' + runs.length + ' recent rehearsals';
  $('#empty').textContent = runs.length
    ? 'No rehearsals match your search.'
    : 'No rehearsals yet. Generate a cohort to begin.';
}
async function openRun(id, trigger = document.activeElement) {
  const generation = ++selectionGeneration;
  const start = epoch,
    run = await api('runs/' + id);
  if (epoch !== start || generation !== selectionGeneration || !user) return;
  current = run;
  const report = run.report;
  $('#detail-title').textContent = run.label;
  const body = $('#detail-body');
  body.replaceChildren();
  body.append(
    badge(
      run.review ? 'Approved' : report.verdict === 'ready' ? 'Ready for review' : 'Blocked',
      run.review ? 'approved' : report.verdict === 'blocked' ? 'blocked' : '',
    ),
  );
  body.append(
    node(
      'p',
      report.summary.sourceRecords +
        ' source records · ' +
        report.summary.targetRecords +
        ' target records · ' +
        report.summary.comparedRecords +
        ' compared · ' +
        report.summary.blockingIssues +
        ' blocking issues',
      'report-summary',
    ),
  );
  body.append(
    node(
      'p',
      report.summary.matchedRecords +
        ' records match all supported fields.' +
        (report.summary.issuesTruncated
          ? ' Issue details are capped at 2,000. Fix and rerun to inspect the remaining differences.'
          : ''),
    ),
  );
  body.append(
    node(
      'p',
      'Scope: jobs, candidates, applications and assessments. Attachments, notes, consent and custom fields are outside this contract.',
      'muted',
    ),
  );
  const evidence = node('details', null, 'provenance');
  evidence.append(
    node('summary', 'Evidence hashes'),
    node('code', 'Bundle SHA-256: ' + report.evidence.bundleHash),
    node('code', 'Report SHA-256: ' + run.reportHash),
  );
  body.append(evidence);
  if (run.review)
    body.append(
      node('p', 'Reviewed by ' + run.review.actor + ': ' + run.review.reason, 'review-receipt'),
    );
  for (const kind of ['report', 'bundle', 'csv'])
    $('#download-' + kind).href = '/api/runs/' + id + '/' + kind;
  $('#review-form').hidden = report.verdict !== 'ready' || !!run.review || user.role !== 'admin';
  $('#review-form').reset();
  busy($('#review-form'), false);
  setError('review-error', '', $('#review-form'));
  $('#issue-search').value = '';
  renderIssues();
  openDialog($('#detail'), trigger);
}
function renderIssues() {
  if (!current) return;
  const query = $('#issue-search').value.toLowerCase(),
    rows = current.report.issues.filter((issue) =>
      Object.values(issue).some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(query),
      ),
    );
  $('#issues').replaceChildren(
    ...rows.map((issue) => {
      const row = node('tr');
      for (const value of [
        issue.code,
        issue.kind,
        issue.sourceId ?? issue.targetId ?? 'Scope',
        issue.field,
        issue.expected,
        issue.actual,
      ])
        row.append(node('td', value ?? 'null'));
      return row;
    }),
  );
  $('#no-issues').hidden = rows.length !== 0;
  $('#no-issues').textContent = current.report.issues.length
    ? 'No issues match this filter.'
    : 'No blocking differences in this report.';
}
async function submitRun(label, bundle, trigger) {
  const payload = JSON.stringify({ label, bundle });
  if (pendingRequest?.payload !== payload) pendingRequest = { key: crypto.randomUUID(), payload };
  const result = await api('runs', { label, bundle }, { 'idempotency-key': pendingRequest.key });
  pendingRequest = null;
  await refresh();
  await openRun(result.run.id, trigger);
}
$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  epoch++;
  const form = event.currentTarget;
  busy(form, true);
  setError('login-error', '', form);
  try {
    await enter(await api('login', Object.fromEntries(new FormData(form))));
    form.reset();
  } catch (error) {
    setError('login-error', error, form);
  } finally {
    busy(form, false);
  }
};
$('#logout').onclick = async () => {
  try {
    await api('logout', {});
    showLogin();
  } catch (error) {
    notice(error);
  }
};
$('#generate-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    trigger = event.submitter;
  setError('generate-error', '', form);
  busy(form, true, 'generate-status', 'Comparing the generated cohort…');
  try {
    const values = Object.fromEntries(new FormData(form)),
      bundle = await api('synthetic', { count: Number(values.count), scenario: values.scenario });
    await submitRun(values.label, bundle, trigger);
  } catch (error) {
    setError('generate-error', error, form);
    notice(error);
  } finally {
    busy(form, false, 'generate-status');
  }
};
$('#import-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    trigger = event.submitter;
  setError('import-error', '', form);
  busy(form, true, 'import-status', 'Validating and comparing your bundle…');
  try {
    const values = new FormData(form),
      file = values.get('file');
    if (!file || file.size > 8388608 || !file.name.toLowerCase().endsWith('.json'))
      throw Object.assign(Error('Choose a JSON bundle of at most 8 MB'), { field: 'file' });
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw Object.assign(
        Error('The file is not valid UTF-8. Export it as UTF-8 JSON and try again.'),
        { field: 'file' },
      );
    }
    let bundle;
    try {
      bundle = JSON.parse(text);
    } catch {
      throw Object.assign(Error('The file is not valid JSON'), { field: 'file' });
    }
    await submitRun(values.get('label'), bundle, trigger);
  } catch (error) {
    setError('import-error', error, form);
    notice(error);
  } finally {
    busy(form, false, 'import-status');
  }
};
$('#review-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const target = {
    id: current.id,
    reportHash: current.reportHash,
    generation: selectionGeneration,
    epoch,
  };
  busy(form, true);
  setError('review-error', '', form);
  try {
    await api('runs/' + target.id + '/approve', {
      reportHash: target.reportHash,
      reason: new FormData(form).get('reason'),
    });
    await refresh();
    if (selectionGeneration === target.generation && $('#detail').open) await openRun(target.id);
  } catch (error) {
    if (epoch === target.epoch && selectionGeneration === target.generation)
      setError('review-error', error, form);
  } finally {
    if (epoch === target.epoch && selectionGeneration === target.generation) busy(form, false);
  }
};
$('#issue-search').oninput = renderIssues;
$('#search').oninput = renderRuns;
$('#refresh').onclick = refresh;
$('#close-report').onclick = () => $('#detail').close();
$('#team-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  busy(form, true);
  setError('team-error', '', form);
  $('#team-status').textContent = '';
  try {
    const input = Object.fromEntries(new FormData(form));
    await api('users', input);
    form.reset();
    await refresh();
    $('#team-status').textContent = 'Added ' + input.username + ' with ' + input.role + ' access.';
  } catch (error) {
    setError('team-error', error, form);
  } finally {
    busy(form, false);
  }
};
$('#disable-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const target = {
    id: $('#disable-dialog').dataset.userId,
    generation: $('#disable-dialog').dataset.generation,
    epoch,
  };
  busy(form, true);
  setError('disable-error', '', form);
  try {
    await api('users/' + target.id + '/disable', {
      reason: new FormData(form).get('reason'),
    });
    if (epoch === target.epoch && $('#disable-dialog').dataset.generation === target.generation)
      $('#disable-dialog').close();
    await refresh();
  } catch (error) {
    if (epoch === target.epoch && $('#disable-dialog').dataset.generation === target.generation)
      setError('disable-error', error, form);
  } finally {
    if (epoch === target.epoch && $('#disable-dialog').dataset.generation === target.generation)
      busy(form, false);
  }
};
$('#disable-close').onclick = () => $('#disable-dialog').close();
$('#password-open').onclick = (event) => {
  $('#password-form').reset();
  setError('password-error', '', $('#password-form'));
  openDialog($('#password-dialog'), event.currentTarget);
};
$('#password-close').onclick = () => $('#password-dialog').close();
$('#password-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  busy(form, true);
  setError('password-error', '', form);
  try {
    await api('password', Object.fromEntries(new FormData(form)));
    form.reset();
    showLogin();
    setError('login-error', Error('Password changed. Sign in again.'));
  } catch (error) {
    setError('password-error', error, form);
  } finally {
    busy(form, false);
  }
};
for (const link of document.querySelectorAll('[data-section]'))
  link.onclick = () => {
    for (const item of document.querySelectorAll('[data-section]')) {
      item.classList.toggle('current', item === link);
      if (item === link) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    }
    const target = $('#' + link.dataset.section);
    if (target.tagName === 'DETAILS') target.open = true;
  };
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape') {
      const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (dialog) {
        event.preventDefault();
        dialog.close();
      }
    }
  },
  true,
);
api('me')
  .then(enter)
  .catch((error) => {
    if (error.stale || error.status === 401) return;
    showLogin();
    if (error.status !== 401) setError('login-error', error);
  });
