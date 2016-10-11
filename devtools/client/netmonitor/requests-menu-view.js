/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals document, window, dumpn, $, gNetwork, EVENTS, Prefs,
           NetMonitorController, NetMonitorView */
/* eslint-disable mozilla/reject-some-requires */

"use strict";

const {DeferredTask} = require("resource://gre/modules/DeferredTask.jsm");
const {HTMLTooltip} = require("devtools/client/shared/widgets/tooltip/HTMLTooltip");
const {setNamedTimeout} = require("devtools/client/shared/widgets/view-helpers");
const {CurlUtils} = require("devtools/client/shared/curl");
const {PluralForm} = require("devtools/shared/plural-form");
const {L10N} = require("./l10n");
const {formDataURI,
       writeHeaderText,
       loadCauseString} = require("./request-utils");
const {EVENTS} = require("./events");
const { createElement, createFactory } = require("devtools/client/shared/vendor/react");
const ReactDOM = require("devtools/client/shared/vendor/react-dom");
const { Provider } = require("devtools/client/shared/vendor/react-redux");
const RequestList = createFactory(require("./components/request-list"));
const RequestListContextMenu = require("./request-list-context-menu");
const Actions = require("./actions/index");
const {getActiveFilters,
       getSortedRequests,
       getDisplayedRequests,
       getDisplayedRequestsSummary,
       getRequestById,
       getSelectedRequest} = require("./selectors/index");

loader.lazyRequireGetter(this, "NetworkHelper",
  "devtools/shared/webconsole/network-helper");

// ms
const RESIZE_REFRESH_RATE = 50;
// ms
const REQUESTS_REFRESH_RATE = 50;

const REQUEST_TIME_DECIMALS = 2;
const CONTENT_SIZE_DECIMALS = 2;

// A smart store watcher to notify store changes as necessary
function storeWatcher(initialValue, reduceValue, onChange) {
  let currentValue = initialValue;

  return () => {
    const oldValue = currentValue;
    const newValue = reduceValue(currentValue);
    if (newValue !== oldValue) {
      currentValue = newValue;
      onChange(newValue, oldValue);
    }
  };
}

/**
 * Functions handling the requests menu (containing details about each request,
 * like status, method, file, domain, as well as a waterfall representing
 * timing information).
 */
function RequestsMenuView() {
  dumpn("RequestsMenuView was instantiated");
}

