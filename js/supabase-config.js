/**
 * PA ICT Academy — Supabase connection + timetable data access.
 *
 * The publishable key is meant to be public; all protection comes from the
 * Row Level Security policies on the database (anon may read published rows
 * only, and may not write at all). The service-role key must never appear
 * in browser code.
 *
 * Public pages use the plain REST endpoint below so they pull in no
 * dependencies. Only admin.html loads supabase-js, because it needs auth.
 */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://lbydjpqgrnmlvhblrwcl.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oKz5ApQ3OsRQtjfhZVF7VA_zIVB_gMb';

  var REST = SUPABASE_URL + '/rest/v1';

  /** Columns pulled for a full timetable render, including children. */
  var TIMETABLE_SELECT = [
    '*',
    'timetable_sections(*)',
    'class_slots(*)',
    'timetable_notes(*)'
  ].join(',');

  function restUrl(path, params) {
    var url = REST + path;
    var qs = Object.keys(params || {})
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      })
      .join('&');
    return qs ? url + '?' + qs : url;
  }

  /**
   * GET against PostgREST with the publishable key.
   * Rejects on a non-2xx response or a network failure, so callers can fall
   * back to cached / baked content.
   */
  function restGet(path, params, options) {
    var opts = options || {};
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (controller && opts.timeoutMs) {
      timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs);
    }
    return fetch(restUrl(path, params), {
      method: 'GET',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
        Accept: 'application/json'
      },
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('Supabase responded ' + res.status);
      return res.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  /** Sort children in place; the API does not guarantee embedded ordering. */
  function normalise(timetable) {
    function bySort(a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    }
    timetable.class_slots = (timetable.class_slots || []).filter(function (s) {
      return s.published !== false;
    }).sort(bySort);
    timetable.timetable_sections = (timetable.timetable_sections || []).filter(function (s) {
      return s.published !== false;
    }).sort(bySort);
    timetable.timetable_notes = (timetable.timetable_notes || []).filter(function (n) {
      return n.published !== false;
    }).sort(bySort);
    return timetable;
  }

  /** Fetch one published timetable with all of its children, by slug. */
  function fetchTimetable(slug, options) {
    return restGet('/timetables', {
      slug: 'eq.' + slug,
      select: TIMETABLE_SELECT,
      limit: 1
    }, options).then(function (rows) {
      if (!rows || !rows.length) {
        // The request succeeded, the row just isn't visible to visitors -
        // either unpublished (a retired batch) or deleted. Flagged so callers
        // can tell this apart from an outage: an outage should fall back to
        // cached/baked content, but a retired batch must NOT.
        var err = new Error('Timetable not available to visitors: ' + slug);
        err.notPublished = true;
        throw err;
      }
      return normalise(rows[0]);
    });
  }

  /** Fetch every published timetable (slug/year/mode only) for hub links. */
  function fetchTimetableIndex(options) {
    return restGet('/timetables', {
      select: 'slug,year,mode,location_key,title_en,title_si,subtitle_en,subtitle_si,sort_order',
      order: 'sort_order.asc'
    }, options);
  }

  global.PAICTSupabase = {
    url: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    restGet: restGet,
    fetchTimetable: fetchTimetable,
    fetchTimetableIndex: fetchTimetableIndex,
    normalise: normalise
  };
})(window);
