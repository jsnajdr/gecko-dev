/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals window */

"use strict";

const NetworkHelper = require("devtools/shared/webconsole/network-helper");
const { createClass, PropTypes, DOM } = require("devtools/client/shared/vendor/react");
const { div, span, img } = DOM;
const { L10N } = require("../l10n");
const { getFormattedSize } = require("../utils/format-utils");
const { getAbbreviatedMimeType,
        getUriNameWithQuery,
        getUriHost,
        getUriHostPort } = require("../request-utils");

/**
 * Render one row in the request list.
 */
const RequestListItem = createClass({
  displayName: "RequestListItem",

  propTypes: {
    item: PropTypes.object.isRequired,
    index: PropTypes.number.isRequired,
    isSelected: PropTypes.bool.isRequired,
    onContextMenu: PropTypes.func.isRequired,
    onMouseDown: PropTypes.func.isRequired,
    onSecurityIconClick: PropTypes.func.isRequired,
  },

  componentDidMount() {
    if (this.props.isSelected) {
      this.refs.el.focus();
    }
  },

  shouldComponentUpdate(nextProps) {
    return this.props.item !== nextProps.item
      || this.props.index !== nextProps.index
      || this.props.isSelected !== nextProps.isSelected;
  },

  componentDidUpdate(prevProps) {
    if (!prevProps.isSelected && this.props.isSelected) {
      this.refs.el.focus();
      if (this.props.onFocusedNodeChange) {
        this.props.onFocusedNodeChange();
      }
    }
  },

  componentWillUnmount() {
    // If this node is being destroyed and has focus, transfer the focus manually
    // to the parent tree component. Otherwise, the focus will get lost and keyboard
    // navigation in the tree will stop working. This is a workaround for a XUL bug.
    // See bugs 1259228 and 1152441 for details.
    // DE-XUL: Remove this hack once all usages are only in HTML documents.
    if (this.props.isSelected) {
      this.refs.el.blur();
      if (this.props.onFocusedNodeUnmount) {
        this.props.onFocusedNodeUnmount();
      }
    }
  },

  render() {
    const { item, index, isSelected, onContextMenu, onMouseDown,
            onSecurityIconClick } = this.props;
    const urlInfo = extractUrlInfo(item.url);

    let classList = [ "request-list-item" ];
    if (isSelected) {
      classList.push("selected");
    }
    classList.push(index % 2 ? "odd" : "even");

    return div(
      {
        ref: "el",
        className: classList.join(" "),
        "data-id": item.id,
        tabIndex: 0,
        onContextMenu,
        onMouseDown,
      },
      StatusColumn(item),
      MethodColumn(item),
      FileColumn(item, urlInfo),
      DomainColumn(item, urlInfo, onSecurityIconClick),
      CauseColumn(item),
      TypeColumn(item),
      TransferredSizeColumn(item),
      ContentSizeColumn(item),
      WaterfallColumn(item)
    );
  }
});

function StatusColumn(item) {
  const { status, statusText, fromCache, fromServiceWorker } = item;

  let code, title;

  if (status) {
    if (fromCache) {
      code = "cached";
    } else if (fromServiceWorker) {
      code = "service worker";
    } else {
      code = status;
    }

    if (statusText) {
      title = `${status} ${statusText}`;
      if (fromCache) {
        title += " (cached)";
      }
      if (fromServiceWorker) {
        title += " (service worker)";
      }
    }
  }

  return div({ className: "requests-menu-subitem requests-menu-status", title },
    div({ className: "requests-menu-status-icon", "data-code": code }),
    span({ className: "subitem-label requests-menu-status-code" }, status)
  );
}

function MethodColumn(item) {
  return div({ className: "requests-menu-subitem requests-menu-method-box" },
    span({ className: "subitem-label requests-menu-method" }, item.method)
  );
}

function FileColumn(item, urlInfo) {
  const { responseContentDataUri } = item;
  const { unicodeUrl, nameWithQuery } = urlInfo;

  return div({ className: "requests-menu-subitem requests-menu-icon-and-file" },
    img({
      className: "requests-menu-icon",
      src: responseContentDataUri,
      hidden: !responseContentDataUri,
      "data-type": responseContentDataUri ? "thumbnail" : undefined
    }),
    div(
      {
        className: "subitem-label requests-menu-file",
        title: unicodeUrl
      },
      nameWithQuery
    )
  );
}

function DomainColumn(item, urlInfo, onSecurityIconClick) {
  const { remoteAddress, securityState } = item;
  const { hostPort, isLocal } = urlInfo;

  let iconClassList = [ "requests-security-state-icon" ];
  let iconTitle;
  if (isLocal) {
    iconClassList.push("security-state-local");
    iconTitle = L10N.getStr("netmonitor.security.state.secure");
  } else if (securityState) {
    iconClassList.push(`security-state-${securityState}`);
    iconTitle = L10N.getStr(`netmonitor.security.state.${securityState}`);
  }

  let title = hostPort + (remoteAddress ? ` (${remoteAddress})` : "");

  return div(
    { className: "requests-menu-subitem requests-menu-security-and-domain" },
    div({
      className: iconClassList.join(" "),
      title: iconTitle,
      onClick: onSecurityIconClick,
    }),
    span({ className: "subitem-label requests-menu-domain", title }, hostPort)
  );
}

