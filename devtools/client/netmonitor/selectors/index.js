/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { createSelector } = require("devtools/client/shared/vendor/reselect");
const { Filters, isFreetextMatch } = require("../filter-predicates");
const { Sorters } = require("../sort-predicates");

/**
 * Check if the given requests is a clone, find and return the original request if it is.
 * Cloned requests are sorted by comparing the original ones.
 */
function getOrigRequest(requests, req) {
  if (!req.id.endsWith("-clone")) {
    return req;
  }

  const origId = req.id.replace(/-clone$/, "");
  return requests.find(r => r.id === origId);
}

const getFilterFn = createSelector(
  state => state.filters,
  filters => r => {
    const matchesType = filters.types.some((enabled, filter) => {
      return enabled && Filters[filter] && Filters[filter](r);
    });
    return matchesType && isFreetextMatch(r, filters.text);
  }
);

const getSortFn = createSelector(
  state => state.requests,
  state => state.sortBy,
  (requests, sortBy) => {
    let dataSorter = Sorters[sortBy.type || "waterfall"];

    function sortWithClones(a, b) {
      // If one request is a clone of the other, sort them next to each other
      if (a.id == b.id + "-clone") {
        return +1;
      } else if (a.id + "-clone" == b.id) {
        return -1;
      }

      // Otherwise, get the original requests and compare them
      return dataSorter(
        getOrigRequest(requests, a),
        getOrigRequest(requests, b)
      );
    }

    const ascending = sortBy.ascending ? +1 : -1;
    return (a, b) => ascending * sortWithClones(a, b, dataSorter);
  }
);

const getSortedRequests = createSelector(
  state => state.requests,
  getSortFn,
  (requests, sortFn) => requests.sort(sortFn)
);

const getDisplayedRequests = createSelector(
  state => state.requests,
  getFilterFn,
  getSortFn,
  (requests, filterFn, sortFn) => requests.filter(filterFn).sort(sortFn)
);

const getDisplayedRequestsSummary = createSelector(
  getDisplayedRequests,
  (requests) => {
    if (requests.size == 0) {
      return { count: 0, bytes: 0, millis: 0 };
    }

    const totalBytes = requests.reduce((total, item) => {
      let size = item.contentSize;
      return total + (typeof size == "number" ? size : 0);
    }, 0);

    const oldestRequest = requests.reduce(
      (prev, curr) => prev.startedMillis < curr.startedMillis ? prev : curr);
    const newestRequest = requests.reduce(
      (prev, curr) => prev.startedMillis > curr.startedMillis ? prev : curr);

    return {
      count: requests.size,
      bytes: totalBytes,
      millis: newestRequest.endedMillis - oldestRequest.startedMillis,
    };
  }
);

function getRequestById(state, id) {
  return state.requests.find(r => r.id === id);
}

function getDisplayedRequestById(state, id) {
  return getDisplayedRequests(state).find(r => r.id === id);
}

function getRequestIndexById(state, id) {
  return getDisplayedRequests(state).findIndex(r => r.id === id);
}

function getSelectedRequest(state) {
  if (!state.selectedItem) {
    return null;
  }

  return getRequestById(state, state.selectedItem);
}

function getActiveFilters(state) {
  return state.filters.types.toSeq().filter(checked => checked).keySeq().toArray();
}

const isSidebarToggleButtonDisabled = createSelector(
  getDisplayedRequests,
  requests => requests.isEmpty()
);

const EPSILON = 0.001;

function getWaterfallScale(state) {
  if (state.firstRequestStartedMillis == -1 || state.lastRequestEndedMillis == -1) {
    return null;
  }

  let longestWidth = state.lastRequestEndedMillis - state.firstRequestStartedMillis;
  return Math.min(Math.max(state.waterfallWidth / longestWidth, EPSILON), 1);
}

module.exports = {
  getSortedRequests,
  getDisplayedRequests,
  getDisplayedRequestsSummary,
  getRequestById,
  getRequestIndexById,
  getDisplayedRequestById,
  getSelectedRequest,
  getActiveFilters,
  getWaterfallScale,
  isSidebarToggleButtonDisabled,
};
