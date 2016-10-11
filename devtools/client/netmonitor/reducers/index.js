/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const I = require("devtools/client/shared/vendor/immutable");
const { getSelectedRequest } = require("../selectors/index");
const filters = require("./filters");
const sidebar = require("./sidebar");
const timingMarkers = require("./timing-markers");
const { ADD_REQUEST,
        UPDATE_REQUEST,
        CLEAR_REQUESTS,
        CLONE_SELECTED_REQUEST,
        REMOVE_SELECTED_CUSTOM_REQUEST,
        SELECT_ITEM,
        PRESELECT_ITEM,
        SORT_BY,
        SHOW_SIDEBAR,
        WATERFALL_RESIZE } = require("../constants");

const UPDATE_PROPS = [
  "method",
  "url",
  "remotePort",
  "remoteAddress",
  "status",
  "statusText",
  "httpVersion",
  "securityState",
  "securityInfo",
  "mimeType",
  "contentSize",
  "transferredSize",
  "totalTime",
  "eventTimings",
  "headersSize",
  "requestHeaders",
  "requestHeadersFromUploadStream",
  "requestCookies",
  "requestPostData",
  "responseHeaders",
  "responseCookies",
  "responseContent",
  "responseContentDataUri"
];

// Safe bounds for waterfall width (px)
const REQUESTS_WATERFALL_SAFE_BOUNDS = 90;

const SortBy = I.Record({
  // null means: sort by "waterfall", but don't highlight the table header
  type: null,
  ascending: true,
});

const Request = I.Record({
  id: null,
  // Set to true in case of a request that's being edited as part of "edit and resend"
  isCustom: false,
  // Request properties - at the beginning, they are unknown and are gradually filled in
  startedMillis: undefined,
  endedMillis: undefined,
  startedDeltaMillis: undefined,
  method: undefined,
  url: undefined,
  remotePort: undefined,
  remoteAddress: undefined,
  isXHR: undefined,
  cause: undefined,
  fromCache: undefined,
  fromServiceWorker: undefined,
  status: undefined,
  statusText: undefined,
  httpVersion: undefined,
  securityState: undefined,
  securityInfo: undefined,
  mimeType: undefined,
  contentSize: undefined,
  transferredSize: undefined,
  totalTime: undefined,
  eventTimings: undefined,
  headersSize: undefined,
  requestHeaders: undefined,
  requestHeadersFromUploadStream: undefined,
  requestCookies: undefined,
  requestPostData: undefined,
  responseHeaders: undefined,
  responseCookies: undefined,
  responseContent: undefined,
  responseContentDataUri: undefined,
});

const AppState = I.Record({
  requests: I.List(),
  firstRequestStartedMillis: -1,
  lastRequestEndedMillis: -1,
  selectedItem: null,
  preselectedItem: null,
  timingMarkers: undefined,
  filters: undefined,
  sidebar: undefined,
  sortBy: new SortBy(),
  waterfallWidth: 300,
});

