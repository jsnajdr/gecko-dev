// Parent config file for all mochitest files.
module.exports = {
  rules: {
    "mozilla/import-headjs-globals": 1,
    "mozilla/mark-test-function-used": 1,
    "no-shadow": 2,
  },

  "env": {
    "browser": true,
  },

  // All globals made available in the test environment.
  "globals": {
    "add_task": false,
    "Assert": false,
    "EventUtils": false,
    "executeSoon": false,
    "export_assertions": false,
    "finish": false,
    "getRootDirectory": false,
    "getTestFilePath": false,
    "gTestPath": false,
    "info": false,
    "is": false,
    "isDeeply": false,
    "isnot": false,
    "ok": false,
    "promise": false,
    "registerCleanupFunction": false,
    "requestLongerTimeout": false,
    "SimpleTest": false,
    "SpecialPowers": false,
    "todo": false,
    "todo_is": false,
    "todo_isnot": false,
    "waitForClipboard": false,
    "waitForExplicitFinish": false,
    "waitForFocus": false,
  }
};
