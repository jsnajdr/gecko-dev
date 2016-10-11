/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { DOM, PropTypes } = require("devtools/client/shared/vendor/react");
const { connect } = require("devtools/client/shared/vendor/react-redux");
const { L10N } = require("../l10n");
const Actions = require("../actions/index");
const { isSidebarToggleButtonDisabled } = require("../selectors/index");

// Shortcuts
const { button } = DOM;

/**
 * Button used to toggle sidebar
 */
function ToggleButton({
  disabled,
  onToggle,
  visible,
}) {
  let className = ["devtools-button"];
  if (!visible) {
    className.push("pane-collapsed");
  }
  let titleMsg = visible ? L10N.getStr("collapseDetailsPane") :
                           L10N.getStr("expandDetailsPane");

  return button({
    id: "details-pane-toggle",
    className: className.join(" "),
    title: titleMsg,
    disabled: disabled,
    tabIndex: "0",
    onMouseDown: onToggle,
  });
}

ToggleButton.propTypes = {
  disabled: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  visible: PropTypes.bool.isRequired,
};

module.exports = connect(
  (state) => ({
    disabled: isSidebarToggleButtonDisabled(state),
    visible: state.sidebar.visible,
  }),
  (dispatch) => ({
    onToggle: () => dispatch(Actions.toggleSidebar())
  })
)(ToggleButton);
