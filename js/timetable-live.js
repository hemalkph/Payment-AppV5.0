/**
 * PA ICT Academy — live timetable loading with a three-level fallback.
 *
 *   1. live Supabase data      (preferred; refreshes the cache)
 *   2. localStorage cache      (last known good copy for this visitor)
 *   3. the baked HTML already in the page
 *
 * The baked markup is never cleared until valid data has actually arrived,
 * so a paused or unreachable Supabase project can only ever leave the page
 * showing slightly older content — never an empty one. Visitors are shown no
 * error messages while any fallback is available.
 *
 * Mount points:
 *   [data-timetable="<slug>"]        rows / sections    ("auto" = read ?slug=)
 *   [data-timetable-notes="above"]   info blocks above the table
 *   [data-timetable-notes="below"]   info blocks below the table
 *   [data-timetable-title]           card title
 *   [data-timetable-subtitle]        card subtitle
 *   [data-timetable-updated]         optional "Last updated" line
 */
(function (global) {
  'use strict';

  var CACHE_PREFIX = 'paict_timetable_';
  var CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
  var FETCH_TIMEOUT_MS = 8000;

  function cacheKey(slug) { return CACHE_PREFIX + slug; }

  function readCache(slug) {
    try {
      var raw = global.localStorage.getItem(cacheKey(slug));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.timetable) return null;
      if (parsed.cached_at && Date.now() - parsed.cached_at > CACHE_TTL_MS) return null;
      return parsed;
    } catch (err) {
      return null; // private mode, blocked storage, corrupt entry
    }
  }

  function writeCache(slug, data) {
    try {
      global.localStorage.setItem(cacheKey(slug), JSON.stringify({
        timetable: shallowTimetable(data),
        slots: data.class_slots || [],
        sections: data.timetable_sections || [],
        notes: data.timetable_notes || [],
        cached_at: Date.now(),
        updated_at: data.updated_at || null
      }));
    } catch (err) {
      /* storage full or unavailable — caching is best-effort */
    }
  }

  function clearCache(slug) {
    try {
      global.localStorage.removeItem(cacheKey(slug));
    } catch (err) {
      /* nothing to do */
    }
  }

  function shallowTimetable(data) {
    var copy = {};
    Object.keys(data).forEach(function (k) {
      if (k !== 'class_slots' && k !== 'timetable_sections' && k !== 'timetable_notes') {
        copy[k] = data[k];
      }
    });
    return copy;
  }

  /** Rebuild the render-shaped object from a cache entry. */
  function fromCache(entry) {
    var data = entry.timetable || {};
    data.class_slots = entry.slots || [];
    data.timetable_sections = entry.sections || [];
    data.timetable_notes = entry.notes || [];
    return data;
  }

  function slugFromUrl() {
    var params = new URLSearchParams(global.location.search);
    var slug = params.get('slug');
    if (slug) return slug;
    // /timetables/<slug> (Vercel rewrite) — take the last path segment
    var parts = global.location.pathname.replace(/\/+$/, '').split('/');
    var last = parts[parts.length - 1];
    return last && last !== 'timetable' && last !== 'timetables' ? last : null;
  }

  function setText(selector, value) {
    var node = document.querySelector(selector);
    if (!node) return;
    if (value) {
      node.textContent = value;
      node.hidden = false;
    } else {
      node.textContent = '';
      node.hidden = true;
    }
  }

  /** Re-run the site's reveal animation, matching initLocationTabs(). */
  function refreshReveal(root) {
    var card = root.closest ? root.closest('.card') : null;
    if (!card) return;
    card.classList.remove('visible');
    requestAnimationFrame(function () {
      card.classList.add('reveal', 'visible');
    });
  }

  function applyData(mount, data) {
    var render = global.PAICTTimetableRender;
    render.renderTimetable(mount, data);

    var above = document.querySelector('[data-timetable-notes="above"]');
    if (above) render.renderNotes(above, data, 'above');
    var below = document.querySelector('[data-timetable-notes="below"]');
    if (below) render.renderNotes(below, data, 'below');

    setText('[data-timetable-title]', render.bilingual(data.title_en, data.title_si));
    setText('[data-timetable-subtitle]', render.bilingual(data.subtitle_en, data.subtitle_si));

    var stamp = document.querySelector('[data-timetable-updated]');
    if (stamp && data.updated_at) {
      var when = new Date(data.updated_at);
      if (!isNaN(when.getTime())) {
        stamp.textContent = 'Last updated ' + when.toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric'
        });
        stamp.hidden = false;
      }
    }

    if (document.title && data.title_en) {
      // keep the tab title in step when the page is the generic route
      if (mount.getAttribute('data-timetable') === 'auto') {
        document.title = data.title_en + ' — PA ICT Academy';
      }
    }

    refreshReveal(mount);
  }

  /** Build a centred notice using the site's existing .coming-soon component. */
  function notice(titleText, bodyText, linkText, linkHref) {
    var box = document.createElement('div');
    box.className = 'coming-soon';

    var h = document.createElement('h3');
    h.className = 'coming-soon__title';
    h.textContent = titleText;
    box.appendChild(h);

    var p = document.createElement('p');
    p.className = 'coming-soon__text';
    p.textContent = bodyText;
    box.appendChild(p);

    if (linkText) {
      var a = document.createElement('a');
      a.className = 'btn btn--primary';
      a.style.marginTop = '1.25rem';
      a.href = linkHref;
      a.textContent = linkText;
      box.appendChild(a);
    }
    return box;
  }

  function showEmptyState(mount) {
    // Only reached on the generic route, where there is no baked fallback.
    if (mount.childElementCount) return;
    mount.appendChild(notice(
      'Timetable unavailable / කාලසටහන නොමැත',
      'Please try again shortly, or return to the timetable list.',
      null, null
    ));
  }

  /**
   * The timetable exists in the page but is no longer published - a retired
   * batch, switched off from the admin panel. The baked fallback rows MUST be
   * cleared here: leaving them would keep serving a finished batch's schedule
   * on its old URL forever.
   */
  function showRetired(mount, slug) {
    clearCache(slug);

    mount.textContent = '';
    mount.classList.remove('timetable');
    mount.appendChild(notice(
      'Classes completed / පන්ති අවසන්',
      'This batch has finished, so its timetable is no longer shown. '
        + 'මෙම කණ්ඩායමේ පන්ති අවසන් වී ඇත.',
      'View current timetables / වත්මන් කාලසටහන්',
      '/times'
    ));

    ['[data-timetable-notes="above"]', '[data-timetable-notes="below"]'].forEach(
      function (sel) {
        var node = document.querySelector(sel);
        if (node) node.textContent = '';
      }
    );
    var stamp = document.querySelector('[data-timetable-updated]');
    if (stamp) stamp.hidden = true;
    var subtitle = document.querySelector('[data-timetable-subtitle]');
    if (subtitle) { subtitle.textContent = ''; subtitle.hidden = true; }

    refreshReveal(mount);
  }

  function loadInto(mount) {
    var slug = mount.getAttribute('data-timetable');
    if (slug === 'auto') slug = slugFromUrl();
    if (!slug) { showEmptyState(mount); return; }

    var api = global.PAICTSupabase;
    if (!api) return;

    api.fetchTimetable(slug, { timeoutMs: FETCH_TIMEOUT_MS })
      .then(function (data) {
        applyData(mount, data);
        writeCache(slug, data);
      })
      .catch(function (error) {
        // Deliberately hidden, not an outage: never fall back to stale content.
        if (error && error.notPublished) {
          showRetired(mount, slug);
          return;
        }
        var cached = readCache(slug);
        if (cached) {
          try {
            applyData(mount, api.normalise(fromCache(cached)));
            return;
          } catch (err) {
            /* fall through to the baked markup */
          }
        }
        // Tier 3: leave whatever is already in the page untouched.
        showEmptyState(mount);
      });
  }

  function init() {
    var mounts = document.querySelectorAll('[data-timetable]');
    if (!mounts.length) return;
    Array.prototype.forEach.call(mounts, loadInto);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PAICTTimetableLive = {
    init: init, readCache: readCache, writeCache: writeCache, clearCache: clearCache
  };
})(window);