function CauseColumn(item) {
  const { cause } = item;

  let causeType = "";
  let causeUri = undefined;
  let causeHasStack = false;

  if (cause) {
    causeType = cause.type;
    causeUri = cause.loadingDocumentUri;
    causeHasStack = cause.stacktrace && cause.stacktrace.length > 0;
  }

  return div(
    { className: "requests-menu-subitem requests-menu-cause", title: causeUri },
    span({ className: "requests-menu-cause-stack", hidden: !causeHasStack }, "JS"),
    span({ className: "subitem-label" }, causeType)
  );
}

const CONTENT_MIME_TYPE_ABBREVIATIONS = {
  "ecmascript": "js",
  "javascript": "js",
  "x-javascript": "js"
};

function TypeColumn(item) {
  const { mimeType } = item;
  let abbrevType;
  if (mimeType) {
    abbrevType = getAbbreviatedMimeType(mimeType);
    abbrevType = CONTENT_MIME_TYPE_ABBREVIATIONS[abbrevType] || abbrevType;
  }

  return div(
    { className: "requests-menu-subitem requests-menu-type", title: mimeType },
    span({ className: "subitem-label" }, abbrevType)
  );
}

function TransferredSizeColumn(item) {
  const { transferredSize, fromCache, fromServiceWorker } = item;

  let text;
  let className = "subitem-label";
  if (fromCache) {
    text = L10N.getStr("networkMenu.sizeCached");
    className += " theme-comment";
  } else if (fromServiceWorker) {
    text = L10N.getStr("networkMenu.sizeServiceWorker");
    className += " theme-comment";
  } else if (typeof transferredSize == "number") {
    text = getFormattedSize(transferredSize);
  } else if (transferredSize === null) {
    text = L10N.getStr("networkMenu.sizeUnavailable");
  }

  return div(
    { className: "requests-menu-subitem requests-menu-transferred", title: text },
    span({ className }, text)
  );
}

function ContentSizeColumn(item) {
  const { contentSize } = item;

  let text;
  if (typeof contentSize == "number") {
    text = getFormattedSize(contentSize);
  }

  return div(
    { className: "requests-menu-subitem subitem-label requests-menu-size", title: text },
    span({ className: "subitem-label" }, text)
  );
}

function timingBoxes(item) {
  const { eventTimings, totalTime, fromCache, fromServiceWorker } = item;
  let boxes = [];

  if (fromCache || fromServiceWorker) {
    return boxes;
  }

  if (eventTimings) {
    // Add a set of boxes representing timing information.
    for (let key of ["blocked", "dns", "connect", "send", "wait", "receive"]) {
      let width = eventTimings.timings[key];

      // Don't render anything if it surely won't be visible.
      // One millisecond == one unscaled pixel.
      if (width > 0) {
        boxes.push(div({
          className: "requests-menu-timings-box " + key,
          style: { width }
        }));
      }
    }
  }

  if (typeof totalTime == "number") {
    let text = L10N.getFormatStr("networkMenu.totalMS", totalTime);
    boxes.push(div({
      className: "requests-menu-timings-total",
      title: text
    }, text));
  }

  return boxes;
}

function WaterfallColumn(item) {
  let direction = window.isRTL ? -1 : 1;
  let { startedDeltaMillis } = item;

  // Render the timing information at a specific horizontal translation
  // based on the delta to the first monitored event network.
  let translateX = `translateX(${direction * startedDeltaMillis}px)`;

  // Based on the total time passed until the last request, rescale
  // all the waterfalls to a reasonable size.
  let scaleX = " scaleX(var(--timings-scale))";

  return div({ className: "requests-menu-subitem requests-menu-waterfall" },
    div({
      className: "requests-menu-timings",
      style: { transform: scaleX + translateX }
    }, timingBoxes(item))
  );
}

function extractUrlInfo(url) {
  let uri;
  try {
    uri = NetworkHelper.nsIURL(url);
  } catch (e) {
    // User input may not make a well-formed url yet.
    return {};
  }

  let nameWithQuery = getUriNameWithQuery(uri);
  let hostPort = getUriHostPort(uri);
  let host = getUriHost(uri);
  let unicodeUrl = NetworkHelper.convertToUnicode(unescape(uri.spec));

  // Mark local hosts specially, where "local" is  as defined in the W3C
  // spec for secure contexts.
  // http://www.w3.org/TR/powerful-features/
  //
  //  * If the name falls under 'localhost'
  //  * If the name is an IPv4 address within 127.0.0.0/8
  //  * If the name is an IPv6 address within ::1/128
  //
  // IPv6 parsing is a little sloppy; it assumes that the address has
  // been validated before it gets here.
  let isLocal = host.match(/(.+\.)?localhost$/) ||
                host.match(/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}/) ||
                host.match(/\[[0:]+1\]/);

  return {
    nameWithQuery,
    hostPort,
    unicodeUrl,
    isLocal
  };
}

module.exports = RequestListItem;