const reducer = (state = new AppState(), action) => {
  state = state.set("filters", filters(state.filters, action));
  state = state.set("sidebar", sidebar(state.sidebar, action));
  state = state.set("timingMarkers", timingMarkers(state.timingMarkers, action));

  switch (action.type) {
    case ADD_REQUEST: {
      let { startedMillis } = action.data;
      let { requests,
            firstRequestStartedMillis,
            lastRequestEndedMillis,
            selectedItem,
            preselectedItem } = state;

      // Update the first/last timestamps
      if (firstRequestStartedMillis == -1) {
        firstRequestStartedMillis = startedMillis;
      }
      if (startedMillis > lastRequestEndedMillis) {
        lastRequestEndedMillis = startedMillis;
      }

      let startedDeltaMillis = startedMillis - firstRequestStartedMillis;

      let newRequest = new Request(Object.assign({
        id: action.id,
        startedDeltaMillis
      }, action.data));

      return state.withMutations(st => {
        st.set("requests", requests.push(newRequest));
        st.set("firstRequestStartedMillis", firstRequestStartedMillis);
        st.set("lastRequestEndedMillis", lastRequestEndedMillis);
        st.set("selectedItem", preselectedItem || selectedItem);
        st.remove("preselectedItem");
      });
    }

    case UPDATE_REQUEST: {
      let { requests, lastRequestEndedMillis } = state;

      let updateIdx = requests.findIndex(r => r.id == action.id);
      if (updateIdx == -1) {
        return state;
      }

      requests = requests.update(updateIdx, request => {
        for (let [key, value] of Object.entries(action.data)) {
          if (UPDATE_PROPS.includes(key)) {
            let newData = I.Map([[key, value]]);

            switch (key) {
              case "responseContent":
                // If there's no mime type available when the response content
                // is received, assume text/plain as a fallback.
                if (!request.mimeType) {
                  newData.set("mimeType", "text/plain");
                }
                break;
              case "totalTime":
                let endedMillis = request.startedMillis + value;
                newData.set("endedMillis", endedMillis);
                lastRequestEndedMillis = Math.max(lastRequestEndedMillis, endedMillis);
                break;
              case "requestPostData":
                newData.set("requestHeadersFromUploadStream", {
                  headers: [],
                  headersSize: 0
                });
                break;
            }

            request = request.merge(newData);
          }
        }

        return request;
      });

      return state.withMutations(record => {
        record.set("requests", requests);
        record.set("lastRequestEndedMillis", lastRequestEndedMillis);
      });
    }
    case CLONE_SELECTED_REQUEST: {
      let { requests, selectedItem } = state;

      if (!selectedItem) {
        return state;
      }

      let clonedIdx = requests.findIndex(r => r.id == selectedItem);
      if (clonedIdx == -1) {
        return state;
      }

      let clonedRequest = requests.get(clonedIdx);
      let newRequest = new Request({
        id: clonedRequest.id + "-clone",
        method: clonedRequest.method,
        url: clonedRequest.url,
        requestHeaders: clonedRequest.requestHeaders,
        requestPostData: clonedRequest.requestPostData,
        isCustom: true
      });

      // Insert the clone right after the original. This ensures that the requests
      // are always sorted next to each other, even when multiple requests are
      // equal according to the sorting criteria.
      requests = requests.insert(clonedIdx + 1, newRequest);

      return state.withMutations(record => {
        record.set("requests", requests);
        record.set("selectedItem", newRequest.id);
      });
    }
    case REMOVE_SELECTED_CUSTOM_REQUEST: {
      let selectedRequest = getSelectedRequest(state);
      if (!selectedRequest) {
        return state;
      }

      // Only custom requests can be removed
      if (!selectedRequest.isCustom) {
        return state;
      }

      return state.withMutations(st => {
        st.set("requests", state.requests.filter(r => r !== selectedRequest));
        st.remove("selectedItem");
      });
    }
    case CLEAR_REQUESTS: {
      return state.withMutations(record => {
        record.remove("requests");
        record.remove("selectedItem");
        record.remove("preselectedItem");
        record.remove("firstRequestStartedMillis");
        record.remove("lastRequestEndedMillis");
      });
    }
    case SORT_BY: {
      let { type, ascending } = state.sortBy;
      let newSortBy = state.sortBy
        .set("type", action.sortType)
        .set("ascending", type == action.sortType ? !ascending : true);
      return state.set("sortBy", newSortBy);
    }
    case PRESELECT_ITEM: {
      return state.set("preselectedItem", action.id);
    }
    case SELECT_ITEM: {
      return state.set("selectedItem", action.id);
    }
    case SHOW_SIDEBAR: {
      if (action.visible) {
        const { selectedItem, requests } = state;
        if (!selectedItem && !requests.isEmpty()) {
          return state.set("selectedItem", requests.get(0).id);
        }
        return state;
      }
      return state.set("selectedItem", null);
    }
    case WATERFALL_RESIZE: {
      return state.set("waterfallWidth", action.width - REQUESTS_WATERFALL_SAFE_BOUNDS);
    }
    default:
      return state;
  }
};

module.exports = reducer;
