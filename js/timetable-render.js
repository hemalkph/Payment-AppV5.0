/**
 * PA ICT Academy — timetable renderer.
 *
 * Turns structured timetable data into the same markup the site has always
 * used (.timetable__row, .tt-section, .info-block ...), so css/styles.css
 * needs no changes.
 *
 * Security: every value that originates in the database is written with
 * textContent. The only innerHTML used is for the hard-coded icon constants
 * below, which never contain user or database input.
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------
     Icons — declared once instead of being repeated on every row.
     --------------------------------------------------------------- */
  var ICONS = {
    clock:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">' +
      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    live:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;">' +
      '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>',
    repeat:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;">' +
      '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
    paper:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;">' +
      '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    seminar:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;">' +
      '<polygon points="5 3 19 12 5 21 5 3"/></svg>',
    discussion:
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;">' +
      '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    zoomBadge:
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/></svg>',
    youtubeBadge:
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<polygon points="5 3 19 12 5 21 5 3"/></svg>',
    physicalBadge:
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    zoomNote:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15.6 11.6L22 7v10l-6.4-4.5v-1zM4 5h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7c0-1.1.9-2 2-2z"/></svg>',
    warningNote:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;">' +
      '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>',
    sectionNote:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  var SECTION_ICONS = {
    revision: 'live', seminar: 'seminar', paper: 'paper', discussion: 'discussion'
  };

  /** Clock / badge accent colour, derived from the class kind. */
  var KIND_ACCENT = {
    live: '#2563eb',
    repeat: '#2563eb',
    paper: '#d97706',
    seminar: '#dc2626',
    discussion: '#0891b2'
  };

  var PLATFORM_LABEL = { zoom: 'Zoom', youtube: 'YouTube Live', physical: 'On-site' };
  var PLATFORM_ICON = {
    zoom: 'zoomBadge', youtube: 'youtubeBadge', physical: 'physicalBadge'
  };

  var iconCache = {};

  /** Clone an icon from the trusted constants above. */
  function icon(name) {
    if (!ICONS[name]) return null;
    if (!iconCache[name]) {
      var tpl = document.createElement('template');
      tpl.innerHTML = ICONS[name];
      iconCache[name] = tpl.content.firstElementChild;
    }
    return iconCache[name].cloneNode(true);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null && text !== '') node.textContent = text;
    return node;
  }

  /** "English / සිංහල", skipping whichever half is missing. */
  function bilingual(en, si) {
    var parts = [];
    if (en) parts.push(String(en).trim());
    if (si) parts.push(String(si).trim());
    return parts.join(' / ');
  }

  /* ---------------------------------------------------------------
     Time formatting — the single place display strings are produced,
     which is what keeps separators and 12h/24h consistent.
     --------------------------------------------------------------- */
  function formatClock(value, timeFormat) {
    if (!value) return '';
    var bits = String(value).split(':');
    var h = parseInt(bits[0], 10);
    var m = bits[1] || '00';
    if (isNaN(h)) return '';
    if (timeFormat === '12h') {
      var suffix = h >= 12 ? 'PM' : 'AM';
      var h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return (h12 < 10 ? '0' : '') + h12 + ':' + m + ' ' + suffix;
    }
    return (h < 10 ? '0' : '') + h + ':' + m;
  }

  function formatTimeRange(slot, timeFormat) {
    var start = formatClock(slot.start_time, timeFormat);
    var end = formatClock(slot.end_time, timeFormat);
    var base = start && end ? start + ' — ' + end : (start || end || '');
    var note = bilingual(slot.time_note_en, slot.time_note_si);
    if (!note) return base;
    // "→ Next Day Morning" reads as a continuation, not a parenthetical
    if (/^(→|->)/.test(note)) return (base ? base + ' ' : '') + note;
    return base ? base + ' (' + note + ')' : '(' + note + ')';
  }

  function startHour(slot) {
    if (!slot.start_time) return null;
    var h = parseInt(String(slot.start_time).split(':')[0], 10);
    return isNaN(h) ? null : h;
  }

  /** Session badge colour: kind wins for seminar/discussion, else time of day. */
  function sessionColour(slot) {
    if (slot.kind === 'seminar' || slot.kind === 'discussion') {
      return KIND_ACCENT[slot.kind];
    }
    var h = startHour(slot);
    return h != null && h >= 12 ? '#2563eb' : '#f59e0b';
  }

  /* ---------------------------------------------------------------
     Rows
     --------------------------------------------------------------- */
  function renderSlot(slot, timeFormat) {
    var accent = KIND_ACCENT[slot.kind] || KIND_ACCENT.live;

    var row = el('div', 'timetable__row');
    if (slot.kind === 'seminar' || slot.kind === 'discussion') {
      row.classList.add('timetable__row--' + slot.kind);
    }

    /* left column */
    var day = el('div', 'timetable__day');
    day.appendChild(el('span', 'timetable__day-name', slot.day_en));
    if (slot.day_si) day.appendChild(el('span', 'timetable__day-si', slot.day_si));
    var session = bilingual(slot.session_badge_en, slot.session_badge_si);
    if (session) {
      var badge = el('span', 'timetable__day-session', session);
      badge.style.color = sessionColour(slot);
      day.appendChild(badge);
    }
    row.appendChild(day);

    /* right column */
    var info = el('div', 'timetable__info');

    var time = el('div', 'timetable__time');
    if (slot.seq_label) {
      time.appendChild(el('span', 'tt-slot tt-slot--amber', slot.seq_label));
    }
    var clock = icon('clock');
    if (clock) {
      clock.setAttribute('stroke', accent);
      time.appendChild(clock);
    }
    time.appendChild(document.createTextNode(' ' + formatTimeRange(slot, timeFormat)));
    info.appendChild(time);

    // A Sinhala continuation line only makes sense when it is not already
    // shown inline next to the time.
    if (slot.time_note_si && /^(→|->)/.test(String(slot.time_note_en || ''))) {
      var sub = el('div', null, slot.time_note_si);
      sub.style.fontSize = 'var(--fs-xs)';
      sub.style.color = 'var(--clr-text-500)';
      sub.style.marginTop = '0.1rem';
      info.appendChild(sub);
    }

    var type = el('div', 'timetable__type timetable__type--' + (slot.kind || 'live'));
    var kindIcon = icon(slot.kind || 'live');
    if (kindIcon) type.appendChild(kindIcon);
    var label = bilingual(slot.label_en, slot.label_si);
    if (label) type.appendChild(document.createTextNode(' ' + label));
    var optional = bilingual(slot.optional_note_en, slot.optional_note_si);
    if (optional) {
      type.appendChild(el('span', 'timetable__optional', '(' + optional + ')'));
    }

    if (slot.platform) {
      var meta = el('div', 'timetable__meta');
      meta.appendChild(type);
      var pill = el('div', 'tt-platform-badge tt-platform-badge--' + slot.platform);
      var pIcon = icon(PLATFORM_ICON[slot.platform]);
      if (pIcon) pill.appendChild(pIcon);
      pill.appendChild(document.createTextNode(
        ' ' + (PLATFORM_LABEL[slot.platform] || slot.platform)));
      meta.appendChild(pill);
      info.appendChild(meta);
    } else {
      info.appendChild(type);
    }

    row.appendChild(info);
    return row;
  }

  /* ---------------------------------------------------------------
     Sections
     --------------------------------------------------------------- */
  function renderSection(section, slots, timeFormat) {
    var wrap = el('div', 'tt-section tt-section--' + section.theme);

    var header = el('div', 'tt-section__header');
    var iconBox = el('div', 'tt-section__header-icon');
    var sIcon = icon(SECTION_ICONS[section.theme] || 'live');
    if (sIcon) {
      sIcon.setAttribute('width', '16');
      sIcon.setAttribute('height', '16');
      sIcon.setAttribute('stroke', '#fff');
      sIcon.removeAttribute('style');
      iconBox.appendChild(sIcon);
    }
    header.appendChild(iconBox);

    var textBox = el('div', 'tt-section__header-text');
    textBox.appendChild(el('span', 'tt-section__header-title',
      bilingual(section.title_en, section.title_si)));
    var sub = bilingual(section.subtitle_en, section.subtitle_si);
    if (sub) textBox.appendChild(el('span', 'tt-section__header-subtitle', sub));
    header.appendChild(textBox);
    wrap.appendChild(header);

    var body = el('div', 'tt-section__body');
    var desc = bilingualBlock(section.body_si, section.body_en);
    if (desc) {
      var d = el('div', 'tt-section__desc');
      appendLines(d, desc);
      body.appendChild(d);
    }
    var note = bilingualBlock(section.note_si, section.note_en);
    if (note) {
      var n = el('div', 'tt-section__note');
      var nIcon = icon('sectionNote');
      if (nIcon) n.appendChild(nIcon);
      var span = el('span');
      appendLines(span, note);
      n.appendChild(span);
      body.appendChild(n);
    }

    var table = el('div', 'timetable');
    slots.forEach(function (slot) {
      table.appendChild(renderSlot(slot, timeFormat));
    });
    body.appendChild(table);

    wrap.appendChild(body);
    return wrap;
  }

  /** Descriptions read Sinhala first, then English, on separate lines. */
  function bilingualBlock(first, second) {
    var lines = [];
    if (first) lines.push(String(first).trim());
    if (second) lines.push(String(second).trim());
    return lines.length ? lines : null;
  }

  function appendLines(target, lines) {
    lines.forEach(function (line, i) {
      if (i > 0) target.appendChild(document.createElement('br'));
      target.appendChild(document.createTextNode(line));
    });
  }

  /* ---------------------------------------------------------------
     Notes / info blocks
     --------------------------------------------------------------- */
  function renderNote(note) {
    if (note.variant === 'zoom') {
      var zoom = el('div', 'zoom-badge');
      var zIcon = icon('zoomNote');
      if (zIcon) zoom.appendChild(zIcon);
      zoom.appendChild(document.createTextNode(
        ' ' + bilingual(note.body_si, note.body_en)));
      return zoom;
    }

    var block = el('div', 'info-block' + (note.variant === 'warning' ? ' info-block--warning' : ''));
    var title = bilingual(note.title_si, note.title_en);
    if (title) {
      var t = el('div', 'info-block__title');
      if (note.variant === 'warning') {
        var wIcon = icon('warningNote');
        if (wIcon) t.appendChild(wIcon);
        t.appendChild(document.createTextNode(' ' + title));
      } else {
        t.textContent = title;
      }
      block.appendChild(t);
    }
    var body = bilingual(note.body_si, note.body_en);
    if (body) {
      var p = el('p', null, body);
      p.style.fontSize = 'var(--fs-sm)';
      p.style.color = 'var(--clr-text-600)';
      p.style.margin = '0';
      block.appendChild(p);
    }
    return block;
  }

  /* ---------------------------------------------------------------
     Public entry points
     --------------------------------------------------------------- */

  /**
   * Render a timetable's rows (and sections) into `container`, replacing
   * whatever is there. `container` keeps the `timetable` class only when the
   * timetable has no sections of its own.
   */
  function renderTimetable(container, data) {
    var timeFormat = data.time_format || '24h';
    var sections = data.timetable_sections || [];
    var slots = data.class_slots || [];

    container.textContent = '';

    if (!sections.length) {
      container.classList.add('timetable');
      slots.forEach(function (slot) {
        container.appendChild(renderSlot(slot, timeFormat));
      });
      return container;
    }

    container.classList.remove('timetable');
    sections.forEach(function (section) {
      var owned = slots.filter(function (s) { return s.section_id === section.id; });
      container.appendChild(renderSection(section, owned, timeFormat));
    });
    // Slots that belong to no section still need somewhere to go.
    var orphans = slots.filter(function (s) { return !s.section_id; });
    if (orphans.length) {
      var table = el('div', 'timetable');
      orphans.forEach(function (slot) {
        table.appendChild(renderSlot(slot, timeFormat));
      });
      container.appendChild(table);
    }
    return container;
  }

  /** Render the notes for one position ('above' | 'below') into a container. */
  function renderNotes(container, data, position) {
    container.textContent = '';
    (data.timetable_notes || [])
      .filter(function (n) { return (n.position || 'below') === position; })
      .forEach(function (n) { container.appendChild(renderNote(n)); });
    return container;
  }

  global.PAICTTimetableRender = {
    renderTimetable: renderTimetable,
    renderNotes: renderNotes,
    renderSlot: renderSlot,
    renderNote: renderNote,
    formatTimeRange: formatTimeRange,
    formatClock: formatClock,
    bilingual: bilingual,
    icon: icon
  };
})(window);
