/**
 * PA ICT Academy — timetable admin.
 *
 * Writes to Supabase; the public site reads from it. Nothing here touches
 * HTML files, Git, or a deployment.
 *
 * Authorisation is enforced by RLS, not by this file: writes only succeed for
 * a signed-in user with an active row in staff_users. Hiding controls here is
 * a convenience, never the security boundary.
 */
(function () {
  'use strict';

  var cfg = window.PAICTSupabase;
  var render = window.PAICTTimetableRender;
  var client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  var LOCATIONS = ['homagama', 'horana', 'nugegoda'];
  var KINDS = ['live', 'repeat', 'paper', 'seminar', 'discussion'];
  var PLATFORMS = ['', 'zoom', 'youtube', 'physical'];
  var VARIANTS = ['info', 'warning', 'zoom'];
  var POSITIONS = ['above', 'below'];

  var state = {
    user: null,
    staff: null,
    timetables: [],
    draft: null,
    dirty: false
  };

  /* =============================================================
     Small helpers
     ============================================================= */
  function $(sel) { return document.querySelector(sel); }
  function show(el, on) { if (el) el.hidden = !on; }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  var toastTimer = null;
  function toast(message, isError) {
    var node = $('#toast');
    node.textContent = message;
    node.classList.toggle('admin-toast--error', !!isError);
    show(node, true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { show(node, false); }, 4000);
  }

  var confirmResolve = null;
  function confirmAction(body, okLabel) {
    $('#confirm-body').textContent = body;
    var ok = $('#confirm-modal [data-action="confirm-ok"]');
    ok.textContent = okLabel || 'Delete';
    ok.classList.toggle('btn--danger', !okLabel);
    ok.classList.toggle('btn--primary', !!okLabel);
    show($('#confirm-modal'), true);
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }

  function closeConfirm(result) {
    show($('#confirm-modal'), false);
    if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
  }

  /** "08:00:00" -> "08:00" for <input type="time">, and back. */
  function toInputTime(value) {
    if (!value) return '';
    var bits = String(value).split(':');
    return bits.length >= 2 ? bits[0] + ':' + bits[1] : '';
  }
  function fromInputTime(value) {
    return value ? value + ':00' : null;
  }

  function blank(value) {
    return value == null || String(value).trim() === '';
  }

  /* =============================================================
     Field builders
     ============================================================= */
  function field(labelText, control, wide) {
    var wrap = el('label', 'admin-field' + (wide ? ' admin-field--wide' : ''));
    wrap.appendChild(el('span', 'admin-field__label', labelText));
    wrap.appendChild(control);
    return wrap;
  }

  /**
   * Bind a value handler to a control.
   *
   * Both 'input' and 'change' are needed, not just 'input': Chrome's native
   * time-picker dropdown, autofill, and some IME/paste paths fire only
   * 'change'. Listening to 'input' alone meant a value could be visible in
   * the field but never reach the draft, so saving wrote the old value back
   * while the form showed the new one - a silent data loss.
   *
   * Both events firing for one edit is harmless, but the guard keeps
   * handlers that re-render (Mode, Type, note variant) from doing it twice.
   */
  function bindValue(node, read, handler) {
    var last = read();
    function commit() {
      var current = read();
      if (current === last) return;
      last = current;
      handler(current, node);
    }
    node.addEventListener('input', commit);
    node.addEventListener('change', commit);
  }

  function input(value, onInput, type) {
    var node = el('input', 'admin-input');
    node.type = type || 'text';
    node.value = value == null ? '' : value;
    bindValue(node, function () { return node.value; }, onInput);
    return node;
  }

  function select(options, value, onChange, labels) {
    var node = el('select', 'admin-select');
    options.forEach(function (opt) {
      var o = el('option', null, labels && labels[opt] != null ? labels[opt] : (opt || '—'));
      o.value = opt;
      node.appendChild(o);
    });
    node.value = value == null ? '' : value;
    bindValue(node, function () { return node.value; }, onChange);
    return node;
  }

  function textarea(value, onInput) {
    var node = el('textarea', 'admin-textarea');
    node.value = value == null ? '' : value;
    bindValue(node, function () { return node.value; }, function (v) { onInput(v); });
    return node;
  }

  function checkbox(labelText, checked, onChange) {
    var wrap = el('label', 'admin-check');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!checked;
    box.addEventListener('change', function () { onChange(box.checked); });
    wrap.appendChild(box);
    wrap.appendChild(el('span', null, labelText));
    return wrap;
  }

  function iconButton(label, title, onClick, danger) {
    var b = el('button', 'admin-icon-btn' + (danger ? ' admin-icon-btn--danger' : ''), label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }

  /* =============================================================
     Auth
     ============================================================= */
  function showView(name) {
    show($('#view-login'), name === 'login');
    show($('#view-denied'), name === 'denied');
    show($('#view-app'), name === 'app');
  }

  async function checkStaff(userId) {
    var res = await client
      .from('staff_users')
      .select('user_id, role, active')
      .eq('user_id', userId)
      .maybeSingle();
    if (res.error) return null;
    return res.data && res.data.active ? res.data : null;
  }

  async function refreshSession() {
    var res = await client.auth.getSession();
    var session = res.data ? res.data.session : null;
    if (!session) { showView('login'); return; }

    state.user = session.user;
    state.staff = await checkStaff(session.user.id);

    if (!state.staff) {
      $('#denied-message').textContent =
        'The account ' + session.user.email +
        ' is not on the active timetable staff list. Ask an administrator to add it.';
      showView('denied');
      return;
    }

    $('#current-user').textContent = session.user.email + ' · ' + state.staff.role;
    showView('app');
    await loadTimetables();
  }

  async function signIn(event) {
    event.preventDefault();
    var button = $('#login-submit');
    var errorBox = $('#login-error');
    show(errorBox, false);
    button.setAttribute('aria-busy', 'true');

    var res = await client.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-password').value
    });

    button.removeAttribute('aria-busy');

    if (res.error) {
      errorBox.textContent = res.error.message === 'Invalid login credentials'
        ? 'Wrong email or password. Please try again.'
        : res.error.message;
      show(errorBox, true);
      return;
    }
    $('#login-password').value = '';
    await refreshSession();
  }

  async function signOut() {
    await client.auth.signOut();
    state.user = null;
    state.staff = null;
    state.draft = null;
    showView('login');
  }

  /* =============================================================
     Data
     ============================================================= */
  var CHILD_SELECT = '*,timetable_sections(*),class_slots(*),timetable_notes(*)';

  async function loadTimetables() {
    var res = await client
      .from('timetables')
      .select('*,class_slots(id)')
      .order('sort_order', { ascending: true });
    if (res.error) { toast('Could not load timetables: ' + res.error.message, true); return; }
    state.timetables = res.data || [];
    renderList();
  }

  async function loadDraft(id) {
    var res = await client.from('timetables').select(CHILD_SELECT).eq('id', id).single();
    if (res.error) { toast('Could not open timetable: ' + res.error.message, true); return null; }
    var data = res.data;
    function bySort(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }
    return {
      timetable: stripChildren(data),
      slots: (data.class_slots || []).sort(bySort),
      notes: (data.timetable_notes || []).sort(bySort),
      sections: (data.timetable_sections || []).sort(bySort),
      removedSlots: [],
      removedNotes: [],
      isNew: false
    };
  }

  function stripChildren(row) {
    var copy = {};
    Object.keys(row).forEach(function (k) {
      if (k !== 'class_slots' && k !== 'timetable_notes' && k !== 'timetable_sections') {
        copy[k] = row[k];
      }
    });
    return copy;
  }

  function newDraft() {
    var year = new Date().getFullYear() + 1;
    return {
      timetable: {
        id: uuid(),
        slug: '',
        year: year,
        mode: 'online',
        location_key: null,
        title_en: '',
        title_si: '',
        subtitle_en: '',
        subtitle_si: '',
        time_format: '24h',
        sort_order: state.timetables.length,
        published: false
      },
      slots: [],
      notes: [],
      sections: [],
      removedSlots: [],
      removedNotes: [],
      isNew: true
    };
  }

  /* =============================================================
     List view
     ============================================================= */
  function renderList() {
    var body = $('#timetable-rows');
    body.textContent = '';
    show($('#list-empty'), state.timetables.length === 0);

    state.timetables.forEach(function (t) {
      var tr = el('tr');

      var titleCell = el('td');
      titleCell.appendChild(el('span', 'admin-table__title',
        render.bilingual(t.title_en, t.title_si) || '(untitled)'));
      titleCell.appendChild(el('span', 'admin-table__slug', '/timetables/' + t.slug));
      tr.appendChild(titleCell);

      tr.appendChild(el('td', null, String(t.year)));
      tr.appendChild(el('td', null, t.mode === 'physical'
        ? 'Physical · ' + (t.location_key || '—')
        : 'Online'));
      tr.appendChild(el('td', null, String((t.class_slots || []).length)));

      var statusCell = el('td');
      statusCell.appendChild(el('span',
        'admin-pill ' + (t.published ? 'admin-pill--published' : 'admin-pill--draft'),
        t.published ? 'Published' : 'Draft'));
      tr.appendChild(statusCell);

      var actions = el('td', 'admin-table__actions');
      var edit = el('button', 'btn btn--secondary btn--sm', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', function () { openEditor(t.id); });
      actions.appendChild(edit);

      var preview = el('a', 'admin-icon-btn', '↗');
      preview.href = '/timetables/' + t.slug;
      preview.target = '_blank';
      preview.rel = 'noopener';
      preview.title = 'Preview on the site';
      actions.appendChild(preview);

      actions.appendChild(iconButton('⧉', 'Duplicate', function () { duplicate(t); }));
      actions.appendChild(iconButton('🗑', 'Delete', function () { removeTimetable(t); }, true));
      tr.appendChild(actions);

      body.appendChild(tr);
    });
  }

  function showPanel(which) {
    show($('#panel-list'), which === 'list');
    show($('#panel-editor'), which === 'editor');
  }

  async function openEditor(id) {
    var draft = id ? await loadDraft(id) : newDraft();
    if (!draft) return;
    state.draft = draft;
    state.dirty = false;
    $('#editor-heading').textContent = draft.isNew
      ? 'New timetable'
      : (render.bilingual(draft.timetable.title_en, draft.timetable.title_si) || 'Edit timetable');
    renderEditor();
    showPanel('editor');
    window.scrollTo(0, 0);
  }

  function markDirty() {
    state.dirty = true;
    $('#editor-status').textContent = 'Unsaved changes';
    updatePreview();
  }

  /* =============================================================
     Editor — details
     ============================================================= */
  function renderDetails() {
    var t = state.draft.timetable;
    var grid = $('#details-grid');
    grid.textContent = '';

    grid.appendChild(field('English title *', input(t.title_en, function (v) {
      t.title_en = v; markDirty();
    })));
    grid.appendChild(field('Sinhala title', input(t.title_si, function (v) {
      t.title_si = v; markDirty();
    })));
    grid.appendChild(field('English subtitle', input(t.subtitle_en, function (v) {
      t.subtitle_en = v; markDirty();
    })));
    grid.appendChild(field('Sinhala subtitle', input(t.subtitle_si, function (v) {
      t.subtitle_si = v; markDirty();
    })));

    grid.appendChild(field('Year *', input(t.year, function (v) {
      t.year = v === '' ? '' : parseInt(v, 10); markDirty();
    }, 'number')));

    var slugInput = input(t.slug, function (v) {
      t.slug = v.trim().toLowerCase(); markDirty();
    });
    slugInput.placeholder = 'e.g. 2029-kandy';
    grid.appendChild(field('URL slug *  (/timetables/…)', slugInput));

    grid.appendChild(field('Mode', select(['online', 'physical'], t.mode, function (v) {
      t.mode = v;
      if (v === 'online') t.location_key = null;
      markDirty();
      renderDetails();
    }, { online: 'Online', physical: 'Physical' })));

    if (t.mode === 'physical') {
      var locInput = input(t.location_key, function (v) {
        t.location_key = v.trim().toLowerCase() || null; markDirty();
      });
      locInput.setAttribute('list', 'known-locations');
      var list = el('datalist');
      list.id = 'known-locations';
      LOCATIONS.forEach(function (l) {
        var o = el('option'); o.value = l; list.appendChild(o);
      });
      var locField = field('Location key', locInput);
      locField.appendChild(list);
      grid.appendChild(locField);
    }

    grid.appendChild(field('Time format', select(['24h', '12h'], t.time_format, function (v) {
      t.time_format = v; markDirty();
    }, { '24h': '24-hour (08:00 — 17:00)', '12h': '12-hour (08:00 AM — 05:00 PM)' })));

    grid.appendChild(field('Sort order', input(t.sort_order, function (v) {
      t.sort_order = v === '' ? 0 : parseInt(v, 10); markDirty();
    }, 'number')));

    var pubWrap = el('div', 'admin-field admin-field--wide');
    pubWrap.appendChild(checkbox(
      'Published — visible to visitors', t.published, function (on) {
        t.published = on; markDirty();
      }));
    grid.appendChild(pubWrap);
  }

  /* =============================================================
     Editor — class slots
     ============================================================= */
  function slotSummary(slot) {
    var time = render.formatTimeRange(slot, state.draft.timetable.time_format);
    var label = render.bilingual(slot.label_en, slot.label_si);
    return [slot.day_en || '(day)', time, label].filter(Boolean).join(' · ');
  }

  function renderSlots() {
    var list = $('#slot-list');
    list.textContent = '';
    show($('#slot-empty'), state.draft.slots.length === 0);

    state.draft.slots.forEach(function (slot, index) {
      list.appendChild(slotCard(slot, index));
    });
  }

  function slotCard(slot, index) {
    var card = el('div', 'admin-item' + (slot.published ? '' : ' admin-item--draft'));

    var head = el('div', 'admin-item__head');
    head.appendChild(el('span', 'admin-item__title', slotSummary(slot)));
    head.appendChild(iconButton('↑', 'Move up', function () {
      move(state.draft.slots, index, -1); renderSlots(); markDirty();
    })).disabled = index === 0;
    head.appendChild(iconButton('↓', 'Move down', function () {
      move(state.draft.slots, index, 1); renderSlots(); markDirty();
    })).disabled = index === state.draft.slots.length - 1;
    head.appendChild(iconButton('🗑', 'Delete class', function () {
      removeSlot(index);
    }, true));
    card.appendChild(head);

    var body = el('div', 'admin-item__body');
    function set(key) {
      return function (v) { slot[key] = v === '' ? null : v; markDirty(); refreshHead(); };
    }
    function refreshHead() {
      head.firstChild.textContent = slotSummary(slot);
      card.classList.toggle('admin-item--draft', !slot.published);
    }

    body.appendChild(field('Day (EN) *', input(slot.day_en, function (v) {
      slot.day_en = v; markDirty(); refreshHead();
    })));
    body.appendChild(field('Day (SI)', input(slot.day_si, set('day_si'))));
    body.appendChild(field('Type', select(KINDS, slot.kind, function (v) {
      slot.kind = v; markDirty(); refreshHead(); }, {
      live: 'Live', repeat: 'Repeat', paper: 'Paper',
      seminar: 'Seminar', discussion: 'Discussion'
    })));

    body.appendChild(field('Start time', input(toInputTime(slot.start_time), function (v) {
      slot.start_time = fromInputTime(v); markDirty(); refreshHead();
    }, 'time')));
    body.appendChild(field('End time', input(toInputTime(slot.end_time), function (v) {
      slot.end_time = fromInputTime(v); markDirty(); refreshHead();
    }, 'time')));
    body.appendChild(field('Paper / slot number', input(slot.seq_label, set('seq_label'))));

    body.appendChild(field('Label (EN) *', input(slot.label_en, function (v) {
      slot.label_en = v; markDirty(); refreshHead();
    })));
    body.appendChild(field('Label (SI)', input(slot.label_si, set('label_si'))));
    body.appendChild(field('Platform', select(PLATFORMS, slot.platform || '', function (v) {
      slot.platform = v || null; markDirty();
    }, { '': 'None', zoom: 'Zoom', youtube: 'YouTube Live', physical: 'On-site' })));

    body.appendChild(field('Session badge (EN)', input(slot.session_badge_en, set('session_badge_en'))));
    body.appendChild(field('Session badge (SI)', input(slot.session_badge_si, set('session_badge_si'))));
    body.appendChild(field('Time note (EN)', input(slot.time_note_en, set('time_note_en'))));
    body.appendChild(field('Time note (SI)', input(slot.time_note_si, set('time_note_si'))));
    body.appendChild(field('Optional note (EN)', input(slot.optional_note_en, set('optional_note_en'))));
    body.appendChild(field('Optional note (SI)', input(slot.optional_note_si, set('optional_note_si'))));

    if (state.draft.sections.length) {
      var opts = [''].concat(state.draft.sections.map(function (s) { return s.id; }));
      var labels = { '': 'No section' };
      state.draft.sections.forEach(function (s) {
        labels[s.id] = render.bilingual(s.title_en, s.title_si);
      });
      body.appendChild(field('Section', select(opts, slot.section_id || '', function (v) {
        slot.section_id = v || null; markDirty();
      }, labels)));
    }

    var pub = el('div', 'admin-field');
    pub.appendChild(checkbox('Published', slot.published, function (on) {
      slot.published = on; markDirty(); refreshHead();
    }));
    body.appendChild(pub);

    card.appendChild(body);
    return card;
  }

  function move(list, index, delta) {
    var target = index + delta;
    if (target < 0 || target >= list.length) return;
    var tmp = list[index];
    list[index] = list[target];
    list[target] = tmp;
  }

  async function removeSlot(index) {
    var slot = state.draft.slots[index];
    var ok = await confirmAction(
      'Delete the class "' + slotSummary(slot) + '"? This cannot be undone once saved.');
    if (!ok) return;
    if (!slot._new) state.draft.removedSlots.push(slot.id);
    state.draft.slots.splice(index, 1);
    renderSlots();
    markDirty();
  }

  function addSlot() {
    state.draft.slots.push({
      id: uuid(),
      _new: true,
      timetable_id: state.draft.timetable.id,
      day_en: '',
      day_si: null,
      session_badge_en: null,
      session_badge_si: null,
      seq_label: null,
      start_time: null,
      end_time: null,
      time_note_en: null,
      time_note_si: null,
      kind: 'live',
      label_en: '',
      label_si: null,
      optional_note_en: null,
      optional_note_si: null,
      platform: null,
      section_id: null,
      sort_order: state.draft.slots.length,
      published: true
    });
    renderSlots();
    markDirty();
  }

  /* =============================================================
     Editor — notes
     ============================================================= */
  function renderNotes() {
    var list = $('#note-list');
    list.textContent = '';
    show($('#note-empty'), state.draft.notes.length === 0);
    state.draft.notes.forEach(function (note, index) {
      list.appendChild(noteCard(note, index));
    });
  }

  function noteCard(note, index) {
    var card = el('div', 'admin-item' + (note.published ? '' : ' admin-item--draft'));

    var head = el('div', 'admin-item__head');
    var summary = render.bilingual(note.title_en, note.title_si)
      || render.bilingual(note.body_en, note.body_si) || '(empty note)';
    head.appendChild(el('span', 'admin-item__title',
      note.variant + ' · ' + note.position + ' · ' + summary));
    head.appendChild(iconButton('↑', 'Move up', function () {
      move(state.draft.notes, index, -1); renderNotes(); markDirty();
    })).disabled = index === 0;
    head.appendChild(iconButton('↓', 'Move down', function () {
      move(state.draft.notes, index, 1); renderNotes(); markDirty();
    })).disabled = index === state.draft.notes.length - 1;
    head.appendChild(iconButton('🗑', 'Delete note', function () {
      removeNote(index);
    }, true));
    card.appendChild(head);

    var body = el('div', 'admin-item__body');
    body.appendChild(field('Style', select(VARIANTS, note.variant, function (v) {
      note.variant = v; markDirty(); renderNotes();
    }, { info: 'Info', warning: 'Warning', zoom: 'Zoom banner' })));
    body.appendChild(field('Position', select(POSITIONS, note.position, function (v) {
      note.position = v; markDirty(); renderNotes();
    }, { above: 'Above the table', below: 'Below the table' })));
    var pub = el('div', 'admin-field');
    pub.appendChild(checkbox('Published', note.published, function (on) {
      note.published = on; markDirty(); renderNotes();
    }));
    body.appendChild(pub);

    body.appendChild(field('Title (EN)', input(note.title_en, function (v) {
      note.title_en = v || null; markDirty();
    })));
    body.appendChild(field('Title (SI)', input(note.title_si, function (v) {
      note.title_si = v || null; markDirty();
    })));
    body.appendChild(el('div'));

    body.appendChild(field('Body (EN)', textarea(note.body_en, function (v) {
      note.body_en = v || null; markDirty();
    }), true));
    body.appendChild(field('Body (SI)', textarea(note.body_si, function (v) {
      note.body_si = v || null; markDirty();
    }), true));

    card.appendChild(body);
    return card;
  }

  async function removeNote(index) {
    var note = state.draft.notes[index];
    var ok = await confirmAction('Delete this note? This cannot be undone once saved.');
    if (!ok) return;
    if (!note._new) state.draft.removedNotes.push(note.id);
    state.draft.notes.splice(index, 1);
    renderNotes();
    markDirty();
  }

  function addNote() {
    state.draft.notes.push({
      id: uuid(),
      _new: true,
      timetable_id: state.draft.timetable.id,
      variant: 'info',
      position: 'below',
      title_en: null,
      title_si: null,
      body_en: null,
      body_si: null,
      sort_order: state.draft.notes.length,
      published: true
    });
    renderNotes();
    markDirty();
  }

  /* =============================================================
     Live preview — the real renderer, the real stylesheet
     ============================================================= */
  function updatePreview() {
    var d = state.draft;
    if (!d) return;
    var visibleSlots = d.slots.filter(function (s) { return s.published; });
    var data = Object.assign({}, d.timetable, {
      class_slots: visibleSlots,
      timetable_sections: d.sections,
      timetable_notes: d.notes.filter(function (n) { return n.published; })
    });

    render.renderTimetable($('#preview-timetable'), data);
    render.renderNotes($('#preview-notes-above'), data, 'above');
    render.renderNotes($('#preview-notes-below'), data, 'below');

    $('#preview-title').textContent =
      render.bilingual(data.title_en, data.title_si) || '(untitled)';
    var sub = render.bilingual(data.subtitle_en, data.subtitle_si);
    $('#preview-subtitle').textContent = sub;
    show($('#preview-subtitle'), !!sub);
  }

  function renderEditor() {
    renderDetails();
    renderSlots();
    renderNotes();
    updatePreview();
    $('#editor-status').textContent = state.draft.isNew ? 'Not saved yet' : 'Saved';
  }

  /* =============================================================
     Validation
     ============================================================= */
  function validate(draft, publishing) {
    var t = draft.timetable;
    var problems = [];

    if (blank(t.title_en)) problems.push('English title is required.');

    var year = parseInt(t.year, 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      problems.push('Year must be a number between 2000 and 2100.');
    }

    if (blank(t.slug)) {
      problems.push('URL slug is required.');
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.slug)) {
      problems.push('Slug may use lowercase letters, numbers and single hyphens only.');
    } else {
      var clash = state.timetables.some(function (other) {
        return other.slug === t.slug && other.id !== t.id;
      });
      if (clash) problems.push('That slug is already used by another timetable.');
    }

    if (['online', 'physical'].indexOf(t.mode) === -1) problems.push('Mode is invalid.');
    if (['12h', '24h'].indexOf(t.time_format) === -1) problems.push('Time format is invalid.');
    if (isNaN(parseInt(t.sort_order, 10))) problems.push('Sort order must be a number.');

    draft.slots.forEach(function (slot, i) {
      var where = 'Class ' + (i + 1) + ': ';
      if (blank(slot.day_en)) problems.push(where + 'day (EN) is required.');
      // The badge must not render empty, but a few real classes carry only a
      // parenthetical note (e.g. "(Not Mandatory)") and no main label.
      if (blank(slot.label_en) && blank(slot.optional_note_en) && blank(slot.optional_note_si)) {
        problems.push(where + 'add a label (EN), or an optional note.');
      }
      if (KINDS.indexOf(slot.kind) === -1) problems.push(where + 'type is invalid.');
      if (slot.platform && PLATFORMS.indexOf(slot.platform) === -1) {
        problems.push(where + 'platform is invalid.');
      }
      if (slot.end_time && !slot.start_time) {
        problems.push(where + 'an end time needs a start time.');
      }
    });

    draft.notes.forEach(function (note, i) {
      var where = 'Note ' + (i + 1) + ': ';
      if (VARIANTS.indexOf(note.variant) === -1) problems.push(where + 'style is invalid.');
      if (POSITIONS.indexOf(note.position) === -1) problems.push(where + 'position is invalid.');
      if (blank(note.title_en) && blank(note.title_si)
        && blank(note.body_en) && blank(note.body_si)) {
        problems.push(where + 'add a title or some body text.');
      }
    });

    if (publishing && !draft.slots.some(function (s) { return s.published; })) {
      problems.push('WARN:This timetable has no published classes — visitors will see an empty table.');
    }

    return problems;
  }

  /* =============================================================
     Saving
     ============================================================= */
  function slotPayload(slot, index, timetableId) {
    return {
      id: slot.id,
      timetable_id: timetableId,
      section_id: slot.section_id || null,
      day_en: slot.day_en,
      day_si: slot.day_si || null,
      session_badge_en: slot.session_badge_en || null,
      session_badge_si: slot.session_badge_si || null,
      seq_label: slot.seq_label || null,
      start_time: slot.start_time || null,
      end_time: slot.end_time || null,
      time_note_en: slot.time_note_en || null,
      time_note_si: slot.time_note_si || null,
      kind: slot.kind,
      label_en: slot.label_en,
      label_si: slot.label_si || null,
      optional_note_en: slot.optional_note_en || null,
      optional_note_si: slot.optional_note_si || null,
      platform: slot.platform || null,
      sort_order: index,
      published: !!slot.published
    };
  }

  function notePayload(note, index, timetableId) {
    return {
      id: note.id,
      timetable_id: timetableId,
      variant: note.variant,
      position: note.position,
      title_en: note.title_en || null,
      title_si: note.title_si || null,
      body_en: note.body_en || null,
      body_si: note.body_si || null,
      sort_order: index,
      published: !!note.published
    };
  }

  async function save(publish) {
    var draft = state.draft;
    if (!draft) return;

    if (publish) draft.timetable.published = true;

    var problems = validate(draft, draft.timetable.published);
    var warnings = problems.filter(function (p) { return p.indexOf('WARN:') === 0; });
    var errors = problems.filter(function (p) { return p.indexOf('WARN:') !== 0; });

    if (errors.length) {
      toast(errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ' more)' : ''), true);
      return;
    }
    if (warnings.length) {
      var proceed = await confirmAction(warnings[0].slice(5) + ' Publish anyway?', 'Publish');
      if (!proceed) return;
    }

    $('#editor-status').textContent = 'Saving…';

    var t = draft.timetable;
    var payload = {
      id: t.id,
      slug: t.slug,
      year: parseInt(t.year, 10),
      mode: t.mode,
      location_key: t.mode === 'physical' ? (t.location_key || null) : null,
      title_en: t.title_en,
      title_si: t.title_si || null,
      subtitle_en: t.subtitle_en || null,
      subtitle_si: t.subtitle_si || null,
      time_format: t.time_format,
      sort_order: parseInt(t.sort_order, 10) || 0,
      published: !!t.published
    };

    var res = await client.from('timetables').upsert(payload).select().single();
    if (res.error) { saveFailed(res.error); return; }

    // Sections must exist before slots that reference them.
    if (draft.sections.length) {
      var sec = await client.from('timetable_sections').upsert(
        draft.sections.map(function (section, i) {
          return {
            id: section.id,
            timetable_id: t.id,
            theme: section.theme,
            title_en: section.title_en,
            title_si: section.title_si || null,
            subtitle_en: section.subtitle_en || null,
            subtitle_si: section.subtitle_si || null,
            body_en: section.body_en || null,
            body_si: section.body_si || null,
            note_en: section.note_en || null,
            note_si: section.note_si || null,
            sort_order: i,
            published: section.published !== false
          };
        }));
      if (sec.error) { saveFailed(sec.error); return; }
    }

    if (draft.removedSlots.length) {
      var d1 = await client.from('class_slots').delete().in('id', draft.removedSlots);
      if (d1.error) { saveFailed(d1.error); return; }
      draft.removedSlots = [];
    }
    if (draft.removedNotes.length) {
      var d2 = await client.from('timetable_notes').delete().in('id', draft.removedNotes);
      if (d2.error) { saveFailed(d2.error); return; }
      draft.removedNotes = [];
    }

    if (draft.slots.length) {
      var s = await client.from('class_slots').upsert(
        draft.slots.map(function (slot, i) { return slotPayload(slot, i, t.id); }));
      if (s.error) { saveFailed(s.error); return; }
    }
    if (draft.notes.length) {
      var n = await client.from('timetable_notes').upsert(
        draft.notes.map(function (note, i) { return notePayload(note, i, t.id); }));
      if (n.error) { saveFailed(n.error); return; }
    }

    draft.slots.forEach(function (slot, i) { delete slot._new; slot.sort_order = i; });
    draft.notes.forEach(function (note, i) { delete note._new; note.sort_order = i; });
    draft.isNew = false;
    state.dirty = false;
    $('#editor-status').textContent = t.published ? 'Published' : 'Saved as draft';
    toast(t.published
      ? 'Saved and live — the site shows this on the next page load.'
      : 'Saved as a draft. Visitors cannot see it until you publish.');

    await loadTimetables();
  }

  function saveFailed(error) {
    $('#editor-status').textContent = 'Not saved';
    var message = error.message || 'Unknown error';
    if (/row-level security/i.test(message)) {
      message = 'The database rejected the write. Your account may no longer have staff access.';
    }
    toast('Save failed: ' + message, true);
  }

  /* =============================================================
     Duplicate / delete
     ============================================================= */
  async function duplicate(row) {
    var source = await loadDraft(row.id);
    if (!source) return;

    var newId = uuid();
    var sectionMap = {};
    source.sections.forEach(function (s) { sectionMap[s.id] = uuid(); });

    var copy = {
      timetable: Object.assign({}, source.timetable, {
        id: newId,
        slug: (source.timetable.slug + '-copy').slice(0, 60),
        title_en: source.timetable.title_en + ' (copy)',
        published: false,
        sort_order: state.timetables.length
      }),
      sections: source.sections.map(function (s) {
        return Object.assign({}, s, { id: sectionMap[s.id], timetable_id: newId });
      }),
      slots: source.slots.map(function (s) {
        return Object.assign({}, s, {
          id: uuid(), _new: true, timetable_id: newId,
          section_id: s.section_id ? sectionMap[s.section_id] : null
        });
      }),
      notes: source.notes.map(function (n) {
        return Object.assign({}, n, { id: uuid(), _new: true, timetable_id: newId });
      }),
      removedSlots: [],
      removedNotes: [],
      isNew: true
    };

    state.draft = copy;
    state.dirty = true;
    $('#editor-heading').textContent = 'New timetable (copy)';
    renderEditor();
    showPanel('editor');
    toast('Duplicated as a draft. Review the slug, then save.');
  }

  async function removeTimetable(row) {
    var count = (row.class_slots || []).length;
    var ok = await confirmAction(
      'Delete "' + (row.title_en || row.slug) + '"? Its ' + count +
      ' class' + (count === 1 ? '' : 'es') +
      ' and all of its notes will be permanently deleted too. This cannot be undone.');
    if (!ok) return;
    var res = await client.from('timetables').delete().eq('id', row.id);
    if (res.error) { toast('Delete failed: ' + res.error.message, true); return; }
    toast('Deleted.');
    await loadTimetables();
  }

  /* =============================================================
     Wiring
     ============================================================= */
  function onAction(event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');

    if (action === 'sign-out') signOut();
    if (action === 'new-timetable') openEditor(null);
    if (action === 'back-to-list') backToList();
    if (action === 'add-slot') addSlot();
    if (action === 'add-note') addNote();
    if (action === 'save') save(false);
    if (action === 'save-publish') save(true);
    if (action === 'confirm-ok') closeConfirm(true);
    if (action === 'confirm-cancel') closeConfirm(false);
  }

  async function backToList() {
    if (state.dirty) {
      var ok = await confirmAction(
        'You have unsaved changes. Leave without saving?', 'Discard changes');
      if (!ok) return;
    }
    state.draft = null;
    state.dirty = false;
    showPanel('list');
  }

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  document.addEventListener('click', onAction);
  $('#login-form').addEventListener('submit', signIn);
  $('#confirm-modal').addEventListener('click', function (e) {
    if (e.target === $('#confirm-modal')) closeConfirm(false);
  });

  client.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') showView('login');
  });

  refreshSession();
})();
