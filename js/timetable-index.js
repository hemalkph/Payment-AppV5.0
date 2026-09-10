/**
 * PA ICT Academy — dynamic timetable discovery for the hub pages.
 *
 * Year tabs and location cards are generated from the published timetables in
 * Supabase, so publishing a brand-new one (a new year, or a new location such
 * as "2029-kandy") surfaces it on the site without anyone adding an HTML page.
 *
 * The links already written into the pages stay as the fallback: they are only
 * replaced once real data arrives, exactly like the timetable rows themselves.
 *
 * Mount points:
 *   [data-timetable-index="online"]              year tabs for online classes
 *   [data-timetable-index="location:<key>"]      year tabs for one location
 *   [data-timetable-locations]                   cards for every location
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'paict_timetable_index';
  var FETCH_TIMEOUT_MS = 8000;

  function readCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && Array.isArray(parsed.rows) ? parsed.rows : null;
    } catch (err) {
      return null;
    }
  }

  function writeCache(rows) {
    try {
      global.localStorage.setItem(CACHE_KEY,
        JSON.stringify({ rows: rows, cached_at: Date.now() }));
    } catch (err) {
      /* best effort */
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function labelFor(row) {
    return (row.subtitle_en && row.subtitle_en.trim()) || 'A/L';
  }

  /** Year tabs, matching the existing .year-tab markup. */
  function renderYearTabs(mount, rows) {
    if (!rows.length) return;
    mount.textContent = '';
    rows.sort(function (a, b) { return a.year - b.year; });
    rows.forEach(function (row, i) {
      var tab = el('a', 'year-tab' + (i === 0 ? ' active' : ''));
      tab.href = '/timetables/' + row.slug;
      tab.appendChild(el('span', 'year-tab__year', String(row.year)));
      tab.appendChild(el('span', 'year-tab__label', labelFor(row)));
      mount.appendChild(tab);
    });
  }

  /**
   * Append a card for any location that has published timetables but no card
   * already on the page. Existing cards are left untouched.
   */
  function renderExtraLocations(mount, rows) {
    var known = {};
    Array.prototype.forEach.call(
      mount.querySelectorAll('[data-location-key]'),
      function (node) { known[node.getAttribute('data-location-key')] = true; }
    );
    Array.prototype.forEach.call(mount.querySelectorAll('a[href]'), function (a) {
      var slug = a.getAttribute('href').replace(/^\//, '');
      if (slug) known[slug] = true;
    });

    var seen = {};
    rows.forEach(function (row) {
      if (row.mode !== 'physical' || !row.location_key) return;
      if (known[row.location_key] || seen[row.location_key]) return;
      seen[row.location_key] = true;

      var name = row.location_key.charAt(0).toUpperCase() + row.location_key.slice(1);
      // Match the markup of the cards already on the page.
      var card = el('div', 'glass-card reveal visible');
      card.style.textAlign = 'center';
      card.setAttribute('data-location-key', row.location_key);
      card.appendChild(el('h3', 'lang-card__title', name));
      var years = rows
        .filter(function (r) { return r.location_key === row.location_key; })
        .map(function (r) { return r.year; })
        .sort()
        .join(', ');
      card.appendChild(el('p', 'lang-card__desc', years + ' A/L Classes'));
      var link = el('a', 'btn btn--primary', 'View Classes / පන්ති බලන්න');
      link.href = '/timetables/' + row.slug;
      card.appendChild(link);
      mount.appendChild(card);
    });
  }

  function apply(rows) {
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-timetable-index]'),
      function (mount) {
        var spec = mount.getAttribute('data-timetable-index');
        var matches;
        if (spec === 'online') {
          matches = rows.filter(function (r) { return r.mode === 'online'; });
        } else if (spec.indexOf('location:') === 0) {
          var key = spec.slice('location:'.length);
          matches = rows.filter(function (r) { return r.location_key === key; });
        } else {
          return;
        }
        renderYearTabs(mount, matches);
      }
    );

    var locations = document.querySelector('[data-timetable-locations]');
    if (locations) renderExtraLocations(locations, rows);
  }

  function init() {
    if (!document.querySelector('[data-timetable-index], [data-timetable-locations]')) return;
    var api = global.PAICTSupabase;
    if (!api) return;

    api.fetchTimetableIndex({ timeoutMs: FETCH_TIMEOUT_MS })
      .then(function (rows) {
        if (!rows || !rows.length) return;
        apply(rows);
        writeCache(rows);
      })
      .catch(function () {
        var cached = readCache();
        if (cached && cached.length) apply(cached);
        // otherwise the links already in the page stand
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
