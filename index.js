/**********************************************************************
 * Copyright 2022 Paul Reeve <preeve@pdjr.eu>
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you
 * may not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

const Log = require("./lib/signalk-liblog/Log.js");
const Notification = require("./lib/signalk-libnotification/Notification.js");

const PLUGIN_ID = "interfacewatchdog";
const PLUGIN_NAME = "Interface activity watchdog";
const PLUGIN_DESCRIPTION = "Monitor a Signal K interface for anomalous drops in activity";
const PLUGIN_SCHEMA = {
  "title": "Configuration for interfacewatchdog plugin",
  "type": "object",
  "properties": {
    "interfaces": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "interface": {
            "title": "Interface",
            "type": "string"
          },
          "threshold": {
            "title": "Activity threshold in deltas per second",
            "type": "number"
          },
          "waitForActivity": {
            "title": "Wait this number of cycles for activity (0 says for ever)",
            "type": "number"
          },
          "restart": {
            "title": "Restart",
            "type": "boolean"
          },
          "restartLimit": {
            "title": "Give up restarting the server after this many consecutive restarts",
            "type": "number"
          },
          "notificationPath": {
            "title": "Notification path",
            "type": "string"
          }
        },
        "required": [ "interface" ],
        "default": { "threshold": 0, "waitForActivity": 0, "restart": false, "restartLimit": 3 }
      }
    }
  },
  "required": [ "interfaces" ]
};
const PLUGIN_UISCHEMA = {};

const INTERFACE_NOT_AVAILABLE_LOG_LIMIT = 3;

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = PLUGIN_UISCHEMA;

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  const notification = new Notification(app, plugin.id, { "state": "alarm", "method": [ ] });

  plugin.start = function(options) {

    // Make plugin.options by merging defaults and options.
    plugin.options = {};
    plugin.options.interfaces = options.interfaces.map(interface => ({ ...plugin.schema.properties.interfaces.items.default, ...interface }));
    app.debug(`using congiguration: ${JSON.stringify(plugin.options, null, 2)}`);

    if (plugin.options.interfaces.length > 0) {
      // Log what we are up to.
      log.N(`watching interfaces ${JSON.stringify(plugins.options.interfaces.map(i => (i.interface)))}`);
      
      // Make some scratch values and log/notify.
      plugin.options.interfaces.forEach(interface => {
        interface.hasBeenActive = 0;
        interface.alarmIssued = 0;
        interface.notAvailableCount = 0;
        interface.restarts = 0;
        notification.issue(interface.notificationPath, "Waiting for interface to become active", { "state": "normal" });
      });
            
      // Register as a serverevent recipient.
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          // Iterate over configured interfaces.
          plugin.options.interfaces.forEach(interface => {

            if ((e.data.providerStatistics[interface.interface]) && (e.data.providerStatistics[interface.interface])) {
              if (interface.notAvailableCount > 0) {
                log.N("provider statistics for interface '%s' are now available.", interface.interface, false);
                interface.notAvailableCount = 0;
              }

              var throughput = e.data.providerStatistics[interface.interface].deltaRate;

              // Check interface to make sure it has some activity
              if ((interface.hasBeenActive < 2) && (throughput > 0.0)) {
                log.N("interface '%s' is alive", interface.interface, false);
                notification.issue(interface.notificationPath, "Interface is alive", { "state": "normal" });
                interface.hasBeenActive = (throughput < interface.threshold)?1:2;
              }
                  
              // If we aren't waiting for activity or we are and the
              // interface has been active, then monitor throughput
              if ((interface.hasBeenActive === 2) || (interface.waitForActivity === 0)) {
                if (parseInt(throughput) <= interface.threshold) {
                  log.N("throughput on '%s' dropped below threshold", interface.interface, false);
                  if (!interface.alarmIssued) {
                    notification.issue(interface.notificationPath, "Throughput on '" + interface.interface + "' dropped below threshold", { "state": "alarm" });
                    interface.alarmIssued = 1;
                  }
                  if (interface.restart) {
                    interface.restarts = (interface.restarts)?(interface.restarts++):1;
                    delete interface.hasBeenActive;
                    delete interface.alarmIssued;
                    delete interface.notAvailableCount;
                    app.savePluginOptions(plugin.options);
                    if ((interface.restarts) && (interface.restarts < interface.restartLimit)) {
                      log.N("restarting Signal K", false);
                      setTimeout(() => { process.exit(0); }, 1000);
                    } else {
                      log.N("refusing to restart interface '%s' because restart limit has been reached", interface.interface, false);
                      log.N("correct the persistent problem with the interface and then delete the", false);
                      log.N("'restarts' property in the plugin configuration file.", false);
                    }
                  }
                } else {
                  notification.issue(interface.notificationPath, "Throughput on '" + interface.interface + "' above threshold", { "state": "normal" });
                  interface.alarmIssued = 0;
                  if (interface.restarts) {
                    delete interface.restarts;
                    app.savePluginOptions(plugin.options);
                  }
                }
              }
              interface.waitForActivity = (interface.waitForActivity > 0)?(interface.waitForActivity-1):0;
            } else {
              interface.notAvailableCount++;
              if (interface.notAvailableCount <= INTERFACE_NOT_AVAILABLE_LOG_LIMIT) {
                log.N(
                  "provider statistics for interface '%s' are not available%s.",
                  interface.interface,
                  (interface.notAvailableCount == INTERFACE_NOT_AVAILABLE_LOG_LIMIT)?" (subsequent errors will not be logged)":"",
                  false
                );
              }
            }
          });
        }
      });
    } else {
      log.W("stopped: no interfaces are defined");
    }
  }

  plugin.stop = function() {
  }

  return(plugin);
}