RequestsMenuView.prototype = {
  /**
   * Initialization function, called when the network monitor is started.
   */
  initialize: function (store) {
    dumpn("Initializing the RequestsMenuView");

    // this.allowFocusOnRightClick = true;
    // this.maintainSelectionVisible = true;

    this.store = store;

    this.contextMenu = new RequestListContextMenu();

    Prefs.filters.forEach(type => store.dispatch(Actions.toggleFilterType(type)));

    // Watch selection changes
    this.store.subscribe(storeWatcher(
      null,
      () => getSelectedRequest(this.store.getState()),
      (newSelected, oldSelected) => this.onSelectionUpdate(newSelected, oldSelected)
    ));

    // Watch the request stats and update on change
    this.store.subscribe(storeWatcher(
      { count: 0, bytes: 0, millis: 0 },
      summary => {
        const newSummary = getDisplayedRequestsSummary(this.store.getState());
        const hasChanged = (summary.count !== newSummary.count ||
                            summary.bytes !== newSummary.bytes ||
                            summary.millis !== newSummary.millis);
        return hasChanged ? newSummary : summary;
      },
      summary => this.onSummaryUpdate(summary)
    ));

    this._addQueue = [];
    this._updateQueue = [];
    this.flushRequestsTask = new DeferredTask(
      this.flushRequests.bind(this), REQUESTS_REFRESH_RATE);

    this._onContextPerfCommand = () => NetMonitorView.toggleFrontendMode();

    this.sendCustomRequestEvent = this.sendCustomRequest.bind(this);
    this.closeCustomRequestEvent = this.closeCustomRequest.bind(this);
    this.cloneSelectedRequestEvent = this.cloneSelectedRequest.bind(this);
    this.toggleRawHeadersEvent = this.toggleRawHeaders.bind(this);

    $("#toggle-raw-headers")
      .addEventListener("click", this.toggleRawHeadersEvent, false);

    this._summary = $("#requests-menu-network-summary-button");
    this._summary.setAttribute("label", L10N.getStr("networkMenu.empty"));

    this.onResize = this.onResize.bind(this);
    this._splitter = $("#network-inspector-view-splitter");
    this._splitter.addEventListener("mousemove", this.onResize, false);
    window.addEventListener("resize", this.onResize, false);

    this.tooltip = new HTMLTooltip(NetMonitorController._toolbox.doc, { type: "arrow" });

    this.mountPoint = document.getElementById("network-table");
    ReactDOM.render(createElement(Provider,
      { store: this.store },
      RequestList()
    ), this.mountPoint);

    window.once("connected", this._onConnect.bind(this));
  },

  _onConnect() {
    if (NetMonitorController.supportsCustomRequest) {
      $("#custom-request-send-button")
        .addEventListener("click", this.sendCustomRequestEvent, false);
      $("#custom-request-close-button")
        .addEventListener("click", this.closeCustomRequestEvent, false);
      $("#headers-summary-resend")
        .addEventListener("click", this.cloneSelectedRequestEvent, false);
    } else {
      $("#headers-summary-resend").hidden = true;
    }

    $("#requests-menu-network-summary-button")
      .addEventListener("command", this._onContextPerfCommand, false);
    $("#network-statistics-back-button")
      .addEventListener("command", this._onContextPerfCommand, false);
  },

  /**
   * Destruction function, called when the network monitor is closed.
   */
  destroy() {
    dumpn("Destroying the RequestsMenuView");

    Prefs.filters = getActiveFilters(this.store.getState());

    this.flushRequestsTask.disarm();

    $("#custom-request-send-button")
      .removeEventListener("click", this.sendCustomRequestEvent, false);
    $("#custom-request-close-button")
      .removeEventListener("click", this.closeCustomRequestEvent, false);
    $("#headers-summary-resend")
      .removeEventListener("click", this.cloneSelectedRequestEvent, false);
    $("#toggle-raw-headers")
      .removeEventListener("click", this.toggleRawHeadersEvent, false);

    this._splitter.removeEventListener("mousemove", this.onResize, false);
    window.removeEventListener("resize", this.onResize, false);

    this.tooltip.destroy();

    ReactDOM.unmountComponentAtNode(this.mountPoint);
  },

  /**
   * Resets this container (removes all the networking information).
   */
  reset() {
    this.clear();
    this._addQueue = [];
    this._updateQueue = [];
  },

  /**
   * Removes all network requests and closes the sidebar if open.
   */
  clear() {
    this.store.dispatch(Actions.clearRequests());
  },

  addRequest(id, data) {
    let { method, url, isXHR, cause, startedDateTime, fromCache,
          fromServiceWorker } = data;

    // Convert the received date/time string to a unix timestamp.
    let startedMillis = Date.parse(startedDateTime);

    // Convert the cause from a Ci.nsIContentPolicy constant to a string
    if (cause) {
      let type = loadCauseString(cause.type);
      cause = Object.assign({}, cause, { type });
    }

    this._addQueue.push(Actions.addRequest(id, {
      startedMillis,
      method,
      url,
      isXHR,
      cause,
      fromCache,
      fromServiceWorker
    }));

    this.scheduleFlushRequests();
  },

  updateRequest(id, data, callback) {
    this._updateQueue.push([Actions.updateRequest(id, data), callback]);
    this.scheduleFlushRequests();
  },

  /**
   * Specifies if this view may be updated lazily.
   */
  _lazyUpdate: true,

  get lazyUpdate() {
    return this._lazyUpdate;
  },

  set lazyUpdate(value) {
    this._lazyUpdate = value;
    if (!value) {
      this.flushRequests();
    }
  },

  scheduleFlushRequests() {
    // Lazy updating is disabled in some tests.
    if (!this.lazyUpdate) {
      this.flushRequests();
    } else {
      this.flushRequestsTask.arm();
    }
  },

  flushRequests() {
    // Prevent displaying any updates received after the target closed.
    if (NetMonitorView._isDestroyed) {
      return;
    }

    let addActions = this._addQueue;
    let updateActions = this._updateQueue.map(([action]) => action);
    this.store.dispatch(Actions.batchActions([...addActions, ...updateActions]));

    for (let action of this._addQueue) {
      window.emit(EVENTS.REQUEST_ADDED, action.id);
    }

    for (let [action, callback] of this._updateQueue) {
      // Fetch response data if the response is an image (to display thumbnail)
      if (action.data.responseContent) {
        let request = getRequestById(this.store.getState(), action.id);
        if (request) {
          let { mimeType } = request;
          if (mimeType.includes("image/")) {
            let { text, encoding } = action.data.responseContent.content;
            gNetwork.getString(text).then(responseBody => {
              const dataUri = formDataURI(mimeType, encoding, responseBody);
              this.store.dispatch(Actions.updateRequest(action.id, {
                responseContentDataUri: dataUri
              }));
              window.emit(EVENTS.RESPONSE_IMAGE_THUMBNAIL_DISPLAYED);
            });
          }
        }
      }

      // Search the POST data upload stream for request headers and add
      // them as a separate property, different from the classic headers.
      if (action.data.requestPostData) {
        let { text } = action.data.requestPostData.postData;
        gNetwork.getString(text).then(postData => {
          const headers = CurlUtils.getHeadersFromMultipartText(postData);
          const headersSize = headers.reduce((acc, { name, value }) => {
            return acc + name.length + value.length + 2;
          }, 0);
          this.store.dispatch(Actions.updateRequest(action.id, {
            requestHeadersFromUploadStream: { headers, headersSize }
          }));
        });
      }

      callback && callback();
    }

    this._addQueue = [];
    this._updateQueue = [];
  },

  sortBy(type = "waterfall") {
    this.store.dispatch(Actions.sortBy(type));
  },

  get items() {
    return getSortedRequests(this.store.getState());
  },

  get visibleItems() {
    return getDisplayedRequests(this.store.getState());
  },

  get itemCount() {
    return this.store.getState().requests.size;
  },

  getItemAtIndex(index) {
    return getSortedRequests(this.store.getState()).get(index);
  },

  get selectedIndex() {
    const state = this.store.getState();
    if (!state.selectedItem) {
      return -1;
    }
    return getSortedRequests(state).findIndex(r => r.id == state.selectedItem);
  },

  set selectedIndex(index) {
    const requests = getSortedRequests(this.store.getState());
    let itemId = null;
    if (index >= 0 && index < requests.size) {
      itemId = requests.get(index).id;
    }
    this.store.dispatch(Actions.selectItem(itemId));
  },

  get selectedItem() {
    return getSelectedRequest(this.store.getState());
  },

  set selectedItem(item) {
    this.store.dispatch(Actions.selectItem(item ? item.id : null));
  },

  ensureSelectedItemIsVisible() {
    // TODO: scroll selected element into view
  },

  /**
   * Updates the sidebar status when something about the selection changes
   */
  onSelectionUpdate(newSelected, oldSelected) {
    if (newSelected && oldSelected && newSelected.id == oldSelected.id) {
      // The same item is still selected, its data only got updated
      NetMonitorView.NetworkDetails.populate(newSelected);
    } else if (newSelected) {
      // Another item just got selected
      NetMonitorView.Sidebar.populate(newSelected);
      NetMonitorView.Sidebar.toggle(true);
    } else {
      // Selection just got empty
      NetMonitorView.Sidebar.toggle(false);
    }
  },

  /**
   * Refreshes the status displayed in this container's toolbar, providing
   * concise information about all requests.
   */
  onSummaryUpdate(summary) {
    const { count, bytes, millis } = summary;

    if (!count) {
      this._summary.setAttribute("label", L10N.getStr("networkMenu.empty"));
      return;
    }

    // https://developer.mozilla.org/en-US/docs/Localization_and_Plurals
    let str = PluralForm.get(summary.count, L10N.getStr("networkMenu.summary"));

    this._summary.setAttribute("label", str
      .replace("#1", count)
      .replace("#2", L10N.numberWithDecimals(bytes / 1024, CONTENT_SIZE_DECIMALS))
      .replace("#3", L10N.numberWithDecimals(millis / 1000, REQUEST_TIME_DECIMALS))
    );
  },

  /**
   * The resize listener for this container's window.
   */
  onResize() {
    // Allow requests to settle down first.
    setNamedTimeout("resize-events", RESIZE_REFRESH_RATE, () => {
      let container = $("#requests-menu-toolbar");
      let waterfall = $("#requests-menu-waterfall-header-box");
      if (!container || !waterfall) {
        return;
      }

      let containerBounds = container.getBoundingClientRect();
      let waterfallBounds = waterfall.getBoundingClientRect();

      let waterfallWidth;
      if (!window.isRTL) {
        waterfallWidth = containerBounds.width - waterfallBounds.left;
      } else {
        waterfallWidth = waterfallBounds.right;
      }

      this.store.dispatch(Actions.resizeWaterfall(waterfallWidth));
    });
  },

  /**
   * Create a new custom request form populated with the data from
   * the currently selected request.
   */
  cloneSelectedRequest() {
    this.store.dispatch(Actions.cloneSelectedRequest());
  },

  /**
   * Shows raw request/response headers in textboxes.
   */
  toggleRawHeaders: function () {
    let requestTextarea = $("#raw-request-headers-textarea");
    let responseTextarea = $("#raw-response-headers-textarea");
    let rawHeadersHidden = $("#raw-headers").getAttribute("hidden");

    if (rawHeadersHidden) {
      let selected = this.selectedItem;
      let selectedRequestHeaders = selected.requestHeaders.headers;
      let selectedResponseHeaders = selected.responseHeaders.headers;
      requestTextarea.value = writeHeaderText(selectedRequestHeaders);
      responseTextarea.value = writeHeaderText(selectedResponseHeaders);
      $("#raw-headers").hidden = false;
    } else {
      requestTextarea.value = null;
      responseTextarea.value = null;
      $("#raw-headers").hidden = true;
    }
  },

  /**
   * Send a new HTTP request using the data in the custom request form.
   */
  sendCustomRequest: function () {
    let selected = this.selectedItem;

    let data = {
      url: selected.url,
      method: selected.method,
      httpVersion: selected.httpVersion,
    };
    if (selected.requestHeaders) {
      data.headers = selected.requestHeaders.headers;
    }
    if (selected.requestPostData) {
      data.body = selected.requestPostData.postData.text;
    }

    NetMonitorController.webConsoleClient.sendHTTPRequest(data, response => {
      let id = response.eventActor.actor;
      this.store.dispatch(Actions.preselectItem(id));
    });

    this.closeCustomRequest();
  },

  /**
   * Remove the currently selected custom request.
   */
  closeCustomRequest() {
    this.store.dispatch(Actions.removeSelectedCustomRequest());
  },
};

exports.RequestsMenuView = RequestsMenuView;
