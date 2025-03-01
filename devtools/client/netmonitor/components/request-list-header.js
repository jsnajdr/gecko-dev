/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals document */

"use strict";

const { createClass, PropTypes, DOM } = require("devtools/client/shared/vendor/react");
const { div, button } = DOM;
const { connect } = require("devtools/client/shared/vendor/react-redux");
const { L10N } = require("../l10n");
const { getWaterfallScale } = require("../selectors/index");
const Actions = require("../actions/index");
const WaterfallBackground = require("../waterfall-background");

// ms
const REQUESTS_WATERFALL_HEADER_TICKS_MULTIPLE = 5;
// px
const REQUESTS_WATERFALL_HEADER_TICKS_SPACING_MIN = 60;

const REQUEST_TIME_DECIMALS = 2;

const HEADERS = [
  { name: "status", label: "status3" },
  { name: "method" },
  { name: "file", boxName: "icon-and-file" },
  { name: "domain", boxName: "security-and-domain" },
  { name: "cause" },
  { name: "type" },
  { name: "transferred" },
  { name: "size" },
  { name: "waterfall" }
];

/**
 * Render the request list header with sorting arrows for columns.
 * Displays tick marks in the waterfall column header.
 * Also draws the waterfall background canvas and updates it when needed.
 */
const RequestListHeader = createClass({
  displayName: "RequestListHeader",

  propTypes: {
    sortBy: PropTypes.object,
    scale: PropTypes.number,
    waterfallWidth: PropTypes.number,
    onHeaderClick: PropTypes.func.isRequired,
  },

  componentDidMount() {
    this.background = new WaterfallBackground(document);
    this.background.draw(this.props);
  },

  componentDidUpdate() {
    this.background.draw(this.props);
  },

  componentWillUnmount() {
    this.background.destroy();
    this.background = null;
  },

  render() {
    const { sortBy, scale, waterfallWidth, onHeaderClick } = this.props;

    return div(
      { id: "requests-menu-toolbar", className: "devtools-toolbar" },
      div({ id: "toolbar-labels" },
        HEADERS.map(header => {
          const name = header.name;
          const boxName = header.boxName || name;
          const label = L10N.getStr(`netmonitor.toolbar.${header.label || name}`);

          let sorted, sortedTitle;
          const active = sortBy.type == name ? true : undefined;
          if (active) {
            sorted = sortBy.ascending ? "ascending" : "descending";
            sortedTitle = L10N.getStr(sortBy.ascending
              ? "networkMenu.sortedAsc"
              : "networkMenu.sortedDesc");
          }

          return div(
            {
              id: `requests-menu-${boxName}-header-box`,
              className: `requests-menu-header requests-menu-${boxName}`,
              // Used to style the next column.
              "data-active": active,
            },
            button(
              {
                id: `requests-menu-${name}-button`,
                className: `requests-menu-header-button requests-menu-${name}`,
                "data-sorted": sorted,
                title: sortedTitle,
                onClick: () => onHeaderClick(name),
              },
              name == "waterfall" ? WaterfallLabel(waterfallWidth, scale, label)
                                  : div({ className: "button-text" }, label),
              div({ className: "button-icon" })
            )
          );
        })
      )
    );
  }
});

/**
 * Build the waterfall header - timing tick marks with the right spacing
 */
function waterfallDivisionLabels(waterfallWidth, scale) {
  let labels = [];

  // Build new millisecond tick labels...
  let timingStep = REQUESTS_WATERFALL_HEADER_TICKS_MULTIPLE;
  let scaledStep = scale * timingStep;

  // Ignore any divisions that would end up being too close to each other.
  while (scaledStep < REQUESTS_WATERFALL_HEADER_TICKS_SPACING_MIN) {
    scaledStep *= 2;
  }

  // Insert one label for each division on the current scale.
  for (let x = 0; x < waterfallWidth; x += scaledStep) {
    let millisecondTime = x / scale;

    let normalizedTime = millisecondTime;
    let divisionScale = "millisecond";

    // If the division is greater than 1 minute.
    if (normalizedTime > 60000) {
      normalizedTime /= 60000;
      divisionScale = "minute";
    } else if (normalizedTime > 1000) {
      // If the division is greater than 1 second.
      normalizedTime /= 1000;
      divisionScale = "second";
    }

    // Showing too many decimals is bad UX.
    if (divisionScale == "millisecond") {
      normalizedTime |= 0;
    } else {
      normalizedTime = L10N.numberWithDecimals(normalizedTime, REQUEST_TIME_DECIMALS);
    }

    let width = (x + scaledStep | 0) - (x | 0);
    // Adjust the first marker for the borders
    if (x == 0) {
      width -= 2;
    }
    // Last marker doesn't need a width specified at all
    if (x + scaledStep >= waterfallWidth) {
      width = undefined;
    }

    labels.push(div(
      {
        className: "requests-menu-timings-division",
        "data-division-scale": divisionScale,
        style: { width }
      },
      L10N.getFormatStr("networkMenu." + divisionScale, normalizedTime)
    ));
  }

  return labels;
}

function WaterfallLabel(waterfallWidth, scale, label) {
  let className = "button-text requests-menu-waterfall-label-wrapper";

  if (scale != null) {
    label = waterfallDivisionLabels(waterfallWidth, scale);
    className += " requests-menu-waterfall-visible";
  }

  return div({ className }, label);
}

module.exports = connect(
  state => ({
    sortBy: state.sortBy,
    scale: getWaterfallScale(state),
    waterfallWidth: state.waterfallWidth,
    firstRequestStartedMillis: state.firstRequestStartedMillis,
    timingMarkers: state.timingMarkers,
  }),
  dispatch => ({
    onHeaderClick: type => dispatch(Actions.sortBy(type)),
  })
)(RequestListHeader);
