import type { Consultation, ConversationEvent, Delivery, Project, Session } from '../src/contracts.js';
import { Voice } from './voice.js';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => el<HTMLInputElement>(id).value;
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const notice = (s: string) => { el('notice').textContent = s; };
let token = sessionStorage.getItem('innovox.access') ?? '';
let projectId = sessionStorage.getItem('innovox.project') ?? '';
let editing: Project | undefined;
let voiceQuestion: Consultation | undefined;
let state: { projects: Project[]; sessions: Session[]; consultations: Consultation[]; deliveries: Delivery[];
  messages: ConversationEvent[]; analysis: Record<string, { state: string; code?: string }>;
  capabilities: { providerConfigured: boolean } };
const deliveryLabel = (d: Delivery) => d.status === 'queued' && d.contextCurrent === false ? '文脈変更・再確認待ち' : ({ queued: '保存済み・配送待ち', claimed: '配送処理中', accepted: 'Codexが受理・履歴の確認待ち', delivered: '配送確認済み・作業への反映は別確認', unknown: '結果不明・自動再送しません', cancelled: '配送中止' }[d.status]);
const drafts = new Map<string, string>();
const answerIds = new Map<string, string>();
async function request<T>(path: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, { method: data === undefined ? 'GET' : method,
    headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? '操作に失敗しました。');
  return result as T;
}
const voice = new Voice(request, el<HTMLAudioElement>('voice-audio'), s => { el('voice-status').textContent = s; }, delta => {
  const input = el<HTMLTextAreaElement>('voice-draft'); input.value = (input.value + delta).slice(0, 4000);
}, () => {
  voiceQuestion = undefined;
  void refresh().catch(e => notice(e.message));
  notice('音声による確認で回答を保存しました。送信先への反映はまだ未確認です。');
});
function bind(id: string, handler: () => Promise<unknown> | unknown) {
  el(id).addEventListener('click', () => { void Promise.resolve().then(handler).catch(e => notice(String(e.message ?? e))); });
}
async function refresh() {
  if (!token) return;
  state = await request('/api/state' + (projectId ? '?projectId=' + encodeURIComponent(projectId) : ''));
  if (!projectId && state.projects.length) {
    projectId = state.projects[0]!.id; sessionStorage.setItem('innovox.project', projectId); return refresh();
  }
  el('login').hidden = true; el('workspace').hidden = false; el('logout').hidden = false;
  el('provider-status').textContent = state.capabilities.providerConfigured ? 'OpenAI 設定あり・実接続は別途確認' : 'APIキー設定待ち・保存機能は利用可能';
  const projectSelect = el<HTMLSelectElement>('project');
  projectSelect.innerHTML = state.projects.length ? state.projects.map(p => `<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('') : '<option value="">プロジェクトを作成してください</option>';
  projectSelect.value = projectId;
  const p = state.projects.find(p => p.id === projectId);
  el('project-id').textContent = projectId;
  el('condition-list').innerHTML = p?.conditions.map(c => `<div class="condition"><strong>${escape(c.text)}</strong><p>${escape(c.reason)}</p></div>`).join('') ?? '<p class="empty">保持したい前提を登録して始めましょう。</p>';
  el('session-list').innerHTML = state.sessions.map((s, i) => {
    const analysis = state.analysis[JSON.stringify([s.projectId, s.adapter, s.sessionId])];
    return `<div class="session"><strong>${escape(s.adapter)}</strong><p>${escape(s.sessionId)} · epoch ${s.epoch}</p><button data-analyze="${i}" ${state.capabilities.providerConfigured ? '' : 'disabled'}>Astraで前提を確認</button>${analysis ? `<p>${escape(analysis.state)} ${escape(analysis.code ?? '')}</p>` : ''}</div>`;
  }).join('') || '<p class="muted">会話を追加するか、コレクターを接続してください。</p>';
  const pending = state.consultations.filter(q => q.status === 'pending');
  el('question-count').textContent = `${pending.length}件`;
  // Keep partially typed answers and caret position intact during polling.
  const focused = document.activeElement as HTMLTextAreaElement | null;
  if (!focused?.matches('[data-answer]')) {
    el('questions').innerHTML = pending.map(q => `<article class="question"><span class="source">${escape(q.adapter)} / ${escape(q.sessionId)}</span><h3>${escape(q.question)}</h3><p>${escape(q.reason)}</p>${q.contextCurrent === false ? '<p>会話が更新されました。Astraで再確認してから回答してください。</p>' : ''}<details><summary>この確認の根拠</summary><p>会話: ${escape(q.evidenceEventIds.join(', '))}<br>保持条件: ${escape(q.conditionIds.join(', '))}</p></details><textarea data-answer="${escape(q.id)}" maxlength="4000" rows="2" placeholder="意図や訂正を伝える">${escape(drafts.get(q.id) ?? '')}</textarea><div class="row"><button class="primary" data-save="${escape(q.id)}" ${q.contextCurrent === false ? 'disabled' : ''}>回答を保存</button><button data-voice="${escape(q.id)}" ${state.capabilities.providerConfigured && q.contextCurrent !== false ? '' : 'disabled'}>音声で相談</button><button class="link" data-cancel="${escape(q.id)}">今回は閉じる</button></div></article>`).join('') || '<p class="empty">いま回答が必要な確認はありません。<br>自動分析を有効にすると、会話の変化に合わせてAstraが必要な前提を照合します。</p>';
  }
  el('deliveries').innerHTML = state.deliveries.map(d => `<div class="delivery"><small>${escape(d.adapter)} / ${escape(d.sessionId)} · ${escape(deliveryLabel(d))}</small><p>${escape(d.text)}</p><button data-copy="${escape(d.id)}">回答をコピー</button></div>`).join('') || '<p class="muted">確認への回答はここに保存されます。</p>';
  el('messages').innerHTML = [...state.messages].reverse().slice(0, 20).map(m => `<article class="message"><small>${escape(m.source.adapter)} / ${escape(m.origin === 'innovox' ? 'InnoVoxからの返答' : m.payload.role ?? m.kind)} · ${escape(new Date(m.occurredAt).toLocaleTimeString())}</small><p>${escape(m.payload.text ?? JSON.stringify(m.payload))}</p></article>`).join('') || '<p class="muted">まだ会話が取り込まれていません。</p>';
  if (voiceQuestion) {
    const active = await request<Consultation>('/api/consultations/' + voiceQuestion.id);
    if (active.status !== 'pending' || active.version !== voiceQuestion.version || active.contextCurrent === false) {
      voice.stop(); voiceQuestion = undefined; notice('対象の確認が更新または終了しました。音声の返答を自動適用しません。');
    }
  }
}
el('login-form').addEventListener('submit', e => {
  e.preventDefault(); token = value('token');
  void refresh().then(() => { sessionStorage.setItem('innovox.access', token); el<HTMLInputElement>('token').value = ''; notice('接続しました。'); })
    .catch(e => { token = ''; notice(e.message); });
});
bind('logout', () => { voice.cleanup(); token = ''; sessionStorage.removeItem('innovox.access'); location.reload(); });
bind('sample', async () => {
  const p = await request<Project>('/api/demo', {}); projectId = p.id; sessionStorage.setItem('innovox.project', p.id); await refresh();
  notice('合成データのサンプルです。Astraや音声APIを呼ばず、保存と回答の流れを確認できます。');
});
el('project').addEventListener('change', () => {
  projectId = value('project'); sessionStorage.setItem('innovox.project', projectId); void refresh().catch(e => notice(e.message));
});
function edit(p?: Project) {
  editing = p; el('project-editor').hidden = false;
  el<HTMLInputElement>('project-name').value = p?.name ?? '';
  el<HTMLTextAreaElement>('conditions').value = p?.conditions.map(c => c.text + ' | ' + c.reason).join('\n') ?? '';
  el<HTMLInputElement>('auto-analyze').checked = p?.autoAnalyze ?? false;
}
bind('new-project', () => edit()); bind('edit-project', () => { const p = state.projects.find(p => p.id === projectId); if (p) edit(p); });
bind('cancel-edit', () => { el('project-editor').hidden = true; });
el('project-form').addEventListener('submit', e => {
  e.preventDefault(); void (async () => {
    const conditions = value('conditions').split('\n').filter(l => l.trim()).map((line, i) => {
      const index = line.indexOf('|'); if (index < 1) throw new Error('各行を「条件 | 理由」の形で入力してください。');
      return { id: editing?.conditions[i]?.id ?? crypto.randomUUID(), text: line.slice(0, index).trim(), reason: line.slice(index + 1).trim() };
    });
    const project = { name: value('project-name'), conditions, autoAnalyze: el<HTMLInputElement>('auto-analyze').checked };
    const p = editing ? await request<Project>('/api/projects/' + editing.id, { project, expectedRevision: editing.revision }, 'PUT')
      : await request<Project>('/api/projects', project);
    projectId = p.id; sessionStorage.setItem('innovox.project', p.id); el('project-editor').hidden = true; await refresh(); notice('プロジェクトの前提を保存しました。');
  })().catch(e => notice(e.message));
});
el('questions').addEventListener('input', e => { const t = e.target as HTMLTextAreaElement; if (t.dataset.answer) drafts.set(t.dataset.answer, t.value); });
document.addEventListener('click', e => {
  const button = (e.target as HTMLElement).closest('button'); if (!button) return;
  void (async () => {
    if (button.dataset.analyze) {
      const s = state.sessions[Number(button.dataset.analyze)]!; button.disabled = true; notice('Astraが会話と保持条件を照合しています…');
      const result = await request<{ consultation: Consultation | null }>('/api/analyze', { projectId, adapter: s.adapter, sessionId: s.sessionId });
      notice(result.consultation ? '確認したい前提が見つかりました。' : '今すぐ確認が必要な前提は見つかりませんでした。'); await refresh();
    }
    if (button.dataset.save) {
      const q = state.consultations.find(q => q.id === button.dataset.save)!;
      const text = drafts.get(q.id)?.trim(); if (!text) throw new Error('返答を入力してください。');
      const answerId = answerIds.get(q.id) ?? crypto.randomUUID(); answerIds.set(q.id, answerId);
      button.disabled = true;
      await request('/api/consultations/' + q.id + '/answer', { answerId, text, expectedVersion: q.version,
        channel: voiceQuestion?.id === q.id ? 'voice' : 'typed' });
      drafts.delete(q.id); await refresh(); notice('回答を保存しました。送信先への反映はまだ行っていません。');
    }
    if (button.dataset.cancel) { await request('/api/consultations/' + button.dataset.cancel + '/cancel', {}); await refresh(); }
    if (button.dataset.copy) { await navigator.clipboard.writeText(state.deliveries.find(d => d.id === button.dataset.copy)!.text); notice('コピーしました。コピーは送信完了を意味しません。'); }
    if (button.dataset.voice) {
      const q = state.consultations.find(q => q.id === button.dataset.voice)!;
      voiceQuestion = q; el('voice-panel').hidden = false; el('voice-question').textContent = q.question;
      el<HTMLTextAreaElement>('voice-draft').value = ''; await voice.start(q);
    }
  })().catch(error => { button.disabled = false; notice(error.message); });
});
bind('voice-stop', () => voice.stop());
bind('voice-use', async () => {
  if (!voiceQuestion) throw new Error('対象の確認がありません。');
  drafts.set(voiceQuestion.id, value('voice-draft')); projectId = voiceQuestion.projectId;
  sessionStorage.setItem('innovox.project', projectId); voice.stop(); await refresh(); notice('回答欄に戻しました。内容を確認して保存してください。');
});
bind('add-message', () => { if (!projectId) throw new Error('先にプロジェクトを作成してください。'); el('message-form').hidden = false; });
bind('cancel-message', () => { el('message-form').hidden = true; });
el('message-form').addEventListener('submit', e => {
  e.preventDefault(); void (async () => {
    const s = state.sessions.find(s => s.adapter === 'manual' && s.sessionId === 'workspace');
    await request('/api/events', { schemaVersion: 1, eventId: crypto.randomUUID(), projectId,
      source: { adapter: 'manual', sessionId: 'workspace', epoch: s?.epoch ?? 0 }, sequence: (s?.highSequence ?? -1) + 1,
      occurredAt: new Date().toISOString(), kind: 'message', origin: value('message-role') === 'user' ? 'human' : 'agent',
      payload: { role: value('message-role'), text: value('message-text') } });
    el<HTMLTextAreaElement>('message-text').value = ''; el('message-form').hidden = true; await refresh(); notice('会話を追加しました。');
  })().catch(error => notice(error.message));
});
let refreshing = false;
setInterval(() => { if (!token || document.hidden || refreshing) return; refreshing = true;
  void refresh().catch(e => notice(e.message)).finally(() => { refreshing = false; }); }, 3000);
window.addEventListener('pagehide', () => voice.cleanup());
if (token) void refresh().catch(e => { token = ''; sessionStorage.removeItem('innovox.access'); notice(e.message); });
